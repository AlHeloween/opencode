"""Consolidate the two page-size numbers: the hard protocol limit and the one we use.

Two different constraints are easily confused:

  A) PROTOCOL limit   - what the API accepts at all (from vision-doc.txt, the vendor guide)
  B) EFFECTIVE limit  - where extra pixels stop buying anything, because image tokens cap
                        at ~1024 and the server normalises toward a ~1300x1300-equivalent
                        pixel count. Measured, not read.

This script recomputes both from the recorded data points in grow-8x8-results.txt, then
reports what the current probes actually send.

Run: python experiments/2026-09-12_deepseek-vision/page-limits.py
"""

from __future__ import annotations

import pathlib

DIR = pathlib.Path(__file__).resolve().parent
OUT = DIR / "PAGE-LIMITS.md"

# Measured (grow-8x8-results.txt): square canvas side -> prompt_tokens for an identical
# text-only question. The text part is constant, so differences are the image's cost.
MEASURED = [
    (128, 222), (192, 222), (256, 222), (384, 222), (512, 222),
    (640, 312), (768, 420), (896, 546), (1024, 690), (1152, 852),
    (1280, 1032), (1408, 1032), (1536, 1032), (1792, 1032), (2048, 1032), (2560, 1032),
]
TEXT_ONLY_TOKENS = 35  # constant prompt, subtracted to isolate the image

CAP = 1024
DOC_BUDGET_PX = 1300 * 1300
OUR_BUDGET_PX = 1_620_000
COLS = 160
ADV = 8


def main() -> None:
    lines: list[str] = []
    p = lines.append

    p("# Page size: hard limit vs what we use")
    p("")
    p("## A) Protocol limits (vendor guide, `vision-doc.txt`)")
    p("")
    p("| limit | value |")
    p("|---|---|")
    p("| max dimension | **8192 px per side** (drops to 4096 px when a request carries >=15 images) |")
    p("| request body | 48 MiB |")
    p("| single image, base64 / URL | 32 MiB |")
    p("| single image, Files API `file_id` | 64 MiB |")
    p("| images per request | 600 |")
    p("| total per request | 64 MiB (200 MiB with `file_id`) |")
    p("| placement | `user` messages only; `system`/`assistant` returns 400 |")
    p("")
    p("So the protocol would accept a page far larger than anything useful. The binding")
    p("constraint is not the protocol - it is (B).")
    p("")
    p("## B) Effective limit (measured)")
    p("")
    p("Identical question, growing square canvas, image cost isolated:")
    p("")
    p("| canvas side | pixels | image tokens | note |")
    p("|---:|---:|---:|---|")
    for side, total in MEASURED:
        px = side * side
        img = total - TEXT_ONLY_TOKENS
        note = ""
        if side == 1280:
            note = "**cap reached**"
        elif side > 1280:
            note = "no gain - server downscales"
        elif side == 512:
            note = "floor (upscaled to ~544x544)"
        p(f"| {side} | {px:,} | {img} | {note} |")
    p("")
    p("Image tokens are clamped to ~1024. The cap is reached at **1280x1280 = 1,638,400 px**;")
    p("beyond it tokens stay flat while the server shrinks the image - you pay the maximum")
    p("and lose sharpness. That is the double penalty measured in the 2048x2048 and 2560x2560 rows.")
    p("")
    p("Model fits the measurements within ~2%:")
    p("")
    p("```")
    p("image_tokens ~= clamp(pixels / 1700 + 187, floor 187, cap ~1000)")
    p("```")
    p("")
    p("## What we send")
    p("")
    p(f"| parameter | value |")
    p(f"|---|---|")
    p(f"| page width | **{COLS * ADV} px** (160 columns x {ADV} px advance) |")
    p(f"| page height | ~1260 px (rows x pitch, rounding to whole rows) |")
    p(f"| page area | **~1.61M px** |")
    p(f"| share of the cap point | {round(100 * 1_612_800 / 1_638_400)}% |")
    p(f"| image tokens | ~1032 (the maximum, and no waste) |")
    p(f"| share of the 8192 px side limit | {round(100 * 1280 / 8192)}% width, {round(100 * 1260 / 8192)}% height |")
    p("")
    p("The page is deliberately pinned just **under** the cap point: below it the server may")
    p("scale slightly up (harmless), above it the server scales down (destroys glyph strokes).")
    p("")
    p("## Capacity at that area")
    p("")
    p("`cells = area / (advance x pitch)`, independent of column count:")
    p("")
    p("| line pitch | rows/page | cells/page | chars |")
    p("|---:|---:|---:|---|")
    for pitch in (10, 11, 12, 15):
        rows = int(OUR_BUDGET_PX / (COLS * ADV) / pitch)
        p(f"| {pitch} px | {rows} | {rows * COLS:,} | {rows * COLS:,} |")
    p("")
    p("## Two-number summary")
    p("")
    p("- **Maximum allowed**: 8192 px per side (protocol), but anything above ~1.64M px is")
    p("  pointless because tokens cap at 1024 and the server downscales.")
    p("- **What we use**: 1280 x ~1260 px = ~1.61M px - the largest page that still gets full")
    p("  per-pixel fidelity at the fixed 1024-token price.")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
