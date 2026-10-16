"""Install ADID into Codex as the GLOBAL $CODEX_HOME/AGENTS.md file.

t64 (owner 2026-10-16): «developer_instructions писать не надо просто AGENTS.md
в ~\\.codex и все.» — reverses t54 (commit 2d405fdcf3, «Codex kernel lives only
in config.toml»). The channel is now `$CODEX_HOME/AGENTS.md`, and
`developer_instructions` is not written.

Why this file is the channel, and why no cap key is set
-------------------------------------------------------
Codex reads the global file whole: `CodexHomeUserInstructionsProvider::
load_from_codex_home` (`codex-rs/codex-home/src/instructions/mod.rs`) does a
whole-file `tokio::fs::read` with no `max_bytes` parameter and no truncate. The
`project_doc_max_bytes` budget (default 32 KiB, `DEFAULT_PROJECT_DOC_MAX_BYTES`
in `codex-rs/config/src/config_toml.rs`) is enforced only inside
`read_agents_md` / `load_project_instructions`
(`codex-rs/core/src/agents_md.rs`) over the PROJECT-chain entries — the global
file is seeded beforehand via `from_user_instructions` and never passes through
the budget. Measured on the installed Codex (`codex-cli 0.159.3`, source pins at
main content_hashes `5f900d53…` / `97427a87…`). So the installer sets NO
`project_doc_max_bytes` key and doctor performs no cap-size check: there is
nothing to raise.

Ownership and safety
--------------------
This module owns exactly one thing: `$CODEX_HOME/AGENTS.md`, whose content is
always the codex render byte-for-byte. It never writes `developer_instructions`.
A legacy `ADID_MANAGED` block left in config.toml by the retired (t54) installer
is swept on install/uninstall — a foreign value is never touched, only reported.
Writes are atomic (`_atomic_write`, LF, UTF-8).
"""

from __future__ import annotations

import hashlib
import os
import re
import tomllib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .addons_codex import CODEX_GATE_ADDONS
from .artifacts import DIST_CODEX, _atomic_write, write_artifacts
from .migration import LEGACY_RULE_MIGRATION, validate_migration
from .render import render_adapter, render_kernel
from .source import KERNEL
from .validate import validate_kernel

#: Markers of the RETIRED (t54) config.toml channel. Recognized only to sweep a
#: leftover managed block; never written anywhere by this module anymore.
MANAGED_OPEN = "<ADID_MANAGED"
MANAGED_CLOSE = "</ADID_MANAGED>"
FOREIGN_OPEN = "<LOCAL_DEVELOPER_ADDENDUM>"
FOREIGN_CLOSE = "</LOCAL_DEVELOPER_ADDENDUM>"

#: What a foreign addendum may and may not do (kept for reading legacy composed
#: values; new installs compose nothing).
FOREIGN_LIMIT = (
    "may specialize task behavior; may NOT weaken ADID governance, evidence, "
    "authority, oracle or closure invariants"
)


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def _resolve_home(home: Path | None) -> Path:
    return home if home is not None else codex_home()


def config_path(home: Path | None = None) -> Path:
    return _resolve_home(home) / "config.toml"


def agents_path(home: Path | None = None) -> Path:
    """The ONLY channel: the global instruction file Codex reads whole."""
    return _resolve_home(home) / "AGENTS.md"


def codex_kernel_text() -> str:
    """The exact bytes this installer owns: the codex variant render."""
    return render_kernel(KERNEL, CODEX_GATE_ADDONS, ())


def content_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _marker(version: str, digest: str) -> str:
    """Legacy (t54) marker format — recognized, never emitted."""
    return f'{MANAGED_OPEN} version="{version}" content-sha256="{digest}">'


def managed_block(version: str) -> str:
    """The exact bytes the RETIRED installer owned, markers included.

    Kept so tests can stage a legacy leftover and the sweeper can recognize it.
    """
    body = root_instructions()
    digest = content_hash(body)
    return f"{_marker(version, digest)}\n{body}{MANAGED_CLOSE}"


@dataclass(frozen=True)
class InstallReport:
    status: str  # INSTALLED | UNCHANGED | UNINSTALLED | NOT_CONFIGURED
    path: Path
    version: str
    digest: str
    detail: str = ""


def _split_managed(value: str) -> tuple[str, str, str]:
    """Split a legacy value into (before, managed block, after)."""
    start = value.find(MANAGED_OPEN)
    end = value.find(MANAGED_CLOSE)
    if start < 0 or end < start:
        return value, "", ""
    cut = end + len(MANAGED_CLOSE)
    return value[:start].rstrip(), value[start:cut], value[cut:].strip()


def _strip_foreign(value: str) -> str:
    """Foreign text outside our markers is never ours to delete."""
    return value.replace(FOREIGN_OPEN, "").replace(FOREIGN_CLOSE, "").strip()


def root_instructions() -> str:
    """ADID_CORE + CODEX_ROOT_ADAPTER, the two layers §7 composes.

    Legacy (t54) format: the body the retired installer wrapped in an
    ADID_MANAGED block inside `developer_instructions`. Kept for recognition
    (sweep + doctor two-channel check), never installed anymore.
    """

    core = render_kernel(KERNEL, (), ())
    adapter = render_adapter(CODEX_GATE_ADDONS)
    return f"<ADID_CORE>\n{core}</ADID_CORE>\n\n<CODEX_RUNTIME_ADAPTER>\n{adapter}\n</CODEX_RUNTIME_ADAPTER>\n"


def _read_config(path: Path) -> dict:
    if not path.is_file():
        return {}
    with path.open("rb") as handle:
        return tomllib.load(handle)


def _validate_rendered(version: str) -> str:
    errors = validate_kernel(KERNEL)
    if errors:
        raise RuntimeError("kernel validation failed: " + "; ".join(errors))
    migration_errors = validate_migration(tuple(LEGACY_RULE_MIGRATION), KERNEL)
    if migration_errors:
        raise RuntimeError("migration ledger failed: " + "; ".join(migration_errors))
    return version


def _sweep_legacy_config(config: Path) -> tuple[bool, str]:
    """Remove a legacy ADID_MANAGED block from config.toml; never touch foreign text.

    Returns (changed, note). A foreign `developer_instructions` is left
    byte-identical and reported in the note.
    """
    if not config.is_file():
        return False, ""
    try:
        data = _read_config(config)
    except tomllib.TOMLDecodeError:
        return False, f"{config.name} is not valid TOML; left alone"
    existing = data.get("developer_instructions")
    if not isinstance(existing, str) or MANAGED_OPEN not in existing:
        if isinstance(existing, str) and existing.strip():
            return False, "foreign developer_instructions preserved"
        return False, ""
    before, _, after = _split_managed(existing)
    # Foreign text on BOTH sides of the block is the operator's; only the block is ours.
    remaining = "\n\n".join(part for part in (_strip_foreign(before), _strip_foreign(after)) if part)
    original = config.read_text(encoding="utf-8")
    if remaining:
        pattern = re.compile(r"^[ \t]*developer_instructions\s*=.*$", re.MULTILINE)
        replacement = "developer_instructions = " + _toml_basic_string(remaining)
        text = pattern.sub(lambda _: replacement, original, count=1)
        note = "removed legacy ADID managed block; foreign developer_instructions kept"
    else:
        text = re.sub(r"^\s*developer_instructions\s*=.*\n?", "", original, flags=re.MULTILINE)
        note = "removed legacy ADID managed block"
    _atomic_write(config, text)
    return True, note


def _toml_basic_string(value: str) -> str:
    """Encode as a TOML BASIC string with escaped newlines.

    A multi-line literal (three quotes) is the readable choice and the wrong one:
    kernel prose and any foreign addendum may contain that sequence, and it would
    terminate the literal mid-value.
    """
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def install(*, home: Path | None = None) -> InstallReport:
    """Write $CODEX_HOME/AGENTS.md with the codex render. Never writes config keys.

    A legacy managed block in config.toml is swept (foreign values preserved);
    `developer_instructions` is never created.
    """
    base = _resolve_home(home)
    target = base / "AGENTS.md"
    kernel_version = _validate_rendered(KERNEL.version)
    write_artifacts(dist=DIST_CODEX, addons=CODEX_GATE_ADDONS, identity_addons=())
    body = codex_kernel_text()
    digest = content_hash(body)

    notes: list[str] = []
    if target.is_file() and target.read_bytes() == body.encode("utf-8"):
        agents_changed = False
    else:
        _atomic_write(target, body)
        agents_changed = True

    swept, note = _sweep_legacy_config(base / "config.toml")
    if note:
        notes.append(note)

    if not agents_changed and not swept:
        return InstallReport("UNCHANGED", target, kernel_version, digest, "AGENTS.md already current")
    if not agents_changed:
        notes.insert(0, "AGENTS.md already current")
    detail = "; ".join(notes)
    return InstallReport("INSTALLED", target, kernel_version, digest, detail)


def uninstall(*, home: Path | None = None) -> InstallReport:
    """Remove only what this installer wrote: a byte-equal AGENTS.md + legacy block."""
    base = _resolve_home(home)
    target = base / "AGENTS.md"
    removed = False
    notes: list[str] = []
    if target.is_file():
        if target.read_bytes() == codex_kernel_text().encode("utf-8"):
            target.unlink()
            removed = True
        else:
            notes.append("AGENTS.md is foreign; left alone")
    swept, note = _sweep_legacy_config(base / "config.toml")
    if note:
        notes.append(note)
    removed = removed or swept
    if not removed:
        return InstallReport(
            "NOT_CONFIGURED", target, "", "", "; ".join(notes) or "nothing ADID owns found"
        )
    return InstallReport("UNINSTALLED", target, "", "", "; ".join(notes) or "removed AGENTS.md")


def doctor(*, home: Path | None = None) -> list[tuple[str, str, str]]:
    """(check, status, detail) — the AGENTS.md channel report."""
    base = _resolve_home(home)
    agents = base / "AGENTS.md"
    config = base / "config.toml"
    rows: list[tuple[str, str, str]] = []
    rows.append(("CODEX_HOME", "PASS", str(base)))
    rows.append(("agents path", "PASS" if agents.is_file() else "NOT_CONFIGURED", str(agents)))
    agents_current = False
    if agents.is_file():
        body = codex_kernel_text()
        digest = hashlib.sha256(agents.read_bytes()).hexdigest()
        rows.append(("agents content hash", "PASS", digest))
        agents_current = digest == content_hash(body)
        rows.append(
            (
                "agents content current",
                "PASS" if agents_current else "WARN",
                "matches this kernel" if agents_current else "reinstall to refresh",
            )
        )
    if not config.is_file():
        rows.append(("config", "NOT_CONFIGURED", str(config)))
        return rows
    try:
        data = _read_config(config)
    except tomllib.TOMLDecodeError as error:
        rows.append(("config parse", "FAIL", str(error)))
        return rows
    rows.append(("config parse", "PASS", "valid TOML"))
    existing = data.get("developer_instructions")
    if isinstance(existing, str) and MANAGED_OPEN in existing:
        if agents_current:
            rows.append(
                (
                    "channels",
                    "FAIL",
                    "kernel in both AGENTS.md and developer_instructions; "
                    "reinstall to converge on AGENTS.md",
                )
            )
        else:
            rows.append(
                (
                    "legacy developer_instructions",
                    "WARN",
                    "retired channel still carries a managed block; reinstall to sweep it",
                )
            )
    elif isinstance(existing, str) and existing.strip():
        rows.append(
            ("developer_instructions", "PASS", "foreign value preserved; kernel loads from AGENTS.md only")
        )
    else:
        rows.append(("developer_instructions", "PASS", "absent; kernel loads from AGENTS.md only"))
    return rows


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()
