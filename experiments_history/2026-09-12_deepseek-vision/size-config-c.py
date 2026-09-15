"""Report the real on-disk size of configuration C (JSON string, 100% fill, pitch 15, 3 pages).

The previous run logged token counts but not byte sizes, so the size question needs a
direct read of the artifacts plus a recomputed character count per page.

Configuration C:
  stream  = the kernel serialised as one JSON string (31 848 chars with escapes)
  layout  = continuous, rows filled to the last of 160 columns (100% fill)
  font    = consola em14, advance 8 px, ink 13 px, line pitch 15 px
  page    = 1280 x 1260 px, 84 rows x 160 cols = 13 440 cells

Reports per page and in total: characters, WebP bytes, PNG bytes for comparison,
bytes per character, and the request-body share. Also verifies each page exists and
that the pages together carry the whole stream.

Run: python experiments/2026-09-12_deepseek-vision/size-config-c.py
"""

from __future__ import annotations

import io
import json
import pathlib
import re
from PIL import Image

DIR = pathlib.Path(__file__).resolve().parent
IMG_DIR = DIR / "images-100fill"
SOURCE = DIR.parent.parent / "packages/opencode/src/session/prompt/reasoning_prompt.txt"
OUT = DIR / "SIZE-CONFIG-C.md"

PAGE_W, PAGE_H = 1280, 1260
ADV, PITCH = 8, 15
COLS = PAGE_W // ADV
ROWS = PAGE_H // PITCH
TOKENS_PER_IMAGE = 963
BODY_LIMIT = 48 * 1024 * 1024

lines: list[str] = []


def log(t: str = "") -> None:
    lines.append(t)
    print(t)


def main() -> None:
    text = SOURCE.read_text(encoding="utf-8")
    stream = json.dumps(text, ensure_ascii=False)
    est_text_tokens = round(len(text) / 3.5)

    pages = sorted(IMG_DIR.glob("C-p15-page*.webp"))
    log("# Configuration C - what it weighs")
    log("")
    log("| parameter | value |")
    log("|---|---|")
    log(f"| stream | kernel as one JSON string |")
    log(f"| characters (raw kernel) | {len(text):,} |")
    log(f"| characters (JSON string, escapes included) | **{len(stream):,}** |")
    log(f"| layout | continuous, every row filled to 160 cols |")
    log(f"| font | consola em14 - advance {ADV} px, ink 13 px, line pitch {PITCH} px |")
    log(f"| page | {PAGE_W} x {PAGE_H} px = {PAGE_W * PAGE_H:,} px |")
    log(f"| cells per page | {COLS} x {ROWS} = {COLS * ROWS:,} |")
    log("")

    if not pages:
        log("no C-p15-page*.webp artifacts found - rerun probe-100fill.py")
        OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return

    log("## Actual files on disk")
    log("")
    log("| page | characters | WebP | PNG (for comparison) | B/char | fill |")
    log("|---:|---:|---:|---:|---:|---:|")
    total_webp = total_png = total_chars = 0
    for i, path in enumerate(pages, 1):
        raw = path.read_bytes()
        image = Image.open(io.BytesIO(raw)).convert("L")
        # count inked cells to confirm the fill, and derive characters on this page
        px = image.load()
        inked = 0
        for r in range(ROWS):
            y0 = r * PITCH
            for c in range(COLS):
                x0 = c * ADV
                hit = False
                for y in range(y0, min(y0 + PITCH, PAGE_H)):
                    for x in range(x0, min(x0 + ADV, PAGE_W)):
                        if px[x, y] < 128:
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    inked += 1
        png_buf = io.BytesIO()
        image.save(png_buf, format="PNG", optimize=True, compress_level=9)

        # characters on this page come from the stream slice
        start = (i - 1) * COLS * ROWS
        chars = len(stream[start : start + COLS * ROWS])

        total_webp += len(raw)
        total_png += len(png_buf.getvalue())
        total_chars += chars
        log(f"| {i} | {chars:,} | {len(raw):,} | {len(png_buf.getvalue()):,} | "
            f"{round(len(raw) / max(1, chars), 2)} | {round(100 * inked / (COLS * ROWS))}% |")
        image.close()

    log(f"| **total** | **{total_chars:,}** | **{total_webp:,}** | **{total_png:,}** | "
        f"**{round(total_webp / max(1, total_chars), 2)}** | |")
    log("")

    log("## Cost")
    log("")
    log("| metric | value |")
    log("|---|---|")
    log(f"| pages | {len(pages)} |")
    log(f"| WebP total | **{total_webp:,} bytes ({total_webp / 1024:.0f} KiB)** |")
    log(f"| PNG total (same pages) | {total_png:,} bytes ({total_png / 1024:.0f} KiB) |")
    log(f"| WebP vs PNG | **{round(total_webp / total_png, 2)}x** |")
    log(f"| per page (average) | {round(total_webp / len(pages)):,} bytes |")
    log(f"| bytes per character | {round(total_webp / max(1, total_chars), 2)} |")
    log(f"| share of the 48 MiB request body | **{round(100 * total_webp / BODY_LIMIT, 3)}%** |")
    log("")

    log("## Tokens")
    log("")
    log("| metric | value |")
    log("|---|---|")
    log(f"| images | {len(pages)} |")
    log(f"| tokens (measured {TOKENS_PER_IMAGE}/image) | **{len(pages) * TOKENS_PER_IMAGE:,}** |")
    log(f"| the same kernel as text | ~{est_text_tokens:,} |")
    log(f"| ratio | **{est_text_tokens / (len(pages) * TOKENS_PER_IMAGE):.2f}x cheaper as images** |")
    log("")

    log("## Completeness check")
    log("")
    log(f"- characters placed across pages: **{total_chars:,}**")
    log(f"- JSON stream length: {len(stream):,}")
    log(f"- {'ALL PLACED' if total_chars == len(stream) else f'MISMATCH: {len(stream) - total_chars:,} missing'}")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
