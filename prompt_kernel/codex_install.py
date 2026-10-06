"""Install ADID into Codex as a GLOBAL developer-instruction layer.

Why this file exists, and why it writes where it writes
-------------------------------------------------------
Codex loads `developer_instructions` from the USER-level config
(`$CODEX_HOME/config.toml`, default `~/.codex/config.toml`) as a `developer`
role message, before any project document. Measured on codex v0.159.3:

  - user scope    -> arrives, as role=developer. Proven twice: a marker placed in
    `$CODEX_HOME/config.toml` shows up in the session rollout as a developer
    message ahead of the prompt.
  - project scope -> IGNORED. A marker in `<project>/.codex/config.toml` does not
    reach the prompt, in a trusted project as well as an untrusted one, even
    while other keys of that same file are read (codex warns about the ones it
    drops by name). So project config cannot shadow this key, and ADID installed
    at user scope cannot be overridden by a project's own config.

`~/.codex/AGENTS.md` is NOT a substitute for this: the project's own `AGENTS.md`
is read as a project document under `project_doc_max_bytes` (32 KiB default,
truncating silently), which is why the kernel is installed here instead of being
merged into any AGENTS.md.

Ownership and safety
--------------------
This module owns exactly one thing: a marked block inside the
`developer_instructions` string. It never rewrites the rest of the config, never
touches another key, and refuses to install over a foreign value unless compose
is requested explicitly. Writes are transactional: the candidate is written to a
temporary file, re-parsed, and only then moved into place; any failure leaves the
original bytes untouched.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import tempfile
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

MANAGED_OPEN = "<ADID_MANAGED"
MANAGED_CLOSE = "</ADID_MANAGED>"
FOREIGN_OPEN = "<LOCAL_DEVELOPER_ADDENDUM>"
FOREIGN_CLOSE = "</LOCAL_DEVELOPER_ADDENDUM>"

#: What a foreign addendum may and may not do. It sits inside ADID's own block,
#: so the limit is stated where the text is read rather than only in the core.
FOREIGN_LIMIT = (
    "may specialize task behavior; may NOT weaken ADID governance, evidence, "
    "authority, oracle or closure invariants"
)


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def config_path() -> Path:
    return codex_home() / "config.toml"


def root_instructions() -> str:
    """ADID_CORE + CODEX_ROOT_ADAPTER, the two layers §7 composes.

    The core carries no tool names; the adapter binds each capability this
    runtime provides. Rendering them as two labelled sections keeps the boundary
    inspectable — a reader can tell which text is portable and which is local.
    """
    core = render_kernel(KERNEL, (), ())
    adapter = render_adapter(CODEX_GATE_ADDONS)
    return f"<ADID_CORE>\n{core}</ADID_CORE>\n\n<CODEX_RUNTIME_ADAPTER>\n{adapter}\n</CODEX_RUNTIME_ADAPTER>\n"


def content_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _marker(version: str, digest: str) -> str:
    return f'{MANAGED_OPEN} version="{version}" content-sha256="{digest}">'


def managed_block(version: str) -> str:
    """The exact bytes this kernel version owns, markers included."""
    body = root_instructions()
    digest = content_hash(body)
    return f"{_marker(version, digest)}\n{body}{MANAGED_CLOSE}"


@dataclass(frozen=True)
class InstallReport:
    status: str  # INSTALLED | UNCHANGED | FOREIGN | NOT_CONFIGURED
    path: Path
    version: str
    digest: str
    detail: str = ""


def _split_managed(value: str) -> tuple[str, str, str]:
    """Split a value into (before, managed block, after).

    The third part matters: a composed foreign addendum sits AFTER the closing
    marker, so an uninstall that kept only the head would silently destroy the
    operator's own text while reporting that it had preserved it.
    """
    start = value.find(MANAGED_OPEN)
    end = value.find(MANAGED_CLOSE)
    if start < 0 or end < start:
        return value, "", ""
    cut = end + len(MANAGED_CLOSE)
    return value[:start].rstrip(), value[start:cut], value[cut:].strip()


def _strip_foreign(value: str) -> str:
    """Foreign text outside our markers is never ours to delete."""
    return value.replace(FOREIGN_OPEN, "").replace(FOREIGN_CLOSE, "").strip()


def _compose(foreign: str, block: str) -> str:
    if not foreign:
        return block
    return f"{block}\n\n{FOREIGN_OPEN}\n{foreign}\n\n{FOREIGN_LIMIT}.\n{FOREIGN_CLOSE}"


def _read_config(path: Path) -> dict:
    if not path.is_file():
        return {}
    with path.open("rb") as handle:
        return tomllib.load(handle)


def _encode_value(value: str) -> str:
    """Encode as a TOML BASIC string with escaped newlines.

    A multi-line literal (three quotes) is the readable choice and the wrong one:
    kernel prose and any foreign addendum may contain that sequence, and it would
    terminate the literal mid-value.
    """
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def _splice(text: str, value: str) -> str:
    """Set `developer_instructions` at TOML TOP LEVEL, replacing it in place.

    Appending to the end of the file looks right and is not: every key after the
    last table header belongs to that table. A config ending in
    `[projects.'D:\\x']` would swallow our key as a project setting — read back as
    `projects.developer_instructions`, invisible to codex and to our own doctor.
    So a missing key goes BEFORE the first table header.
    """
    line = f"developer_instructions = {_encode_value(value)}"
    pattern = re.compile(r"^[ \t]*developer_instructions\s*=.*$", re.MULTILINE)
    if pattern.search(text):
        return pattern.sub(lambda _: line, text, count=1)
    table = re.search(r"^[ \t]*\[", text, re.MULTILINE)
    if table is None:
        body = text if not text or text.endswith("\n") else text + "\n"
        return body + line + "\n"
    head, tail = text[: table.start()], text[table.start() :]
    head = head if not head or head.endswith("\n") else head + "\n"
    return f"{head}\n{line}\n{tail}"


def _validate_rendered(version: str) -> str:
    errors = validate_kernel(KERNEL)
    if errors:
        raise RuntimeError("kernel validation failed: " + "; ".join(errors))
    migration_errors = validate_migration(tuple(LEGACY_RULE_MIGRATION), KERNEL)
    if migration_errors:
        raise RuntimeError("migration ledger failed: " + "; ".join(migration_errors))
    return version


def install(*, compose: bool = False, version: str | None = None, path: Path | None = None) -> InstallReport:
    """Install (or refresh) the managed block. Never partial, never implicit."""
    target = path if path is not None else config_path()
    kernel_version = _validate_rendered(version or KERNEL.version)
    write_artifacts(dist=DIST_CODEX, addons=CODEX_GATE_ADDONS, identity_addons=())
    block = managed_block(kernel_version)
    digest = content_hash(root_instructions())

    # BYTES, not text: on Windows a text round-trip rewrites CRLF as LF, so a
    # rollback that re-writes the original as text is not a rollback. The
    # promise is byte-identical, so the copy is bytes.
    original_bytes = target.read_bytes() if target.is_file() else None
    original = original_bytes.decode("utf-8") if original_bytes is not None else ""
    data = _read_config(target) if target.is_file() else {}
    existing = data.get("developer_instructions")

    if isinstance(existing, str) and existing.strip():
        before, current_block, after = _split_managed(existing)
        if current_block and current_block == block:
            return InstallReport("UNCHANGED", target, kernel_version, digest, "managed block already current")
        foreign = _strip_foreign(f"{before}\n{after}").strip()
        if foreign and not compose:
            return InstallReport(
                "FOREIGN",
                target,
                kernel_version,
                digest,
                "existing developer_instructions is foreign and was NOT overwritten; "
                "re-run with compose to keep it under <LOCAL_DEVELOPER_ADDENDUM>",
            )
        value = _compose(foreign, block)
    else:
        value = block

    candidate_text = _splice(original, value)

    # Transaction: stage, re-parse, then move. A parse failure here means the
    # candidate would be an invalid config, and it never reaches the real file.
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, staged_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".candidate", dir=target.parent)
    staged = Path(staged_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(candidate_text)
        with staged.open("rb") as check:
            tomllib.load(check)
        staged.replace(target)
    except Exception:
        if original_bytes is None:
            target.unlink(missing_ok=True)
        else:
            target.write_bytes(original_bytes)
        raise
    finally:
        staged.unlink(missing_ok=True)

    return InstallReport("INSTALLED", target, kernel_version, digest)


def uninstall(*, path: Path | None = None) -> InstallReport:
    """Remove only ADID's block. Everything else in the config is preserved."""
    target = path if path is not None else config_path()
    if not target.is_file():
        return InstallReport("NOT_CONFIGURED", target, "", "", "no config.toml")
    data = _read_config(target)
    existing = data.get("developer_instructions")
    if not isinstance(existing, str) or MANAGED_OPEN not in existing:
        return InstallReport("NOT_CONFIGURED", target, "", "", "no ADID managed block present")
    before, _, after = _split_managed(existing)
    # Foreign text on BOTH sides of the block is the operator's; only the block is ours.
    remaining = "\n\n".join(part for part in (_strip_foreign(before), _strip_foreign(after)) if part)
    original = target.read_text(encoding="utf-8")
    if remaining:
        text = _splice(original, remaining)
    else:
        text = re.sub(r"^\s*developer_instructions\s*=.*\n?", "", original, flags=re.MULTILINE)
    _atomic_write(target, text)
    return InstallReport("UNINSTALLED", target, "", "", "removed ADID block; other keys untouched")


def doctor(*, path: Path | None = None) -> list[tuple[str, str, str]]:
    """(check, status, detail) — the report §23 asks for, as data."""
    target = path if path is not None else config_path()
    rows: list[tuple[str, str, str]] = []
    rows.append(("CODEX_HOME", "PASS", str(codex_home())))
    rows.append(("config path", "PASS" if target.is_file() else "NOT_CONFIGURED", str(target)))
    if not target.is_file():
        return rows
    try:
        data = _read_config(target)
    except tomllib.TOMLDecodeError as error:
        rows.append(("config parse", "FAIL", str(error)))
        return rows
    rows.append(("config parse", "PASS", "valid TOML"))
    existing = data.get("developer_instructions")
    if not isinstance(existing, str) or MANAGED_OPEN not in existing:
        rows.append(("ADID root developer instructions", "NOT_CONFIGURED", "developer_instructions absent"))
    else:
        _, block, _ = _split_managed(existing)
        marker = re.match(rf"{re.escape(MANAGED_OPEN)} version=\"([^\"]+)\" content-sha256=\"([0-9a-f]{{64}})\">", block)
        if not marker:
            rows.append(("ADID block marker", "FAIL", "marker is not parseable"))
        else:
            version, digest = marker.group(1), marker.group(2)
            # The block is `marker + "\n" + body + CLOSE`, so the body starts after
            # exactly one newline. Slicing the marker alone keeps that newline and
            # hashes a string the installer never produced — a FAIL on a healthy install.
            body = block[len(marker.group(0)) :].removeprefix("\n")[: -len(MANAGED_CLOSE)]
            rows.append(("ADID version", "PASS", version))
            rows.append(("ADID content hash", "PASS" if content_hash(body) == digest else "FAIL", digest))
            current = digest == content_hash(root_instructions())
            rows.append(
                ("ADID content current", "PASS" if current else "WARN", "matches this kernel" if current else "reinstall to refresh")
            )
    return rows


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()