from __future__ import annotations

import hashlib
from pathlib import Path

from .artifacts import DIST, _atomic_write, write_artifacts
from .compatibility import compatibility_report
from .render import render_kernel
from .migration import LEGACY_RULE_MIGRATION, validate_migration
from .source import KERNEL
from .validate import validate_kernel

REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_PROMPT = (
    REPO_ROOT / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.txt"
)


def cutover(
    production_path: Path,
    *,
    expected_current_sha256: str,
    approve: bool = False,
    source: Path | None = None,
    dist: Path | None = None,
) -> str:
    if not approve:
        raise PermissionError("cutover requires explicit approval")
    if not production_path.is_file():
        raise FileNotFoundError(production_path)
    current = production_path.read_text(encoding="utf-8")
    current_digest = hashlib.sha256(production_path.read_bytes()).hexdigest()
    if current_digest.lower() != expected_current_sha256.lower():
        raise RuntimeError(f"production hash mismatch: expected {expected_current_sha256}, got {current_digest}")
    errors = validate_kernel(KERNEL)
    if errors:
        raise RuntimeError("kernel validation failed: " + "; ".join(errors))
    migration_errors = validate_migration(tuple(LEGACY_RULE_MIGRATION), KERNEL)
    if migration_errors:
        raise RuntimeError("migration ledger failed: " + "; ".join(migration_errors))
    if source is None:
        _, runtime_path = write_artifacts(dist=dist if dist is not None else DIST)
        runtime = runtime_path.read_text(encoding="utf-8")
    else:
        runtime = source.read_text(encoding="utf-8")
        if runtime != render_kernel(KERNEL):
            raise RuntimeError(f"reviewed artifact drifted from renderer: {source}")
    report = compatibility_report(current, runtime)
    if report["missing_from_next"]:
        raise RuntimeError(f"kernel compatibility gap: {report['missing_from_next']}")
    _atomic_write(production_path, runtime)
    return hashlib.sha256(runtime.encode("utf-8")).hexdigest()


def install_production(*, production_path: Path | None = None, dist: Path | None = None) -> str:
    dest = production_path if production_path is not None else PRODUCTION_PROMPT
    errors = validate_kernel(KERNEL)
    if errors:
        raise RuntimeError("kernel validation failed: " + "; ".join(errors))
    migration_errors = validate_migration(tuple(LEGACY_RULE_MIGRATION), KERNEL)
    if migration_errors:
        raise RuntimeError("migration ledger failed: " + "; ".join(migration_errors))
    _, runtime_path = write_artifacts(dist=dist if dist is not None else DIST)
    runtime = runtime_path.read_text(encoding="utf-8")
    if runtime != render_kernel(KERNEL):
        raise RuntimeError(f"stamped artifact drifted from renderer: {runtime_path}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(dest, runtime)
    return hashlib.sha256(runtime.encode("utf-8")).hexdigest()
