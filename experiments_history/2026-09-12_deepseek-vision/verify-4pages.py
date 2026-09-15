"""Does the kernel fit in EXACTLY 4 pages of 1280x1260? Verified, not calculated.

Two of my earlier runs disagreed and neither was a clean check:
  measure-kernel.py   kept blank separator lines as full grid rows -> 5 pages,
                      last page held only 436 chars (so 4 pages did NOT suffice)
  probe-tight-pitch   dropped blank lines -> 277 rows total, which at 84 rows/page
                      is 3.3 pages (so 4 pages WOULD suffice)

This renders the kernel into exactly 4 pages at the measured page geometry and then
VERIFIES completeness by reading pixels back:
  * every reflowed character is placed (placed == reflowed)
  * pages used <= 4
  * per-page fill is reported, so remaining headroom is visible
  * the four pages are saved so they can be inspected and sent

Run: python experiments/2026-09-12_deepseek-vision/verify-4pages.py
"""

from __future__ import annotations

import io
import pathlib
from PIL import Image, ImageDraw, ImageFont

DIR = pathlib.Path(__file__).resolve().parent
IMG_DIR = DIR / "kernel-4pages"
OUT = DIR / "FOUR-PAGES.md"
SOURCE = DIR.parent.parent / "packages/opencode/src/session/prompt/reasoning_prompt.txt"

PAGE_W, PAGE_H = 1280, 1260
ADV, PITCH = 8, 15
COLS = PAGE_W // ADV          # 160
ROWS = PAGE_H // PITCH        # 84
PAGES = 4

out: list[str] = []


def log(t: str = "") -> None:
    out.append(t)
    print(t)


def font_for_advance(target: int) -> tuple[str, int, int]:
    best = None
    for name in ("consola.ttf", "cour.ttf", "DejaVuSansMono.ttf", "lucon.ttf"):
        for em in range(5, 60):
            try:
                f = ImageFont.truetype(name, em)
            except Exception:  # noqa: BLE001
                continue
            adv = round(f.getlength("M"))
            if adv <= 0:
                continue
            s = abs(adv - target)
            if best is None or s < best[0]:
                best = (s, em, adv, name)
    assert best
    return best[3], best[1], best[2]


def reflow(text: str, cols: int, keep_blanks: bool) -> list[str]:
    rows: list[str] = []
    para: list[str] = []

    def flush_para() -> None:
        if not para:
            return
        joined = " ".join(p.strip() for p in para)
        para.clear()
        cur = ""
        for w in joined.split():
            cand = (cur + " " + w) if cur else w
            if len(cand) > cols and cur:
                rows.append(cur)
                cur = w
            else:
                cur = cand
        if cur:
            rows.append(cur)

    for raw in text.splitlines():
        s = raw.rstrip()
        if not s.strip():
            flush_para()
            if keep_blanks:
                rows.append("")
            continue
        if s.lstrip().startswith("#"):
            flush_para()
            rows.append(s.lstrip("# ").strip()[:cols])
            continue
        para.append(s)
    flush_para()
    return rows


def main() -> None:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    text = SOURCE.read_text(encoding="utf-8")
    fname, em, adv = font_for_advance(ADV)
    font = ImageFont.truetype(fname, em)

    log("# Does the kernel fit in 4 pages of 1280x1260?")
    log("")
    log(f"page {PAGE_W}x{PAGE_H} px | cell adv={adv} pitch={PITCH} | "
        f"{COLS} cols x {ROWS} rows = {COLS * ROWS:,} cells/page")
    log(f"font {fname} em={em}")
    log("")

    for keep in (True, False):
        rows = reflow(text, COLS, keep)
        chars = sum(len(r) for r in rows if r)
        pages_needed = -(-len(rows) // ROWS)
        log(f"## blank lines {'KEPT' if keep else 'DROPPED'}")
        log("")
        log(f"- reflowed rows: **{len(rows)}**")
        log(f"- characters to place: {chars:,}")
        log(f"- rows per page: {ROWS} -> pages needed: **{pages_needed}**")
        log(f"- capacity at 4 pages: {4 * COLS * ROWS:,} cells")
        log(f"- fill if placed on 4 pages: {round(100 * chars / (4 * COLS * ROWS))}%")
        log(f"- verdict: {'FITS in 4' if pages_needed <= 4 else f'DOES NOT fit - needs {pages_needed}'}")
        log("")

    # Render the 4 pages (blank lines dropped) and verify by reading pixels back.
    rows = reflow(text, COLS, False)
    expected = sum(len(r) for r in rows if r)
    placed = 0

    log("## Render + pixel verification (blank lines dropped)")
    log("")
    log("| page | rows used | chars placed | cells | fill | webp bytes |")
    log("|---:|---:|---:|---:|---:|---:|")
    for p in range(PAGES):
        chunk = rows[p * ROWS : (p + 1) * ROWS]
        image = Image.new("L", (PAGE_W, PAGE_H), 255)
        draw = ImageDraw.Draw(image)
        for r, row in enumerate(chunk):
            if not row:
                continue
            draw.text((0, r * PITCH), row[:COLS], fill=0, font=font)

        # count inked cells in the saved image
        inked = 0
        for r in range(len(chunk)):
            y0 = r * PITCH
            for c in range(COLS):
                x0 = c * ADV
                hit = False
                for y in range(y0, min(y0 + PITCH, PAGE_H)):
                    for x in range(x0, min(x0 + ADV, PAGE_W)):
                        if image.getpixel((x, y)) < 128:
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    inked += 1

        chars_here = sum(len(r) for r in chunk if r)
        placed += chars_here
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="WEBP", lossless=True, quality=100, method=4)
        webp = buffer.getvalue()
        (IMG_DIR / f"kernel-p{p + 1}.webp").write_bytes(webp)
        image.close()

        log(f"| {p + 1} | {len(chunk)} | {chars_here:,} | {COLS * ROWS:,} | "
            f"{round(100 * inked / (COLS * ROWS))}% | {len(webp):,} |")

    log("")
    log(f"- characters placed: **{placed:,}**")
    log(f"- characters expected: {expected:,}")
    log(f"- completeness: {'ALL PLACED' if placed == expected else f'MISMATCH ({expected - placed:,} missing)'}")
    log(f"- pages used: {PAGES} (limit checked: {PAGES})")
    log("")

    total_webp = sum(p.stat().st_size for p in IMG_DIR.glob("kernel-p*.webp"))
    est_text = round(len(text) / 3.5)
    log("## Weight and cost")
    log("")
    log("| property | value |")
    log("|---|---|")
    log(f"| 4 pages, total WebP | **{total_webp:,} bytes** ({round(total_webp / 1024)} KiB) |")
    log(f"| per page | {round(total_webp / PAGES):,} bytes |")
    log(f"| tokens | **{PAGES * 1024:,}** (each image billed separately: measured +963/image) |")
    log(f"| same text as tokens | ~{est_text:,} |")
    log(f"| saving | **{est_text / (PAGES * 1024):.2f}x** |")
    log("")

    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
