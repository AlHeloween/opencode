"""Verify the 65536-character canvas by decoding it pixel-by-pixel.

Not an assertion - a check. The saved image is read back and every cell is
decoded into a digit from its pixels, then compared against the generator's
ground truth. If the file really holds 65536 digits at an 8x8 pitch, every cell
decodes and every digit matches.

Also tabulates what this content costs in each format: bytes/char and bits/pixel,
which is the information-compression question.

Run: python experiments/2026-09-12_deepseek-vision/verify-count.py
"""

from __future__ import annotations

import pathlib
import random
from PIL import Image

DIR = pathlib.Path(__file__).resolve().parent
PNG = DIR / "canvas-65536chars-2048.png"
OUT = DIR / "verify-count.txt"

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
REVERSE = {tuple(pattern): digit for digit, pattern in GLYPHS.items()}

lines: list[str] = []


def log(text: str = "") -> None:
    lines.append(text)


def main() -> None:
    grid = CANVAS // CELL
    total = grid * grid

    rng = random.Random(SEED)
    expected = [str(rng.randint(0, 9)) for _ in range(total)]

    image = Image.open(PNG).convert("L")
    px = image.load()
    off_x, off_y = (CELL - 3) // 2, (CELL - 5) // 2

    log(f"file        : {PNG.name} ({PNG.stat().st_size} bytes)")
    log(f"canvas      : {image.width}x{image.height} = {image.width * image.height} pixels")
    log(f"cell pitch  : {CELL}x{CELL} px  ->  {grid}x{grid} cells = {total} characters")
    log("")

    decoded = 0
    empty_cells = 0
    mismatched = 0
    outside_ink = 0

    for index in range(total):
        cx = (index % grid) * CELL + off_x
        cy = (index // grid) * CELL + off_y
        rows = []
        for gy in range(5):
            row = "".join("1" if px[cx + gx, cy + gy] < 128 else "0" for gx in range(3))
            rows.append(row)
        digit = REVERSE.get(tuple(rows))
        if digit is None:
            empty_cells += 1
            continue
        decoded += 1
        if digit != expected[index]:
            mismatched += 1

    # Any ink outside the glyph area would mean cells bleed into each other.
    for y in range(CANVAS):
        for x in range(CANVAS):
            if px[x, y] >= 128:
                continue
            local_x = x % CELL
            local_y = y % CELL
            inside = off_x <= local_x < off_x + 3 and off_y <= local_y < off_y + 5
            if not inside:
                outside_ink += 1

    log(f"cells decoded from pixels : {decoded} / {total}")
    log(f"cells with no glyph       : {empty_cells}")
    log(f"digits matching truth     : {decoded - mismatched} / {total}")
    log(f"digit mismatches          : {mismatched}")
    log(f"ink pixels outside glyphs : {outside_ink}")
    log("")

    # Information per character, per format.
    log("format cost for this content:")
    log(f"{'file':34} {'bytes':>9} {'B/char':>8} {'bits/pixel':>11}")
    files = [PNG] + sorted(DIR.glob("canvas-65536chars-q*.jpg"))
    for path in files:
        size = path.stat().st_size
        log(f"{path.name:34} {size:>9} {round(size / total, 2):>8} {round(size * 8 / (CANVAS * CANVAS), 4):>11}")

    log("")
    log("first row decoded from the image (256 digits):")
    log("".join(expected[:grid]))
    log("")
    log("first row re-read from pixels:")
    row = []
    for index in range(grid):
        cx = index * CELL + off_x
        cy = off_y
        rows = ["".join("1" if px[cx + gx, cy + gy] < 128 else "0" for gx in range(3)) for gy in range(5)]
        row.append(REVERSE.get(tuple(rows), "?"))
    log("".join(row))

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
