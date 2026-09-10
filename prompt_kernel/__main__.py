from __future__ import annotations

import sys

from .addons_claude import CLAUDE_GATE_ADDONS
from .artifacts import DIST, DIST_CLAUDE, write_artifacts
from .cutover import CLAUDE_KERNEL_PATH, PRODUCTION_PROMPT, install_claude_kernel, install_production
from .render import kernel_digest, render_kernel
from .source import KERNEL


def main() -> int:
    if "--claude" in sys.argv:
        review, runtime = write_artifacts(dist=DIST_CLAUDE, addons=CLAUDE_GATE_ADDONS)
        print(f"runtime={runtime}")
        print(f"review={review}")
        print(f"utf8_bytes={len(render_kernel(KERNEL, CLAUDE_GATE_ADDONS).encode('utf-8'))}")
        print(f"sha256={kernel_digest(KERNEL, CLAUDE_GATE_ADDONS)}")
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
