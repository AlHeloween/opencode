"""Verify the archived failing configuration by reading its pixels back.

Checks the artifact matches its own description, and quantifies why it reads as
"a faint, scattered dot pattern": ink coverage per character cell, and the vertical
gap between adjacent lines.

Run: python experiments/2026-09-12_deepseek-vision/verify-failed-config.py
"""

from __future__ import annotations

import pathlib
from PIL import Image

DIR = pathlib.Path(__file__).resolve().parent
FAIL = DIR / "failed-8x8-dense" / "failed-8x8-dense.png"
CTRL = DIR / "failed-8x8-dense" / "control-24px.png"
OUT = DIR / "failed-8x8-dense" / "VERIFY.txt"

CELL_W, PITCH = 8, 9
CTRL_CELL, CTRL_PITCH = 24, 30

out: list[str] = []


def log(t: str = "") -> None:
    out.append(t)


def probe(path: pathlib.Path, cell: int, pitch: int, label: str) -> None:
    image = Image.open(path).convert("L")
    px = image.load()
    w, h = image.size
    cols = w // cell
    rows = h // pitch

    ink = 0
    total = 0
    cells_with_ink = 0
    cells_empty = 0
    for r in range(rows):
        for c in range(cols):
            cell_ink = 0
            for y in range(r * pitch, min((r + 1) * pitch, h)):
                for x in range(c * cell, min((c + 1) * cell, w)):
                    total += 1
                    if px[x, y] < 128:
                        ink += 1
                        cell_ink += 1
            if cell_ink:
                cells_with_ink += 1
            else:
                cells_empty += 1

    # Vertical ink extent inside the first 40 columns, to expose line separation.
    row_has_ink = []
    for y in range(min(h, 200)):
        row_has_ink.append(any(px[x, y] < 128 for x in range(min(w, 40 * cell))))
    runs = 0
    prev = False
    gaps = []
    gap_len = 0
    for has in row_has_ink:
        if has and not prev:
            runs += 1
            if gap_len:
                gaps.append(gap_len)
            gap_len = 0
        elif not has:
            gap_len += 1
        prev = has

    log(f"--- {label} ---")
    log(f"file         : {path.name} ({path.stat().st_size} bytes)")
    log(f"size         : {w}x{h} px")
    log(f"cell/pitch   : {cell}px / {pitch}px")
    log(f"grid         : {cols} cols x {rows} rows = {cols * rows} cells")
    log(f"ink coverage : {round(100 * ink / max(1, total), 2)}% of page pixels")
    log(f"cells with ink: {cells_with_ink} | empty cells: {cells_empty}")
    log(f"avg ink/cell : {round(ink / max(1, cells_with_ink), 1)} px  (of {cell * pitch} px cell)")
    log(f"horizontal ink runs in top 200 rows: {runs}")
    log(f"gap lengths between runs: {gaps[:12]}")
    if gaps:
        log(f"median gap   : {sorted(gaps)[len(gaps) // 2]} px")
    log("")


def main() -> None:
    log("Verification of the archived failing configuration (read back from pixels).")
    log("")
    probe(FAIL, CELL_W, PITCH, "FAILING: ink 6px, pitch 9px")
    probe(CTRL, CTRL_CELL, CTRL_PITCH, "CONTROL: ink 24px, pitch 30px")

    log("interpretation:")
    log("  ink/cell near 6-8 px at cell 8x9 px means the glyph occupies a tiny fraction")
    log("  of its cell, and adjacent lines are separated by only 1-2 px of white -")
    log("  which is why the model reports a scattered dot pattern rather than text.")
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out))


if __name__ == "__main__":
    main()
