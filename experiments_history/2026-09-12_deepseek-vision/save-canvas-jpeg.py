"""Save the 65536-character canvas as JPEG (the format under test).

PNG was the wrong artifact to hand over - JPEG is what the probes actually send,
and its quality setting is the axis being studied.

Writes into experiments/2026-09-12_deepseek-vision/:
  canvas-65536chars-q95.jpg   near-lossless reference
  canvas-65536chars-q75.jpg   typical
  canvas-65536chars-q50.jpg   aggressive
  canvas-65536chars-q30.jpg
  canvas-65536chars-q20.jpg
  canvas-65536chars-q10.jpg
  canvas-65536chars-zoom-q75.jpg   top-left 48x24 cells at 8x zoom, q75

Same construction as the probes (seed 99): 2048x2048, 8x8 px per character,
256x256 = 65536 random digits, hand-coded 3x5 bitmap glyphs on a 1-bit canvas.

Run: python experiments/2026-09-12_deepseek-vision/save-canvas-jpeg.py
"""

from __future__ import annotations

import io
import pathlib
import random
from PIL import Image

DIR = pathlib.Path(__file__).resolve().parent
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
    gray = image.convert("L")
    grid = CANVAS // CELL

    print(f"canvas {CANVAS}x{CANVAS}, {CELL}x{CELL} px per char, {grid}x{grid} = {grid * grid} chars")
    print()
    for quality in (95, 75, 50, 30, 20, 10):
        path = DIR / f"canvas-65536chars-q{quality}.jpg"
        buffer = io.BytesIO()
        gray.convert("RGB").save(buffer, format="JPEG", quality=quality)
        path.write_bytes(buffer.getvalue())
        print(f"{path.name:34} {path.stat().st_size:>9} bytes")

    # Zoomed corner in JPEG too, so the glyphs are inspectable at 8x.
    cols, rows, factor = 48, 24, 8
    crop = gray.crop((0, 0, cols * CELL, rows * CELL))
    big = crop.resize((crop.width * factor, crop.height * factor), Image.NEAREST)
    zoom = DIR / "canvas-65536chars-zoom-q75.jpg"
    big.convert("RGB").save(zoom, format="JPEG", quality=75)
    print(f"{zoom.name:34} {zoom.stat().st_size:>9} bytes")

    first_row = "".join(digits[:grid])
    print()
    print(f"first row truth ({grid} digits):")
    print(first_row)


if __name__ == "__main__":
    main()
