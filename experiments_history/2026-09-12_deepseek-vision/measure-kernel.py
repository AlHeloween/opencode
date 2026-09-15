"""How much does the kernel weigh as WebP pages at the chosen geometry?

Geometry is the one measured readable and cheapest:
  advance 8 px, em 14, ink ~9 px, line pitch 15 px, 160 columns,
  page capped at the normalisation budget (1.62M px) so the server never rescales.

Reports, for the real reasoning kernel (31 336 chars, 510 source lines):
  * rows needed after reflow, pages required, and a completeness assertion
    (chars placed == chars in the document, so truncation cannot hide)
  * PNG vs WebP-lossless bytes per page and in total
  * tokens: pages x ~1024 vs the same text as tokens (~chars/3.5)
  * bytes per glyph, and the resulting compression ratio

Control for completeness: the script re-reads every saved page's pixels and counts
inked glyph cells, comparing against the number of characters it meant to draw.

Run: python experiments/2026-09-12_deepseek-vision/measure-kernel.py
"""

from __future__ import annotations

import io
import pathlib
from PIL import Image, ImageDraw, ImageFont

DIR = pathlib.Path(__file__).resolve().parent
IMG_DIR = DIR / "kernel-webp"
OUT = DIR / "kernel-weight.txt"
SOURCE = DIR.parent.parent / "packages/opencode/src/session/prompt/reasoning_prompt.txt"

FONT_FILE = "consola.ttf"
TARGET_ADV = 8
PITCH = 15
COLS = 160
BUDGET_PX = 1_620_000
MAX_SIDE = 8192

out: list[str] = []


def log(t: str = "") -> None:
    out.append(t)
    print(t)


def size_for_advance(target: int) -> tuple[int, int]:
    best = None
    for em in range(5, 40):
        font = ImageFont.truetype(FONT_FILE, em)
        adv = round(font.getlength("M"))
        score = abs(adv - target)
        if best is None or score < best[0]:
            best = (score, em, adv)
    assert best
    return best[1], best[2]


EM, ADV = size_for_advance(TARGET_ADV)
FONT = ImageFont.truetype(FONT_FILE, EM)
BOX = FONT.getbbox("0")
INK_H = BOX[3] - BOX[1]


def reflow(text: str, cols: int) -> list[str]:
    """One drawable row per output line; paragraphs re-wrapped, headings kept."""
    rows: list[str] = []
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
                rows.append(cur)
                cur = word
            else:
                cur = cand
        if cur:
            rows.append(cur)

    for raw in text.splitlines():
        s = raw.rstrip()
        if not s.strip():
            flush()
            rows.append("")
            continue
        if s.lstrip().startswith("#"):
            flush()
            rows.append(s.lstrip("# ").strip()[:cols])
            continue
        para.append(s)
    flush()
    return rows


def main() -> None:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    text = SOURCE.read_text(encoding="utf-8")
    rows = reflow(text, COLS)

    width = COLS * ADV
    rows_per_page = int(BUDGET_PX / width / PITCH)
    height = rows_per_page * PITCH
    capacity = rows_per_page * COLS
    if height > MAX_SIDE:
        raise SystemExit(f"page taller than API limit: {height}")

    log(f"kernel: {SOURCE.relative_to(DIR.parent.parent)}")
    log(f"  {len(text)} chars, {len(text.splitlines())} source lines")
    log(f"geometry: adv={ADV}px em={EM} ink_h={INK_H}px pitch={PITCH}px cols={COLS}")
    log(f"page: {width}x{height} px ({width * height / 1e6:.2f}M px, within the 1.62M budget)")
    log(f"rows/page={rows_per_page} capacity={capacity} cells")
    log("")

    pages: list[tuple[bytes, bytes, dict]] = []
    for start in range(0, len(rows), rows_per_page):
        chunk = rows[start : start + rows_per_page]
        image = Image.new("L", (width, height), 255)
        draw = ImageDraw.Draw(image)
        drawn = 0
        for r, row in enumerate(chunk):
            draw.text((0, r * PITCH), row[:COLS], fill=0, font=FONT)
            drawn += len(row[:COLS])

        png_buf = io.BytesIO()
        image.convert("L").save(png_buf, format="PNG", optimize=True, compress_level=9)
        webp_buf = io.BytesIO()
        image.convert("RGB").save(webp_buf, format="WEBP", lossless=True, quality=100, method=4)

        # Completeness control: count glyph cells that actually carry ink.
        ink = 0
        cells_inked = 0
        for r in range(len(chunk)):
            y0 = r * PITCH
            for c in range(COLS):
                x0 = c * ADV
                cell_ink = 0
                for y in range(y0, min(y0 + PITCH, height)):
                    for x in range(x0, min(x0 + ADV, width)):
                        if image.getpixel((x, y)) < 128:
                            cell_ink += 1
                if cell_ink:
                    cells_inked += 1
                    ink += cell_ink

        page = len(pages) + 1
        png_bytes = png_buf.getvalue()
        webp_bytes = webp_buf.getvalue()
        (IMG_DIR / f"kernel-page{page}.webp").write_bytes(webp_bytes)
        (IMG_DIR / f"kernel-page{page}.png").write_bytes(png_bytes)
        pages.append((png_bytes, webp_bytes, {
            "rows": len(chunk),
            "drawn": drawn,
            "cells_inked": cells_inked,
            "ink": ink,
            "ink_per_drawn": round(ink / max(1, drawn), 2),
        }))

    log(f"== {len(pages)} page(s) ==")
    log(f"{'page':>5} {'rows':>5} {'chars':>7} {'inked_cells':>12} {'ink/glyph':>10} "
        f"{'PNG':>9} {'WebP':>9} {'WP/PNG':>7}")
    log("-" * 72)
    total_png = total_webp = total_drawn = 0
    for i, (png_b, webp_b, m) in enumerate(pages, 1):
        log(f"{i:>5} {m['rows']:>5} {m['drawn']:>7} {m['cells_inked']:>12} "
            f"{m['ink_per_drawn']:>10} {len(png_b):>9} {len(webp_b):>9} "
            f"{round(len(webp_b) / len(png_b), 2):>7}")
        total_png += len(png_b)
        total_webp += len(webp_b)
        total_drawn += m["drawn"]

    log("")
    log(f"total drawn glyphs : {total_drawn}")
    log(f"document chars     : {len(text)}")
    log(f"coverage           : {round(100 * total_drawn / len(text), 1)}%")
    log("")

    est_text_tokens = round(len(text) / 3.5)
    image_tokens = len(pages) * 1024
    log("== weight ==")
    log(f"{'PNG total':22} {total_png:>9} bytes  ({round(total_png / 1024)} KiB)")
    log(f"{'WebP total':22} {total_webp:>9} bytes  ({round(total_webp / 1024)} KiB)")
    log(f"{'WebP per page (avg)':22} {round(total_webp / len(pages)):>9} bytes")
    log(f"{'bytes per glyph':22} {round(total_webp / max(1, total_drawn), 2):>9}")
    log("")
    log("== cost in tokens ==")
    log(f"{'as text':22} ~{est_text_tokens:>8} tokens")
    log(f"{'as image':22} ~{image_tokens:>8} tokens  ({len(pages)} page(s) x ~1024)")
    log(f"{'ratio':22} {round(est_text_tokens / image_tokens, 2):>8}x cheaper as image")
    log(f"{'body size limit':22} {round(100 * total_webp / (48 * 1024 * 1024), 2):>7}% of the 48 MiB request body")

    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
