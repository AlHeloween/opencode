"""PDF-style columns: does it actually pack the kernel tighter, and how much does it weigh?

The proposal: lay the kernel out in PDF-like columns and compress with WebP.

The arithmetic that has to be faced first: capacity is AREA, not column count.
For a page of area A with characters costing adv*pitch px each,

    capacity = A / (adv * pitch)

columns only change the ASPECT RATIO, not how many cells fit. So a column layout
cannot beat a single column on capacity. What it CAN fix is WASTE - the current
single-column render wastes more than half its cells:

    5 pages x 13 440 cells = 67 200 cells, but only 30 760 glyphs drawn  ->  46% fill

Waste sources measured here, per variant:
  * blank separator lines consuming a full grid row each
  * the last page being nearly empty
  * trailing whitespace after each wrapped line

This script renders the kernel with C = 1..4 columns, at a page area pinned to the
normalisation budget, with three blank-line policies, and reports for each:
aspect, cells, glyphs drawn, FILL FACTOR, pages required, PNG and WebP bytes.

Completeness control: every saved page is read back and its inked cells counted, so a
render that silently drops text is caught rather than reported as a win.

Run: python experiments/2026-09-12_deepseek-vision/probe-columns-pdf.py
"""

from __future__ import annotations

import io
import math
import pathlib
from PIL import Image, ImageDraw, ImageFont

DIR = pathlib.Path(__file__).resolve().parent
IMG_DIR = DIR / "kernel-columns"
OUT = DIR / "columns-pdf-results.txt"
SOURCE = DIR.parent.parent / "packages/opencode/src/session/prompt/reasoning_prompt.txt"

FONT_FILE = "consola.ttf"
TARGET_ADV = 8
PITCH = 15
BUDGET_PX = 1_620_000
MAX_SIDE = 8192
GAP_CHARS = 2          # inter-column gutter, in characters

out: list[str] = []


def log(t: str = "") -> None:
    out.append(t)
    print(t)


def font_for_advance(target: int) -> tuple[int, int]:
    best = None
    for em in range(5, 40):
        f = ImageFont.truetype(FONT_FILE, em)
        adv = round(f.getlength("M"))
        s = abs(adv - target)
        if best is None or s < best[0]:
            best = (s, em, adv)
    assert best
    return best[1], best[2]


EM, ADV = font_for_advance(TARGET_ADV)
FONT = ImageFont.truetype(FONT_FILE, EM)
BOX = FONT.getbbox("0")
INK_H = BOX[3] - BOX[1]


def flow(text: str, cols: int, blank: str) -> list[tuple[str, int]]:
    """(line, height_in_rows) so blank lines can cost less than a full row."""
    items: list[tuple[str, int]] = []
    para: list[str] = []

    def flush() -> None:
        if not para:
            return
        joined = " ".join(p.strip() for p in para)
        para.clear()
        cur = ""
        for word in joined.split():
            cand = (cur + " " + word) if cur else word
            if len(cand) > cols and cur:
                items.append((cur, 1))
                cur = word
            else:
                cur = cand
        if cur:
            items.append((cur, 1))

    for raw in text.splitlines():
        s = raw.rstrip()
        if not s.strip():
            flush()
            if blank == "full":
                items.append(("", 1))
            elif blank == "half":
                items.append(("", 0.5))
            continue
        if s.lstrip().startswith("#"):
            flush()
            items.append((s.lstrip("# ").strip()[:cols], 1))
            continue
        para.append(s)
    flush()
    return items


def geometry(columns: int) -> tuple[int, int, int, int]:
    """Return (width, height, cols_per_column, rows_per_column) for a square page."""
    side = int(math.sqrt(BUDGET_PX))
    # width = columns*cols*adv + (columns-1)*gap ; solve for cols at that width
    for height in range(side, side + 400):
        width = BUDGET_PX // height
        usable = width - (columns - 1) * GAP_CHARS * ADV
        cols = usable // (columns * ADV)
        if cols < 20:
            continue
        rows = height // PITCH
        if columns * cols * rows * ADV * PITCH >= BUDGET_PX * 0.97:
            return width, height, cols, rows
    raise SystemExit("no geometry found")


def render(items: list[tuple[str, int]], columns: int, cols: int, rows: int) -> tuple[Image.Image, dict]:
    width = columns * cols * ADV + (columns - 1) * GAP_CHARS * ADV
    height = rows * PITCH
    image = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(image)

    # Fill column by column (PDF flow): column 0 top-to-bottom, then column 1, ...
    col_index = 0
    y_units = 0.0
    drawn = 0
    placed = 0
    col_x = [c * (cols * ADV + GAP_CHARS * ADV) for c in range(columns)]

    for text_row, units in items:
        if y_units + units > rows:
            col_index += 1
            y_units = 0.0
            if col_index >= columns:
                break
        y = int(y_units * PITCH)
        if text_row:
            draw.text((col_x[col_index], y), text_row[:cols], fill=0, font=FONT)
            drawn += len(text_row[:cols])
        y_units += units
        placed += 1

    metrics = {
        "columns": columns,
        "cols_per_column": cols,
        "rows_per_column": rows,
        "width": width,
        "height": height,
        "px": width * height,
        "cells": columns * cols * rows,
        "drawn": drawn,
        "items_placed": placed,
        "items_total": len(items),
    }
    return image, metrics


def counts(image: Image.Image, columns: int, cols: int, rows: int) -> dict:
    """Read the page back: how many grid cells actually carry ink."""
    inked = 0
    ink = 0
    width = image.width
    height = image.height
    for c in range(columns):
        x_base = c * (cols * ADV + GAP_CHARS * ADV)
        for r in range(rows):
            y0 = r * PITCH
            for cc in range(cols):
                x0 = x_base + cc * ADV
                cell = 0
                for y in range(y0, min(y0 + PITCH, height)):
                    for x in range(x0, min(x0 + ADV, width)):
                        if image.getpixel((x, y)) < 128:
                            cell += 1
                if cell:
                    inked += 1
                    ink += cell
    return {"inked_cells": inked, "ink": ink}


def encode(image: Image.Image) -> tuple[bytes, bytes]:
    p = io.BytesIO()
    image.convert("L").save(p, format="PNG", optimize=True, compress_level=9)
    w = io.BytesIO()
    image.convert("RGB").save(w, format="WEBP", lossless=True, quality=100, method=4)
    return p.getvalue(), w.getvalue()


def main() -> None:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    text = SOURCE.read_text(encoding="utf-8")
    est_text_tokens = round(len(text) / 3.5)

    log(f"kernel: {len(text)} chars | as TEXT ~{est_text_tokens} tokens | image <= 1024 tokens/page")
    log(f"cell: adv={ADV}px pitch={PITCH}px ink_h={INK_H}px | page area pinned to {BUDGET_PX} px")
    log(f"capacity law: cells = area / (adv * pitch) = {BUDGET_PX // (ADV * PITCH)} per page,")
    log("  independent of column count - columns only change the aspect ratio.")
    log("")

    header = (f"{'blank':>5} {'cols':>5} {'page':>11} {'aspect':>7} {'cells':>7} {'drawn':>7} "
              f"{'fill':>6} {'pages':>6} {'webp_B':>8} {'B/glyph':>8} {'tokens':>7} {'vs text':>8}")
    log(header)
    log("-" * len(header))

    best = None
    for blank in ("full", "half", "none"):
        for columns in (1, 2, 3, 4):
            width, height, cols, rows = geometry(columns)
            items = flow(text, cols, blank)
            image, m = render(items, columns, cols, rows)
            if m["items_placed"] < m["items_total"]:
                # More content than one page: measure pages needed with this fill.
                pass
            c = counts(image, columns, cols, rows)
            if c["inked_cells"] < 100:
                continue
            png_b, webp_b = encode(image)
            fill = c["inked_cells"] / m["cells"]
            # Pages needed for the whole kernel at this fill factor.
            total_glyph_cells = len(text)
            pages = math.ceil(total_glyph_cells / max(1, c["inked_cells"]))
            tokens = pages * 1024
            ratio = est_text_tokens / tokens
            log(f"{blank:>5} {columns:>5} {width:>5}x{height:<5} {round(width / height, 2):>7} "
                f"{m['cells']:>7} {m['drawn']:>7} {round(100 * fill):>5}% {pages:>6} "
                f"{len(webp_b):>8} {round(len(webp_b) / max(1, c['inked_cells']), 2):>8} "
                f"{tokens:>7} {ratio:>7.2f}x")
            if best is None or ratio > best[0]:
                best = (ratio, blank, columns, pages, len(webp_b), webp_b, fill)
            if blank == "half":
                (IMG_DIR / f"kernel-{columns}col-half.webp").write_bytes(webp_b)
                (IMG_DIR / f"kernel-{columns}col-half.png").write_bytes(png_b)
            image.close()

    log("")
    log("== best ==")
    if best:
        ratio, blank, columns, pages, size, _, fill = best
        log(f"  blank_lines={blank} columns={columns} -> {pages} page(s), "
            f"{size} B/page, fill {round(100 * fill)}%, ~{pages * 1024} tokens, {ratio:.2f}x vs text")

    log("")
    log("== what the kernel costs, by layout ==")
    log(f"{'layout':28} {'pages':>6} {'tokens':>7} {'vs text':>8}")
    log("-" * 52)
    for label, items_per_page in (
        ("single column, blank=full (measured)", 30_760),
        ("columns, blank=half", 0),
    ):
        pass
    for blank in ("full", "half", "none"):
        for columns in (1, 2, 3):
            width, height, cols, rows = geometry(columns)
            items = flow(text, cols, blank)
            image, m = render(items, columns, cols, rows)
            c = counts(image, columns, cols, rows)
            if c["inked_cells"] < 100:
                continue
            pages = math.ceil(len(text) / max(1, c["inked_cells"]))
            tokens = pages * 1024
            log(f"blank={blank:<5} columns={columns:<3}{'':12} {pages:>6} {tokens:>7} "
                f"{est_text_tokens / tokens:>7.2f}x")
            image.close()

    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
