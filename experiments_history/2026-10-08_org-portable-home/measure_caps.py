"""Measure the kernel size axes the cap tests assert (for their comment lines)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompt_kernel import KERNEL, render_kernel  # noqa: E402
from prompt_kernel.addons import GATE_ADDONS  # noqa: E402
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS  # noqa: E402
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS  # noqa: E402
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS  # noqa: E402
from prompt_kernel.dedup import normalized_token_count  # noqa: E402


def pre_action_bytes(text: str) -> int:
    total = 0
    for gate in ("G0", "G1"):
        block = text[text.index(f"<{gate}_RULES>") : text.index(f"</{gate}_RULES>")]
        total += len(block.encode("utf-8"))
    return total


for name, addons in (
    ("product", GATE_ADDONS),
    ("claude", CLAUDE_GATE_ADDONS),
    ("codex", CODEX_GATE_ADDONS),
    ("cursor", CURSOR_GATE_ADDONS),
):
    text = render_kernel(KERNEL, addons, ())
    print(f"{name}: tokens={normalized_token_count(text)} bytes={len(text.encode('utf-8'))}"
          + (f" g0g1_bytes={pre_action_bytes(text)}" if name == "product" else ""))
