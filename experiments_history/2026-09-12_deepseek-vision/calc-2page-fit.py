"""Find the page width at which the kernel fits in exactly TWO pages, at 8x8+1.

The previous table showed every width OVER budget, which looks paradoxical: the
content area is only 2.26M px (31 336 chars x 72) against 3.24M px of budget for two
pages. The reason is bounding-box waste. The kernel has 510 short lines; when wrapped
to a wide column, each row is only partially filled, so the PAGE AREA is much larger
than the character area.

Total page area for P pages = 72 * cols * rows_total
    (each row costs cols*8 px wide and 9 px tall, and rows_total is fixed by the wrap)
So a fixed budget gives a hard limit:  cols * rows_total <= budget_total / 72.

This script scans the column count and reports where two pages actually fit, and what
the resulting page looks like (width, height, aspect, fill).
"""

from __future__ import annotations

import math
import pathlib
import textwrap

DIR = pathlib.Path(__file__).resolve().parent
SOURCE = DIR.parent.parent / "packages/opencode/src/session/prompt/reasoning_prompt.txt"
OUT = DIR / "layout-2page-fit.txt"
BUDGET_PAGE = 1_620_000
CELL_W, CELL_H, GAP = 8, 8, 1
PITCH = CELL_H + GAP
PAGES = 2

out: list[str] = []


def log(t: str = "") -> None:
    out.append(t)


def reflow_rows(text: str, cols: int) -> int:
    rows = 0
    for raw in text.splitlines():
        s = raw.rstrip()
        if not s.strip():
            continue
        rows += len(textwrap.wrap(s.strip(), width=cols) or [""])
    return rows


def main() -> None:
    text = SOURCE.read_text(encoding="utf-8")
    chars_total = len(text)
    budget_total = BUDGET_PAGE * PAGES

    log(f"document {chars_total} chars | budget {PAGES} x {BUDGET_PAGE} = {budget_total} px")
    log(f"hard limit from area: cols * rows_total <= {budget_total // (CELL_W * PITCH)}")
    log("")
    header = f"{'cols':>5} {'width':>6} {'rows':>6} {'cols*rows':>10} {'px_total':>10} {'%bud':>6} {'height':>7} {'aspect':>7} {'fill':>6} {'verdict':>8}"
    log(header)
    log("-" * len(header))

    fitting: list[tuple] = []
    for cols in (40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 88, 96, 104, 112, 120, 128, 140, 160, 176, 192):
        width = cols * CELL_W
        rows = reflow_rows(text, cols)
        px_total = CELL_W * PITCH * cols * rows
        pct = round(100 * px_total / budget_total)
        rows_page = math.ceil(rows / PAGES)
        height = rows_page * PITCH
        aspect = round(width / height, 2)
        fill = round(100 * chars_total / (cols * rows))
        ok = px_total <= budget_total and width <= 8192 and height <= 8192
        if ok:
            fitting.append((cols, width, height, px_total, aspect, fill, rows_page))
        log(f"{cols:>5} {width:>6} {rows:>6} {cols * rows:>10} {px_total:>10} {pct:>5}% "
            f"{height:>7} {aspect:>7} {fill:>5}% {'OK' if ok else 'OVER':>8}")

    log("")
    log("== configurations that fit TWO pages ==")
    if not fitting:
        log("  none - the kernel needs a third page at 8x8+1")
    else:
        for cols, width, height, px, aspect, fill, rows_page in fitting:
            log(f"  cols={cols} width={width}px height={height}px px={px} ({round(100 * px / budget_total)}% of 2-page budget) "
                f"aspect={aspect} fill={fill}% rows/page={rows_page}")

    log("")
    log("== the trade-off ==")
    log("  narrow columns: less wasted width per row, but taller pages (aspect far from 1)")
    log("  wide columns:   fewer rows, but every row is half-empty, so the box explodes")
    log("  the API normalises toward a 1:1 pixel ratio, so a tall thin page is fine per-side")
    log("  as long as each side stays <= 8192 px")

    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out))


if __name__ == "__main__":
    main()
