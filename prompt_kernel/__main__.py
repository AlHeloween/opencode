from __future__ import annotations

import sys
import hashlib

from .addons_claude import CLAUDE_GATE_ADDONS
from .addons_codex import CODEX_GATE_ADDONS
from .addons_cursor import CURSOR_GATE_ADDONS, render_cursor_rule
from .artifacts import DIST, DIST_CLAUDE, DIST_CODEX, DIST_CURSOR, write_artifacts
from .cutover import (
    CLAUDE_KERNEL_PATH,
    CODEX_KERNEL_PATH,
    CURSOR_KERNEL_PATH,
    PRODUCTION_PROMPT,
    install_claude_kernel,
    install_codex_kernel,
    install_cursor_kernel,
    install_production,
)
from .render import kernel_digest, render_kernel
from .source import KERNEL


def main() -> int:
    if "--cursor" in sys.argv:
        review, runtime = write_artifacts(dist=DIST_CURSOR, addons=CURSOR_GATE_ADDONS, identity_addons=())
        print(f"runtime={runtime}")
        print(f"review={review}")
        print(f"utf8_bytes={len(render_kernel(KERNEL, CURSOR_GATE_ADDONS, ()).encode('utf-8'))}")
        print(f"sha256={kernel_digest(KERNEL, CURSOR_GATE_ADDONS, ())}")
        print(f"dist={DIST_CURSOR}")
        if "--install" in sys.argv:
            digest = install_cursor_kernel(kernel_path=CURSOR_KERNEL_PATH, dist=DIST_CURSOR)
            print(f"cursor_rule={CURSOR_KERNEL_PATH}")
            print(f"installed={digest}")
            print(f"receiver_sha256={hashlib.sha256(render_cursor_rule(runtime.read_text(encoding='utf-8')).encode('utf-8')).hexdigest()}")
            return 0
        print(f"cursor_rule=not_updated; python -m prompt_kernel --cursor --install to refresh {CURSOR_KERNEL_PATH}")
        return 0

    if "--codex" in sys.argv:
        review, runtime = write_artifacts(dist=DIST_CODEX, addons=CODEX_GATE_ADDONS, identity_addons=())
        print(f"runtime={runtime}")
        print(f"review={review}")
        print(f"utf8_bytes={len(render_kernel(KERNEL, CODEX_GATE_ADDONS, ()).encode('utf-8'))}")
        print(f"sha256={kernel_digest(KERNEL, CODEX_GATE_ADDONS, ())}")
        print(f"dist={DIST_CODEX}")
        if "--install" in sys.argv:
            digest = install_codex_kernel(kernel_path=CODEX_KERNEL_PATH, dist=DIST_CODEX)
            print(f"codex_kernel={CODEX_KERNEL_PATH}")
            print(f"installed={digest}")
            return 0
        print(f"codex_kernel=not_updated; python -m prompt_kernel --codex --install to refresh {CODEX_KERNEL_PATH}")
        return 0

    if "--claude" in sys.argv:
        review, runtime = write_artifacts(dist=DIST_CLAUDE, addons=CLAUDE_GATE_ADDONS, identity_addons=())
        print(f"runtime={runtime}")
        print(f"review={review}")
        print(f"utf8_bytes={len(render_kernel(KERNEL, CLAUDE_GATE_ADDONS, ()).encode('utf-8'))}")
        print(f"sha256={kernel_digest(KERNEL, CLAUDE_GATE_ADDONS, ())}")
        print(f"dist={DIST_CLAUDE}")
        if "--install" in sys.argv:
            digest = install_claude_kernel()
            print(f"claude_kernel={CLAUDE_KERNEL_PATH}")
            print(f"installed={digest}")
            return 0
        print(
            f"claude_kernel=not_updated; python -m prompt_kernel --claude --install"
            f" to refresh {CLAUDE_KERNEL_PATH.name} (imported by .claude/CLAUDE.md)"
        )
        return 0
    review, runtime = write_artifacts()
    print(f"runtime={runtime}")
    print(f"review={review}")
    print(f"utf8_bytes={len(render_kernel(KERNEL).encode('utf-8'))}")
    print(f"sha256={kernel_digest(KERNEL)}")
    print(f"dist={DIST}")
    if "--install" in sys.argv:
        digest = install_production()
        print(f"production={PRODUCTION_PROMPT}")
        print(f"installed={digest}")
        print("working_copy=updated")
        return 0
    print(f"working_copy=not_updated; python -m prompt_kernel --install to copy {runtime.name} into production")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
