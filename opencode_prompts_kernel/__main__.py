"""CLI: python -m opencode_prompts_kernel [--render-runtime PATH]"""
from __future__ import annotations

import sys

from opencode_prompts_kernel import run_conformance, write_runtime_kernel


def main(argv: list[str] | None = None) -> None:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) >= 2 and argv[0] == "--render-runtime":
        write_runtime_kernel(argv[1])
        return
    run_conformance()


if __name__ == "__main__":
    main()
