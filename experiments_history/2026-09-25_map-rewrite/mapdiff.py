"""Read-only A/B stand for the gate-map rewrite.

Renders the CANDIDATE kernel from prompt_kernel/source.py and reads the INSTALLED
artifact from packages/opencode/src/session/prompt/reasoning_prompt.txt, then diffs
the map block (gates + forward_move + CONCERN + back_move + terminal) line by line
and reports the byte cost of the change.

Measuring only: this script never writes into the repo and never installs.

    python experiments/2026-09-25_map-rewrite/mapdiff.py
"""

from __future__ import annotations

import difflib
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from prompt_kernel.render import render_kernel  # noqa: E402
from prompt_kernel.source import KERNEL  # noqa: E402

INSTALLED = ROOT / "packages/opencode/src/session/prompt/reasoning_prompt.txt"
MAP_END = "## 1. ABI_AND_VOCABULARY"


def map_block(text: str) -> list[str]:
    """The map is everything from `gates:` to the ABI header."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line == "gates:")
    end = next(i for i, line in enumerate(lines) if line.startswith(MAP_END))
    return lines[start:end]


def doors(block: list[str]) -> list[str]:
    return [line for line in block if "WAITING_APPROVAL;" in line]


def main() -> int:
    candidate = render_kernel()
    installed = INSTALLED.read_text(encoding="utf-8")

    old, new = map_block(installed), map_block(candidate)
    print("== map diff: installed -> candidate ==")
    changed = False
    for line in difflib.unified_diff(old, new, "installed", "candidate", lineterm="", n=1):
        if not line.startswith(("---", "+++", "@@")):
            changed = True
        print(line)
    if not changed:
        print("(no change)")

    print()
    print("== bytes ==")
    for name, text in (("installed", installed), ("candidate", candidate)):
        size = len(text.encode("utf-8"))
        print(f"{name:<10} {size:>6}  free {KERNEL.utf8_budget - size:>5}  (budget {KERNEL.utf8_budget})")
    delta = len(candidate.encode("utf-8")) - len(installed.encode("utf-8"))
    print(f"{'delta':<10} {delta:>+6}")

    print()
    print("== the priced doors ==")
    print(f"installed: {len(doors(old))} WAITING_APPROVAL edges")
    for line in doors(old):
        print(f"  - {line.strip()}")
    print(f"candidate: {len(doors(new))} WAITING_APPROVAL edges")
    for line in doors(new):
        print(f"  + {line.strip()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
