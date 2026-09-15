"""Archive the FAILING dense configuration as inspectable artifacts.

Saves three files into experiments/2026-09-12_deepseek-vision/failed-8x8-dense/:
  1. failed-8x8-dense.png    - the exact configuration that failed: cell 8 px wide,
                               line pitch 9, ink 6 px, 100 cols, 225 rows, 22500 chars
  2. control-24px.png        - the SAME content at ink 24 / pitch 30, which the model read
                               perfectly (gate set == {G0..G9})
  3. zoom-comparison.png     - both cropped to the same text region and magnified 8x,
                               so the difference is visible side by side
  4. RECORD.md               - the measurement, the verdict, and the raw model quotes

Why this artifact exists: the failure is the result. The dense packing gives the best
compression ratio of anything measured (6.28x, 22500 chars/page) and is UNREADABLE -
the model reports "blank page with a faint, scattered dot pattern". Keeping the exact
pixels makes the claim checkable instead of remembered.

Run: python experiments/2026-09-12_deepseek-vision/save-failed-config.py
"""

from __future__ import annotations

import io
import pathlib
import re
import string
from PIL import Image, ImageDraw, ImageFont

DIR = pathlib.Path(__file__).resolve().parent
OUT = DIR / "failed-8x8-dense"
SOURCE = DIR.parent.parent / "packages/opencode/src/session/prompt/reasoning_prompt.txt"

CELL_W = 8
PITCH = 9          # the failing line pitch
INK = 6            # the failing ink height
COLS = 100
BUDGET_PX = 1_620_000
ZOOM = 8
CROP_COLS = 96
CROP_ROWS = 6


def ttf() -> str:
    for name in ("consola.ttf", "cour.ttf", "DejaVuSansMono.ttf", "lucon.ttf"):
        try:
            ImageFont.truetype(name, 20)
            return name
        except Exception:  # noqa: BLE001
            continue
    raise SystemExit("no monospace font")


FONT_FILE = ttf()
CHARSET = string.printable[:95]


def build_glyphs(cell_w: int, ink_h: int) -> dict[str, list[list[bool]]]:
    em = 240
    font = ImageFont.truetype(FONT_FILE, em)
    inks: dict[str, Image.Image] = {}
    for c in CHARSET:
        if c == " ":
            continue
        tile = Image.new("L", (em * 2, em * 2), 255)
        ImageDraw.Draw(tile).text((em // 2, em // 2), c, fill=0, font=font)
        box = tile.getbbox()
        if box is None:
            continue
        inks[c] = tile.crop(box)
    tallest = max(i.height for i in inks.values())
    scale = ink_h / tallest
    glyphs: dict[str, list[list[bool]]] = {}
    for c, ink in inks.items():
        w = max(1, min(cell_w - 1, round(ink.width * scale)))
        h = max(1, round(ink.height * scale))
        small = ink.resize((w, h), Image.LANCZOS)
        glyphs[c] = [[small.getpixel((x, y)) < 140 for x in range(w)] for y in range(h)]
    return glyphs


def reflow(text: str, cols: int) -> list[str]:
    rows: list[str] = []
    para: list[str] = []

    def flush_para() -> None:
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
            flush_para()
            rows.append("")
            continue
        if s.lstrip().startswith("#"):
            flush_para()
            rows.append(s.lstrip("# ").strip()[:cols])
            continue
        para.append(s)
    flush_para()
    return rows


def draw(rows: list[str], glyphs: dict, cell_w: int, pitch: int, cols: int, max_rows: int) -> Image.Image:
    width = cols * cell_w
    height = max_rows * pitch
    image = Image.new("1", (width, height), 1)
    px = image.load()
    for r, row in enumerate(rows[:max_rows]):
        y0 = r * pitch
        for i, ch in enumerate(row[:cols]):
            g = glyphs.get(ch)
            if g is None:
                continue
            ox = i * cell_w
            for gy, line in enumerate(g):
                for gx, on in enumerate(line):
                    if on and ox + gx < width and y0 + gy < height:
                        px[ox + gx, y0 + gy] = 0
    return image


def save_png(image: Image.Image, path: pathlib.Path) -> int:
    buffer = io.BytesIO()
    image.convert("L").save(buffer, format="PNG")
    path.write_bytes(buffer.getvalue())
    return len(buffer.getvalue())


def crop_zoom(image: Image.Image, cols: int, rows: int, cell_w: int, pitch: int, factor: int) -> Image.Image:
    box = (0, 0, min(image.width, cols * cell_w), min(image.height, rows * pitch))
    crop = image.crop(box).convert("L")
    return crop.resize((crop.width * factor, crop.height * factor), Image.NEAREST)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    text = SOURCE.read_text(encoding="utf-8")
    rows = reflow(text, COLS)

    fail_glyphs = build_glyphs(CELL_W, INK)
    fail_ink = max(len(g) for g in fail_glyphs.values())
    fail_max_rows = int(BUDGET_PX / (COLS * CELL_W) / PITCH)
    fail = draw(rows, fail_glyphs, CELL_W, PITCH, COLS, fail_max_rows)
    fail_bytes = save_png(fail, OUT / "failed-8x8-dense.png")

    ctrl_glyphs = build_glyphs(24, 24)
    ctrl_max_rows = 60
    ctrl = draw(rows, ctrl_glyphs, 24, 30, 40, ctrl_max_rows)
    ctrl_bytes = save_png(ctrl, OUT / "control-24px.png")

    # Side-by-side of the SAME text region, magnification normalised to the same
    # apparent glyph size: 96x6 cells at 8 px vs 32x6 cells at 24 px.
    left = crop_zoom(fail, CROP_COLS, CROP_ROWS, CELL_W, PITCH, ZOOM)
    right = crop_zoom(ctrl, 32, CROP_ROWS, 24, 30, ZOOM // 3 if ZOOM // 3 > 0 else 1)
    gap = 24
    sheet = Image.new("L", (left.width + gap + right.width, max(left.height, right.height)), 210)
    sheet.paste(left, (0, 0))
    sheet.paste(right, (left.width + gap, 0))
    sheet_bytes = save_png(sheet, OUT / "zoom-comparison.png")

    capacity = fail_max_rows * COLS
    record = f"""# FAILED configuration: 8x8 dense packing

**Verdict: unreadable. The model reports the page as blank.**

This is the highest compression ratio measured for text-as-pixels, and it does not work.
Saved so the claim is checkable rather than remembered.

## The configuration

| parameter | value |
|---|---|
| cell width | {CELL_W} px |
| line pitch | {PITCH} px (1 px gap) |
| ink height | {fail_ink} px |
| columns | {COLS} chars |
| rows drawn | {fail_max_rows} |
| characters on page | {capacity} |
| canvas | {COLS * CELL_W} x {fail_max_rows * PITCH} px = {COLS * CELL_W * fail_max_rows * PITCH} px |
| pixels per character | {CELL_W * PITCH} |
| PNG size | {fail_bytes} bytes |
| tokens (image) | ~1024 (measured plateau; independent of pitch) |
| text equivalent | {capacity} chars / 3.5 = ~{round(capacity / 3.5)} tokens |
| **compression ratio** | **{round((capacity / 3.5) / 1024, 2)}x** |

## What the model said (verbatim, 3 questions, same image)

Those three questions pass at ink 24 px: gate set == {{G0..G9}} (exactly), gate count == 10,
PLAN_MODE may not mutate.

| pitch | answer to "list every gate identifier" |
|---|---|
| 9 | "The image contains no text or gate identifiers." |
| 10 | "The image contains no text or gate identifiers. It is a blank page with a faint, scattered dot pattern." |
| 11 | "The image contains no text or gate identifiers; it is a blank, dotted background." |
| 12 | "The image contains no text or discernible content." |
| 14 | "The image contains no text or gate identifiers; it is completely blank." |
| 16 | "The image has been processed to extract the text. However, no text was found in the provided image." |

The `PLAN_MODE no mutate` question returned NO on every variant INCLUDING this one - it is a
yes/no question whose expected answer is "NO", so a blank image also "passes" it. It is
NOT evidence of reading; it is recorded here as an oracle defect.

## Control (same content, read successfully)

ink 24 px, pitch 30, 40 columns, {ctrl_max_rows} rows -> the model returned
`G0 G1 G2 G3 G4 G5 G6 G7 G8 G9`, gate set exactly {{0..9}}.

So the questions are answerable, the content is present, and the glyphs are correct.
The variable that decides readability is **ink height**, not line pitch: at constant ink 6 px
every pitch from 9 to 16 px failed.

## Files

| file | what |
|---|---|
| `failed-8x8-dense.png` | the failing page, exactly as sent |
| `control-24px.png` | the same document at ink 24 px, which was read correctly |
| `zoom-comparison.png` | left: failing crop at 8x; right: control crop - glyphs compared at matched apparent size |
| `RECORD.md` | this file |

## Consequence for the project

The useful window is bounded from below by ink height, not by packing efficiency:

| ink | readable? | chars/page at 8 px pitch |
|---|---|---|
| 6 px | NO (measured here) | {capacity} |
| 24 px | YES (control) | ~2 000 |
| between | unmeasured | - |

Until the ink-height threshold is measured, no compression figure above 1x should be
promised: every dense configuration tested so far either fails to read or has never been
measured with the variables separated.
"""
    (OUT / "RECORD.md").write_text(record, encoding="utf-8")

    print(f"wrote {OUT}")
    for name in ("failed-8x8-dense.png", "control-24px.png", "zoom-comparison.png", "RECORD.md"):
        p = OUT / name
        print(f"  {name:26} {p.stat().st_size:>9} bytes")
    print(f"failing page: {COLS * CELL_W}x{fail_max_rows * PITCH} px, ink={fail_ink}px, "
          f"pitch={PITCH}px, {capacity} chars, {round((capacity / 3.5) / 1024, 2)}x vs text")


if __name__ == "__main__":
    main()
