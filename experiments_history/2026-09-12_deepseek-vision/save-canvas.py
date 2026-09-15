"""Save the 65536-character canvas for human inspection.

Two artifacts land in the experiment directory:
  canvas-65536chars-2048.png   the real test image (2048x2048, 8x8 px per char)
  canvas-65536chars-zoom.png   top-left 48x24 cells at 8x, for eyeballing glyphs

Same construction the probes use (seed 99): a hand-coded 3x5 bitmap font on a
1-bit canvas, one random digit per 8x8 cell, 256x256 = 65536 characters.

Run: python experiments/2026-09-12_deepseek-vision/save-canvas.py
"""

from __future__ import annotations

import pathlib
import random
from PIL import Image

DIR = pathlib.Path(__file__).resolve().parent
FULL = DIR / "canvas-65536chars-2048.png"
ZOOM = DIR / "canvas-65536chars-zoom.png"

CANVAS = 2048
CELL = 8
SEED = 99

GLYPHS = {
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "001", "001", "001"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
}


def render(canvas: int, cell: int, seed: int) -> tuple[Image.Image, list[str]]:
    grid = canvas // cell
    rng = random.Random(seed)
    digits = [str(rng.randint(0, 9)) for _ in range(grid * grid)]
    image = Image.new("1", (canvas, canvas), 1)
    px = image.load()
    off_x, off_y = (cell - 3) // 2, (cell - 5) // 2
    for index, digit in enumerate(digits):
        cx = (index % grid) * cell + off_x
        cy = (index // grid) * cell + off_y
        for gy, rowbits in enumerate(GLYPHS[digit]):
            for gx, bit in enumerate(rowbits):
                if bit == "1":
                    px[cx + gx, cy + gy] = 0
    return image, digits


def main() -> None:
    image, digits = render(CANVAS, CELL, SEED)
    image.convert("L").save(FULL, format="PNG")

    grid = CANVAS // CELL
    cols, rows, factor = 48, 24, 8
    crop = image.crop((0, 0, cols * CELL, rows * CELL)).convert("L")
    big = crop.resize((crop.width * factor, crop.height * factor), Image.NEAREST)
    big.save(ZOOM, format="PNG")

    first_row = "".join(digits[: grid])
    print(f"full : {FULL.name} {FULL.stat().st_size} bytes  ({CANVAS}x{CANVAS}, {grid}x{grid} = {grid * grid} chars, {CELL}x{CELL} px/cell)")
    print(f"zoom : {ZOOM.name} {ZOOM.stat().st_size} bytes  (top-left {cols}x{rows} cells at {factor}x)")
    print(f"first row truth ({grid} digits):")
    print(first_row)
    pathlib.Path(DIR / "canvas-first-row.txt").write_text(first_row + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
