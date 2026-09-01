from __future__ import annotations

import sys

from .artifacts import DIST, write_artifacts
from .cutover import PRODUCTION_PROMPT, install_production
from .render import kernel_digest, render_kernel
from .source import KERNEL


def main() -> int:
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
