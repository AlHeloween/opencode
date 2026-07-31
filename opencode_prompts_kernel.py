"""CLI shim for `python opencode_prompts_kernel.py --render-runtime OUT`.

Import as a library via the package directory `opencode_prompts_kernel/`.
"""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

if __name__ == "__main__":
    from opencode_prompts_kernel.__main__ import main

    main()
