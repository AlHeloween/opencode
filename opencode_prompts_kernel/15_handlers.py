"""Kernel fragment: 15_handlers (former monofile L1461-1484)."""


class PreconditionMismatch(Exception):
    """§6.6 Target identity changed after approval."""
    pass


def handle_target_change(precondition_ok: bool) -> None:
    """Target changes after approval -> STALE, new revision."""
    if not precondition_ok:
        raise PreconditionMismatch("Target identity changed. Mark STALE. Create new revision.")


def handle_rollback_artifact_missing(artifact_available: bool) -> None:
    """Rollback artifact missing -> report, don't mutate."""
    if not artifact_available:
        raise RuntimeError("Rollback artifact missing. Cannot execute original mutation.")


def handle_rollback_concurrent_modification(current_matches_expected: bool) -> None:
    """Rollback target changed concurrently -> don't overwrite."""
    if not current_matches_expected:
        raise PreconditionMismatch("Rollback target changed concurrently. Do not overwrite.")


