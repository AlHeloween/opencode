"""Two-page geometry for the kernel document: width, height, fill factor, aspect.

Two layouts are compared, because the earlier run showed this decides everything:

  PRESERVE - keep the source line breaks. 510 short lines (avg 61 chars) wrapped to
             160 columns leave ~65% of every row empty, so the bounding box is far
             larger than the content. Wasteful but keeps the document's own shape.
  REFLOW   - join paragraphs and re-wrap to the full width, keeping a blank line after
             headings. Bounding box ~= content, which is what makes two pages fit.

For each width the script reports exact page geometry, pixel count against the
measured ~1.62M px budget (below it the server does not downscale), fill factor, and
aspect ratio. The squarest page within budget is recommended, because the API
normalises toward a 1:1-equivalent pixel count.

Run: python experiments/2026-09-12_deepseek-vision/calc-2page-layout.py
"""

from __future__ import annotations

import math
import pathlib
import textwrap

DIR = pathlib.Path(__file__).resolve().parent
SOURCE = DIR.parent.parent / "packages/opencode/src/session/prompt/reasoning_prompt.txt"
OUT = DIR / "layout-2page.txt"
BUDGET_PX = 1_620_000
CELL_W = 8
CELL_H = 8
GAP = 1
PITCH = CELL_H + GAP
PX_PER_CHAR = CELL_W * PITCH
PAGES = 2

out: list[str] = []


def log(text: str = "") -> None:
    out.append(text)


def preserve_rows(text: str, cols: int) -> int:
    rows = 0
    for raw in text.splitlines():
        stripped = raw.rstrip()
        if not stripped.strip():
            rows += 1
            continue
        indent = min(len(stripped) - len(stripped.lstrip(" ")), 6)
        rows += len(textwrap.wrap(stripped.strip(), width=max(8, cols - indent),
                                 subsequent_indent=" " * (indent + 2)) or [""])
    return rows


def reflow_rows(text: str, cols: int) -> tuple[int, int]:
    """Join paragraphs, keep a blank line after headings. Returns (rows, chars)."""
    rows = 0
    chars = 0
    for raw in text.splitlines():
        stripped = raw.rstrip()
        if not stripped.strip():
            continue
        pieces = textwrap.wrap(stripped.strip(), width=cols) or [""]
        for piece in pieces:
            rows += 1
            chars += len(piece)
    return rows, chars


def table(title: str, cols_list: list[int], rowfn) -> None:
    log(f"== {title} ==")
    header = (f"{'cols':>5} {'width_px':>9} {'rows/all':>9} {'rows/page':>10} {'height_px':>10} "
              f"{'px/page':>10} {'budget':>8} {'fill':>7} {'aspect':>7} {'verdict':>9}")
    log(header)
    log("-" * len(header))
    for cols in cols_list:
        width = cols * CELL_W
        res = rowfn(cols)
        rows_total = res[0] if isinstance(res, tuple) else res
        content_chars = res[1] if isinstance(res, tuple) else None
        rows_page = math.ceil(rows_total / PAGES)
        height = rows_page * PITCH
        px = width * height
        pct = px / BUDGET_PX
        fill = ""
        if content_chars:
            fill = f"{round(100 * (content_chars / PAGES) * PX_PER_CHAR / px)}%"
        aspect = round(width / height, 2) if height else 0
        veredict = "ok" if px <= BUDGET_PX and height <= 8192 else "OVER"
        log(f"{cols:>5} {width:>9} {rows_total:>9} {rows_page:>10} {height:>10} "
            f"{px:>10} {round(100 * pct):>7}% {fill:>7} {aspect:>7} {veredict:>9}")
    log("")


def main() -> None:
    text = SOURCE.read_text(encoding="utf-8")
    chars_total = len(text)
    per_page_chars = math.ceil(chars_total / PAGES)

    log(f"document: {chars_total} chars, {len(text.splitlines())} source lines")
    log(f"cell={CELL_W}x{CELL_H} gap={GAP} -> pitch={PITCH} -> {PX_PER_CHAR} px/char")
    log(f"budget={BUDGET_PX} px per page (measured token plateau ~1.6M px)")
    log(f"{PAGES} pages -> each must carry ~{per_page_chars} chars "
        f"= {per_page_chars * PX_PER_CHAR} px of content ({round(100 * per_page_chars * PX_PER_CHAR / BUDGET_PX)}% of budget)")
    log("")

    cols_list = [80, 96, 110, 120, 128, 133, 140, 150, 160, 176, 192, 208, 224, 240]
    table("PRESERVE line breaks", cols_list, lambda c: preserve_rows(text, c))
    table("REFLOW (join paragraphs)", cols_list, lambda c: reflow_rows(text, c))

    # Squarest reflowed page within budget.
    best = None
    for cols in range(60, 300):
        width = cols * CELL_W
        rows_total, _ = reflow_rows(text, cols)
        rows_page = math.ceil(rows_total / PAGES)
        height = rows_page * PITCH
        px = width * height
        if px > BUDGET_PX or width > 8192 or height > 8192:
            continue
        aspect = abs(width / height - 1.0) if height else 99
        if best is None or aspect < best[0]:
            best = (aspect, cols, width, height, px, rows_page)

    log("== recommendation ==")
    if best:
        _, cols, width, height, px, rows_page = best
        log(f"squarest reflowed page within budget:")
        log(f"  cols={cols}  width={width} px  height={height} px  ({px} px = {round(100 * px / BUDGET_PX)}% of budget)")
        log(f"  rows/page={rows_page}  capacity={rows_page * cols} cells  content/page={per_page_chars} chars")
        log(f"  fill factor = {round(100 * per_page_chars / (rows_page * cols))}%")
        log(f"  aspect = {round(width / height, 2)} (1.0 = square)")
        log(f"  chars/page = {rows_page * cols}, so ONE page could hold {rows_page * cols} chars")
    else:
        log("  no configuration fits - widen the budget or add pages")

    log("")
    log("== what one page can carry at 8x8+1 ==")
    for width in (1024, 1280, 1600, 1920):
        cols = width // CELL_W
        max_rows = int(BUDGET_PX / width / PITCH)
        log(f"  width={width} ({cols} cols): rows={max_rows}, capacity={cols * max_rows} chars, "
            f"height={max_rows * PITCH}")

    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out))


if __name__ == "__main__":
    main()
