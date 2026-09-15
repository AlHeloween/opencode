"""8192x8192 page: how many columns fit, and what the server does to them.

The protocol allows 8192 px per side. This computes what that actually buys at our
cell geometry (adv 8 px, ink 9 px), and compares against the measured budget point
(1,638,400 px = 1280x1280, where image tokens hit the ~1024 cap).

Two quantities move in opposite directions:
  capacity  = area / (adv * pitch)   - grows with area, linearly
  fidelity  = sqrt(budget / area)    - shrinks once area exceeds the budget, because
                                       the server normalises toward it

Run: python experiments/2026-09-12_deepseek-vision/calc-8192.py
"""

from __future__ import annotations

import math
import pathlib

OUT = pathlib.Path(__file__).resolve().parent / "PAGE-8192.md"

SIDE = 8192
ADV = 8
INK_H = 9
BUDGET_PX = 1_638_400          # measured: image tokens cap here
PITCHES = (10, 11, 12, 15)
OUR_WIDTH = 1280               # what we actually send
OUR_COLS = 160

lines: list[str] = []


def main() -> None:
    P = lines.append
    area = SIDE * SIDE
    ratio = area / BUDGET_PX
    downscale = math.sqrt(ratio)
    chars_across = SIDE // ADV
    rows_11 = SIDE // 11
    per_page = (BUDGET_PX // (OUR_COLS * ADV * 11)) * OUR_COLS
    pages = ratio
    tokens = pages * 1024
    total_chars = pages * per_page
    as_text = total_chars / 3.5

    P("# An 8192 x 8192 page: capacity vs what survives")
    P("")
    P("| quantity | value |")
    P("|---|---|")
    P(f"| page | {SIDE} x {SIDE} px |")
    P(f"| area | {area:,} px |")
    P(f"| vs measured budget ({BUDGET_PX:,} px) | **{ratio:.1f}x over** |")
    P(f"| server downscale factor | **{downscale:.2f}x** |")
    P(f"| advance after downscale | {ADV} px -> **{ADV / downscale:.2f} px** |")
    P(f"| ink height after downscale | {INK_H} px -> **{INK_H / downscale:.2f} px** |")
    P("| image tokens | ~1024 (capped - you pay the maximum) |")
    P("")

    P("## Characters across the width")
    P("")
    P(f"`{SIDE} / {ADV}` = **{chars_across} characters**.")
    P("")
    P("How many columns that makes depends only on the column width you choose:")
    P("")
    P("| column width | columns that fit |")
    P("|---:|---:|")
    for cwidth in (80, 128, 160, 200, 256, 512, 1024):
        P(f"| {cwidth} chars | {chars_across // cwidth} |")
    P("")

    P("## Capacity if nothing were downscaled")
    P("")
    P("| line pitch | rows | characters per page | columns of 160 |")
    P("|---:|---:|---:|---:|")
    for pitch in PITCHES:
        rows = SIDE // pitch
        chars = rows * chars_across
        P(f"| {pitch} px | {rows} | {chars:,} | {chars // OUR_COLS} |")
    P("")

    P("## What actually arrives at the model")
    P("")
    P(f"The server normalises toward the budget, rescaling by 1/{downscale:.2f}:")
    P(f"the {INK_H} px ink becomes **{INK_H / downscale:.2f} px**, the {ADV} px advance becomes")
    P(f"**{ADV / downscale:.2f} px**. Both are far below the measured threshold - ink 6 px read")
    P("as 'a faint, scattered dot pattern', while ink 9 px at 1280 px width read correctly.")
    P("So a 41x over-budget page arrives as noise, at the full token price.")
    P("")

    P("## Many correct pages instead of one giant one")
    P("")
    P("| approach | characters | tokens | readable |")
    P("|---|---:|---:|---|")
    P(f"| one 8192 page | ~{total_chars:,.0f} nominal | ~1024 | **no** (downscaled {downscale:.1f}x) |")
    P(f"| {pages:.1f} pages of {OUR_WIDTH} px, pitch 11 | ~{total_chars:,.0f} | ~{tokens:,.0f} | yes |")
    P(f"| the same text as raw tokens | ~{total_chars:,.0f} | ~{as_text:,.0f} | n/a |")
    P(f"| **pages vs text** | | **{as_text / tokens:.2f}x cheaper** | |")
    P("")

    P("## Summary")
    P("")
    P(f"- At 8192 px with an 8 px advance: **{chars_across} characters across** "
      f"= {chars_across // OUR_COLS} columns of {OUR_COLS}, or {chars_across // 256} columns of 256.")
    P(f"- Vertically at pitch 11: {rows_11} rows, so ~{rows_11 * chars_across:,} characters nominal.")
    P(f"- But it is {ratio:.0f}x over budget, the server shrinks it {downscale:.1f}x, and glyphs")
    P(f"  arrive ~{ADV / downscale:.1f} px wide. Unreadable at the maximum token price.")
    P(f"- The usable page is **{OUR_WIDTH} px = {OUR_COLS} characters across = one column**.")
    P("  More columns means more pages, not more pixels.")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
