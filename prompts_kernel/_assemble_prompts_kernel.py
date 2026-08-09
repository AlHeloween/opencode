"""Kernel fragment: 29_reasoning_render — assemble reasoning.txt from fragments.

Source fragments live in:
  prompts_kernel/reasoning/*.txt

Fragments are concatenated in sorted filename order (00_, 01_, …).
Single blank line between fragment bodies; final newline.

@schema: injection (v1.0):
  Fragments may contain placeholder markers:
      # @schema: section_name
      # @schema: section.subsection

  At build time, resolve_schema_refs() reads core_schemas.yaml and replaces
  each marker with the corresponding YAML section rendered as comment lines.
  The model always sees full inline schemas; the developer edits only the
  canonical YAML file.
"""
from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore[assignment]


def _default_fragment_dir() -> Path:
    """Resolve the fragment directory — co-located in kernel package."""
    return Path(__file__).resolve().parent / "reasoning"


def _default_output() -> Path:
    """Default output path for reasoning_prompt.mdc."""
    kernel_dir = Path(__file__).resolve().parent
    repo_root = kernel_dir.parent
    return repo_root / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.mdc"


def _schemas_path() -> Path:
    """Path to core_schemas.yaml — canonical schema source."""
    return Path(__file__).resolve().parent / "core_schemas.yaml"


def _load_core_schemas() -> dict:
    """Load core_schemas.yaml. Raises if YAML unavailable or file missing."""
    if yaml is None:
        raise RuntimeError("PyYAML required for @schema: resolution — pip install pyyaml")
    path = _schemas_path()
    if not path.is_file():
        raise FileNotFoundError(f"core_schemas.yaml not found at {path}")
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _resolve_yaml_path(schemas: dict, path: str) -> dict | list | str | None:
    """Resolve a dot-path like 'stamps.oracle_stamp' in a nested dict."""
    parts = path.strip().split(".")
    current = schemas
    for part in parts:
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return None
    return current


def _section_to_comment_lines(data: object) -> list[str]:
    """Dump a resolved YAML section. Emit '### name (@tag)' for tagged sub-sections."""
    if yaml is None:
        raise RuntimeError("PyYAML required — pip install pyyaml")
    if isinstance(data, dict):
        data = {k: v for k, v in data.items() if not (isinstance(k, str) and k.startswith("_"))}
    if data is None or data == {} or data == []:
        return ["# (empty)"]

    lines: list[str] = []

    # Handle nested tagged sections (e.g., gates: {G1: {tag:G1, name:GROUND, ...}})
    if isinstance(data, dict):
        nested_headers = []
        remaining = {}
        for key, val in data.items():
            if isinstance(val, dict) and "tag" in val:
                # Schema sections are reused while resolving multiple markers.
                # Never consume their metadata during presentation.
                rendered = dict(val)
                tag = rendered.pop("tag")
                name = rendered.pop("name", tag)
                nested_headers.append(f"## {name} (@{tag})")
                remaining[key] = rendered
            else:
                remaining[key] = val
        if nested_headers:
            data = remaining
            # Dump each tagged entry separately with its header
            for i, (h, (k, v)) in enumerate(zip(nested_headers, data.items())):
                lines.append(h)
                if v:
                    raw = yaml.dump(v, default_flow_style=False, allow_unicode=True, sort_keys=False)
                    for line in raw.rstrip("\n").split("\n"):
                        lines.append("  " + line)  # indent under header
            return lines

    # Top-level tag
    if isinstance(data, dict) and "tag" in data:
        tag = data.pop("tag")
        name = data.pop("name", tag)
        lines.append(f"### {name} (@{tag})")

    raw = yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False)
    for line in raw.rstrip("\n").split("\n"):
        lines.append(line)
    return lines


def resolve_schema_refs(text: str, schemas: dict | None = None) -> str:
    """Replace @schema: markers with inline YAML from core_schemas.yaml.

    Marker format:  # @schema: section_name
                    # @schema: section.subsection

    Each marker line is replaced with the resolved YAML section as
    '# '-prefixed comment lines.  The model sees clean YAML.
    """
    if schemas is None:
        schemas = _load_core_schemas()

    marker_re = re.compile(r"^#? ?@schema:\s*(\S+)\s*$", re.MULTILINE)

    def _replace(match: re.Match) -> str:
        path = match.group(1)
        section = _resolve_yaml_path(schemas, path)
        if section is None:
            available = sorted(schemas.keys())
            raise KeyError(
                f"@schema:{path} not found in core_schemas.yaml. "
                f"Available top-level keys: {available}"
            )
        rendered = _section_to_comment_lines(section)
        return "\n".join(rendered) + "\n"

    return marker_re.sub(_replace, text)


def resolve_def_refs(text: str, schemas: dict | None = None) -> str:
    """Replace @def: NAME markers with definitions from core_schemas.yaml.

    Marker format:  @def: NAME

    Each marker is replaced with the definition text from
    core_schemas.yaml → definitions → NAME (as a YAML block scalar).
    """
    if schemas is None:
        schemas = _load_core_schemas()

    definitions = schemas.get("definitions", {})
    if not definitions:
        return text

    def_re = re.compile(r"^@def:\s*(\S+)\s*$", re.MULTILINE)

    def _replace(match: re.Match) -> str:
        name = match.group(1)
        if name not in definitions:
            available = sorted(definitions.keys())
            raise KeyError(
                f"@def:{name} not found in core_schemas.yaml definitions. "
                f"Available: {available}"
            )
        return f"### {name} (@{name})\n{definitions[name].rstrip(chr(10))}\n"

    return def_re.sub(_replace, text)


_MDC_FRONTMATTER_UNIFIED = """---
description: "GATED agent — 9-gate spine, semantic vector, rules, contracts"
alwaysApply: true
---

"""


def assemble_reasoning(fragment_dir: Path | None = None) -> str:
    """Assemble reasoning.txt from topic fragments with @schema: resolution.

    Fragments are sorted by filename and joined with double-newline separators.
    Before joining, each fragment is scanned for @schema: markers — these are
    resolved against core_schemas.yaml and replaced with inline YAML.

    Returns the assembled text (UTF-8, LF endings).
    """
    if fragment_dir is None:
        fragment_dir = _default_fragment_dir()

    schemas = _load_core_schemas()

    files = sorted(fragment_dir.glob("*.txt"))
    if not files:
        raise FileNotFoundError(f"no fragments in {fragment_dir}")

    parts: list[str] = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        if not text.endswith("\n"):
            text += "\n"
        try:
            text = resolve_schema_refs(text, schemas)
        except KeyError as e:
            raise KeyError(f"{path.name}: {e}") from e
        parts.append(text.rstrip("\n"))

    body = "\n\n".join(parts) + "\n"
    body = _strip_comment_prefix(body)
    return body


def _strip_comment_prefix(text: str) -> str:
    """Strip leading '# ' or '#' from every line. Blank comment lines become empty."""
    result: list[str] = []
    for line in text.split("\n"):
        if line.startswith("# "):
            result.append(line[2:])
        elif line.startswith("#"):
            result.append(line[1:])
        else:
            result.append(line)
    return "\n".join(result)


_MDC_FRONTMATTER_UNIFIED = """---
description: "GATED agent — 9-gate spine, semantic vector, rules, contracts"
alwaysApply: true
---

"""


def _default_output() -> Path:
    """Default output path for reasoning_prompt.mdc."""
    kernel_dir = Path(__file__).resolve().parent
    repo_root = kernel_dir.parent
    return repo_root / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.mdc"


def _runtime_output(output: Path) -> Path:
    """Return the runtime .txt sibling for a generated .mdc review artifact."""
    return output.with_suffix(".txt")


def render_reasoning_artifacts(fragment_dir: Path | None = None) -> tuple[str, str]:
    """Render review (.mdc) and runtime (.txt) kernel artifacts from one source."""
    from prompts_kernel import render_runtime_kernel

    reasoning = assemble_reasoning(fragment_dir)
    runtime = render_runtime_kernel()
    runtime_body = reasoning + "\n\n" + runtime
    return _MDC_FRONTMATTER_UNIFIED + runtime_body, runtime_body


def _stage_text(output: Path, body: str) -> Path:
    """Stage UTF-8/LF content beside its target so replace stays atomic."""
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, staged = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".tmp", dir=output.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        Path(staged).unlink(missing_ok=True)
        raise
    return Path(staged)


def _publish_staged(staged: list[tuple[Path, Path]]) -> None:
    """Publish staged artifacts; runtime target goes first if publication is interrupted."""
    try:
        for output, temporary in staged:
            temporary.replace(output)
    finally:
        for _, temporary in staged:
            temporary.unlink(missing_ok=True)


def validate_reasoning_artifacts(
    output: Path | None = None,
    fragment_dir: Path | None = None,
) -> list[str]:
    """Return drift errors for the generated review and runtime kernel artifacts."""
    if output is None:
        output = _default_output()
    expected_mdc, expected_runtime = render_reasoning_artifacts(fragment_dir)
    expected = ((_runtime_output(output), expected_runtime), (output, expected_mdc))
    errors: list[str] = []
    for path, content in expected:
        if not path.is_file():
            errors.append(f"missing generated kernel artifact: {path}")
            continue
        if path.read_text(encoding="utf-8") != content:
            errors.append(f"generated kernel artifact drifted: {path}")
    return errors


def write_reasoning(output: Path | None = None, fragment_dir: Path | None = None) -> int:
    """Atomically publish unified review and runtime artifacts from one render."""
    if output is None:
        output = _default_output()
    mdc, runtime = render_reasoning_artifacts(fragment_dir)
    # The provider imports .txt, so publish it before the non-runtime .mdc review copy.
    _publish_staged([
        (_runtime_output(output), _stage_text(_runtime_output(output), runtime)),
        (output, _stage_text(output, mdc)),
    ])
    errors = validate_reasoning_artifacts(output, fragment_dir)
    if errors:
        raise RuntimeError("; ".join(errors))
    return len(mdc)


# =========================================================================
# Precompiled kernel module — 10× import speedup
# =========================================================================

# Mirrors __init__._FRAGMENTS and __init__._COMMON_IMPORTS.
# Duplicated intentionally: _assemble_prompts_kernel is loaded BEFORE
# __init__ finishes bootstrapping, so we can't import from __init__.
_PRECOMPILE_FRAGMENTS: list[str] = [
    "01_enums",
    "02_info_mark",
    "03_semantic_vector",
    "04_delta",
    "05_svm_anchor",
    "06_contracts",
    "07_digest",
    "08_validation",
    "09_execution_permit",
    "10_state_machine",
    "11_state_record",
    "12_classification",
    "13_bug_fix",
    "14_plan_cluster",
    "15_handlers",
    "16_example",
    "17_communication",
    "18_conformance",
    "19_specs_base",
    "20_specs_agents",
    "21_skills_boundary",
    "22_specs_commands",
    "23_specs_github",
    "24_specs_policies",
    "25_specs_default",
    "26_specs_grounding",
    "27_runtime_dict",
    "28_runtime_render",
    "29_syntax",
    "30_epistemic",
    "31_prompt_ir",
    "_assemble_prompts_kernel",
]

_PRECOMPILE_IMPORTS: str = """\
import ast
from collections.abc import Mapping
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
import sys
from types import MappingProxyType
from typing import Optional, Any, Callable
from enum import Enum
import hashlib
import json
import math
import uuid
"""

# Subset of __init__ whitelist — symbols that start with _ but ARE public.
_PRECOMPILE_WHITELIST: frozenset[str] = frozenset({
    "_ALL_SPECS",
    "_SPEC_FIELDS",
    "_TIER_A_AGENTS",
    "_TIER_A_POLICIES",
    "_TIER_B_COMMANDS",
    "_KERNEL_SYMBOLS",
    "_PROJECTION_PREFIXES",
    "_FIELD_TO_IR",
    "_spec",
    "_validate_spec",
    "_count",
    "_render_runtime_mapping",
    "_render_spec_block",
    "_assemble_prompts_kernel",
})


def _precompiled_output_path(kernel_dir: Path | None = None) -> Path:
    """Path to the generated _kernel_precompiled.py artifact."""
    if kernel_dir is None:
        kernel_dir = Path(__file__).resolve().parent
    return kernel_dir / "_kernel_precompiled.py"


def assemble_precompiled_kernel(kernel_dir: Path | None = None) -> str:
    """Concatenate all kernel fragments into one importable Python module.

    Returns the complete source text for _kernel_precompiled.py.
    Build-time cross-validation of RUNTIME_RULES ↔ OWNERS ↔ WORKFLOWS
    is embedded as assert statements at the end of the module.
    """
    if kernel_dir is None:
        kernel_dir = Path(__file__).resolve().parent

    lines: list[str] = []
    lines.append('"""Precompiled prompts_kernel — generated by _assemble_prompts_kernel.')
    lines.append('')
    lines.append('DO NOT EDIT. Regenerate with: write_precompiled_kernel()')
    lines.append('"""')
    lines.append('from __future__ import annotations')
    lines.append('')

    # 1. Common imports
    lines.append('# === Common imports (shared by all fragments) ===')
    for imp_line in _PRECOMPILE_IMPORTS.strip().split('\n'):
        lines.append(imp_line)
    lines.append('')

    # 2. Fragment bodies with source annotations
    for name in _PRECOMPILE_FRAGMENTS:
        path = kernel_dir / f"{name}.py"
        if not path.is_file():
            raise FileNotFoundError(f"kernel fragment missing: {path}")
        src = path.read_text(encoding="utf-8")
        # Strip duplicate __future__ imports (already at top of precompiled module)
        lines_fragment = src.split('\n')
        cleaned: list[str] = []
        for line in lines_fragment:
            stripped = line.strip()
            if stripped.startswith('from __future__ import'):
                continue  # already at module top
            cleaned.append(line)
        src = '\n'.join(cleaned)
        lines.append(f'# === Fragment: {name}.py ===')
        lines.append(src.rstrip('\n'))
        lines.append('')

    # 3. Build __all__
    lines.append('# === __all__ computation (mirrors __init__._bootstrap) ===')
    lines.append('_pub = [')
    lines.append('    k for k in list(globals())')
    lines.append('    if not k.startswith("_")')
    lines.append(f'    or k in {sorted(_PRECOMPILE_WHITELIST)!r}')
    lines.append(']')
    lines.append('__all__ = sorted(_pub)')
    lines.append('')

    # 4. Build-time cross-validation
    lines.append('# === Build-time cross-validation ===')
    lines.append('# Guard: only run when RUNTIME_RULES has been defined (not during syntax check)')
    lines.append('if "RUNTIME_RULES" in dir():')
    lines.append('    _missing_owners = [k for k in RUNTIME_RULES if k not in RUNTIME_RULE_OWNERS]')
    lines.append('    assert not _missing_owners, f"RUNTIME_RULES keys without owner: {_missing_owners}"')
    lines.append('')
    lines.append('    _orphan_owners = [k for k in RUNTIME_RULE_OWNERS if k not in RUNTIME_RULES]')
    lines.append('    assert not _orphan_owners, f"RUNTIME_RULE_OWNERS keys without rule: {_orphan_owners}"')
    lines.append('')
    lines.append('    _reachable = set()')
    lines.append('    for _wf_name, _wf_rules in RUNTIME_WORKFLOWS.items():')
    lines.append('        for _r in _wf_rules:')
    lines.append('            if _r in RUNTIME_RULES:')
    lines.append('                _reachable.add(_r)')
    lines.append('    _unreachable = [k for k in RUNTIME_RULES if k not in _reachable]')
    lines.append('    assert not _unreachable, f"RUNTIME_RULES not reachable from any workflow: {_unreachable}"')
    lines.append('')

    return '\n'.join(lines)


def write_precompiled_kernel(kernel_dir: Path | None = None) -> int:
    """Validate then atomically publish _kernel_precompiled.py."""
    body = assemble_precompiled_kernel(kernel_dir)
    output = _precompiled_output_path(kernel_dir)
    compile(body, str(output), "exec")
    _publish_staged([(output, _stage_text(output, body))])
    return len(body)
