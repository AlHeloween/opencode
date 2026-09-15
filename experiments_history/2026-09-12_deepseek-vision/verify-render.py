"""Local render check before spending API calls: is the 8x8-per-character canvas correct?

Dumps the first cells as ASCII art so the glyphs can be eyeballed as text (the
reliable channel here - an image attachment cannot be inspected numerically).

Also prints the file sizes at the two canvas sizes that matter:
  2048x2048 -> 256x256 cells = 65536 characters  (the user's spec)
  1280x1280 -> 160x160 cells = 25600 characters  (below the API's ~1.69M-pixel
             normalisation budget, so it is NOT server-downscaled)

Run: python experiments/2026-09-12_deepseek-vision/verify-render.py
"""

from __future__ import annotations

import io
import pathlib
import random
from PIL import Image

DIR = pathlib.Path(__file__).resolve().parent
OUT = DIR / "verify-render.txt"

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

lines: list[str] = []


def log(text: str = "") -> None:
    lines.append(text)


def render(canvas: int, cell: int, seed: int) -> tuple[Image.Image, list[str]]:
    grid = canvas // cell
    rng = random.Random(seed)
    digits = [str(rng.randint(0, 9)) for _ in range(grid * grid)]
    image = Image.new("1", (canvas, canvas), 1)
    px = image.load()
    gw, gh = 3, 5
    off_x, off_y = (cell - gw) // 2, (cell - gh) // 2
    for index, digit in enumerate(digits):
        cx = (index % grid) * cell + off_x
        cy = (index // grid) * cell + off_y
        for gy, rowbits in enumerate(GLYPHS[digit]):
            for gx, bit in enumerate(rowbits):
                if bit == "1":
                    px[cx + gx, cy + gy] = 0
    return image, digits


def ascii_dump(image: Image.Image, cells: int, cell: int, label: str) -> None:
    log(f"--- {label}: first {cells} cells, {cell}x{cell} px each ---")
    px = image.load()
    for y in range(cell):
        row = []
        for x in range(cells * cell):
            row.append("#" if px[x, y] == 0 else ".")
        log("".join(row))
    log("")


def main() -> None:
    for canvas, cell, seed in ((2048, 8, 99), (1280, 8, 99), (2048, 16, 99)):
        image, digits = render(canvas, cell, seed)
        grid = canvas // cell
        buffer = io.BytesIO()
        image.convert("L").save(buffer, format="PNG")
        png = buffer.getvalue()
        log(f"canvas={canvas} cell={cell} grid={grid} chars={grid * grid} png_bytes={len(png)}")
        ascii_dump(image, 16, cell, f"{canvas}/{cell}")
        log(f"first 16 digits truth = {''.join(digits[:16])}")
        log("")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
