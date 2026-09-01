from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from .render import kernel_digest, render_kernel, render_review
from .migration import LEGACY_RULE_MIGRATION, validate_migration
from .source import KERNEL


PACKAGE_ROOT = Path(__file__).resolve().parent
DIST = PACKAGE_ROOT / "dist"
STAMP_FORMAT = "%Y-%m-%d_%H-%M-%S"
STAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$")


def build_stamp(now: datetime | None = None) -> str:
    moment = now if now is not None else datetime.now().astimezone()
    return moment.strftime(STAMP_FORMAT)


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, text=True)
    staged = Path(temporary)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        staged.replace(path)
    finally:
        staged.unlink(missing_ok=True)


def write_artifacts(*, dist: Path | None = None, stamp: str | None = None) -> tuple[Path, Path]:
    dest = dist if dist is not None else DIST
    prefix = stamp if stamp is not None else build_stamp()
    if not STAMP_RE.fullmatch(prefix):
        raise ValueError(f"build stamp must be {STAMP_FORMAT}, got {prefix!r}")
    runtime = render_kernel(KERNEL)
    review = render_review(KERNEL)
    review_path = dest / f"{prefix}_reasoning_prompt.mdc"
    runtime_path = dest / f"{prefix}_reasoning_prompt.txt"
    _atomic_write(runtime_path, runtime)
    _atomic_write(review_path, review)
    _atomic_write(
        dest / f"{prefix}_manifest.json",
        json.dumps(
            {
                "kernel": KERNEL.name,
                "version": KERNEL.version,
                "sha256": kernel_digest(KERNEL),
                "utf8_bytes": len(runtime.encode("utf-8")),
                "stamp": prefix,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ) + "\n",
    )
    migration_errors = validate_migration(tuple(LEGACY_RULE_MIGRATION), KERNEL)
    if migration_errors:
        raise RuntimeError("migration ledger is invalid: " + "; ".join(migration_errors))
    _atomic_write(
        dest / f"{prefix}_migration_report.json",
        json.dumps(
            {name: asdict(decision) for name, decision in sorted(LEGACY_RULE_MIGRATION.items())},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ) + "\n",
    )
    return review_path, runtime_path
