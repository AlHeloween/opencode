"""Does WebP exploit 2D repetition that PNG cannot? Measured, not assumed.

The claim under test: WebP-lossless finds real TWO-DIMENSIONAL repetition (the same
glyph recurring along a row AND the same glyph recurring on the next line), while PNG
after its per-scanline 2D filter still reduces to DEFLATE/LZ77 over a one-dimensional
byte stream, so its matches are linear.

Method: identical page geometry (advance 8 px, line pitch 15 px, 160 columns, 64 rows
= 10 240 cells) and identical glyph set. ONLY the redundancy of the content changes:

  random-digits        every cell independent      - no repetition to find
  random-line-repeated one random line x 64 rows   - maximal 2D repetition (rows identical)
  prose                natural English             - word/letter repetition
  kernel-code          a real source document      - structural repetition

If WebP is exploiting 2D structure, the gap between WebP and PNG must GROW as the
content becomes more repetitive. If both codecs behave the same on all four, the claim
is wrong.

Also sweeps WebP encoder effort (`method` 0-6) and `near_lossless` preprocessing, since
that mode exists precisely to collapse imperceptible entropy before encoding.

Pure compression measurement: no API calls, so the numbers are cheap and repeatable.

Run: python experiments/2026-09-12_deepseek-vision/probe-2d-repetition.py
"""

from __future__ import annotations

import io
import json
import pathlib
import random
import string
import time
from PIL import Image, ImageDraw, ImageFont, features

DIR = pathlib.Path(__file__).resolve().parent
IMG_DIR = DIR / "images-2d"
OUT = DIR / "2d-repetition-results.txt"
SOURCE = DIR.parent.parent / "packages/opencode/src/session/prompt/reasoning_prompt.txt"
PROSE = DIR / "vision-doc.txt"

FONT_FILE = "consola.ttf"
TARGET_ADV = 8
PITCH = 15
COLS = 160
ROWS = 64
SEED = 1234

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
INK_BOX = FONT.getbbox("0")
INK_H = INK_BOX[3] - INK_BOX[1]


def rows_from(text: str, cols: int = COLS, rows: int = ROWS) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        cand = (cur + " " + w) if cur else w
        if len(cand) > cols and cur:
            lines.append(cur)
            cur = w
        else:
            cur = cand
        if len(lines) >= rows:
            break
    if cur and len(lines) < rows:
        lines.append(cur)
    while len(lines) < rows:
        lines.append(lines[len(lines) % max(1, len(lines))] if lines else "")
    return lines[:rows]


def content_variants() -> dict[str, list[str]]:
    rng = random.Random(SEED)
    charset = string.ascii_lowercase + string.digits + " .,:;-_()[]{}"

    # 1. every cell independent - the anti-repetition control
    random_rows = ["".join(rng.choice(charset) for _ in range(COLS)) for _ in range(ROWS)]

    # 2. one line, repeated on every row - maximal 2D (vertical) repetition
    one = "".join(rng.choice(charset) for _ in range(COLS))
    repeated_rows = [one] * ROWS

    # 3. natural English
    prose_text = ""
    try:
        prose_text = PROSE.read_text(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        prose_text = "The quick brown fox jumps over the lazy dog. " * 300
    prose_rows = rows_from(prose_text)

    # 4. a real source document
    code_rows = rows_from(SOURCE.read_text(encoding="utf-8"))

    return {
        "random-digits": random_rows,
        "random-line-repeated": repeated_rows,
        "prose": prose_rows,
        "kernel-code": code_rows,
    }


def render(rows: list[str]) -> tuple[Image.Image, dict]:
    width = COLS * ADV
    height = ROWS * PITCH
    image = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(image)
    drawn = 0
    for r, row in enumerate(rows):
        draw.text((0, r * PITCH), row[:COLS], fill=0, font=FONT)
        drawn += len(row[:COLS])
    ink = sum(1 for v in image.getdata() if v < 128)
    return image, {"drawn": drawn, "ink": ink, "ink_per_glyph": round(ink / max(1, drawn), 2)}


def encode_png(image: Image.Image) -> bytes:
    b = io.BytesIO()
    image.convert("L").save(b, format="PNG", optimize=True, compress_level=9)
    return b.getvalue()


def encode_webp(image: Image.Image, **kw) -> bytes:
    b = io.BytesIO()
    image.convert("RGB").save(b, format="WEBP", **kw)
    return b.getvalue()


def main() -> None:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    log(f"geometry: adv={ADV}px em={EM} ink_h={INK_H}px pitch={PITCH}px cols={COLS} rows={ROWS}")
    log(f"cells per page: {COLS * ROWS} | PIL WebP: {features.check('webp')}")
    log("")

    variants = content_variants()
    rendered = {}
    for name, rows in variants.items():
        image, m = render(rows)
        if m["ink_per_glyph"] < 3:
            raise SystemExit(f"RENDER FAILED for {name}: {m['ink_per_glyph']} px/glyph")
        rendered[name] = (image, m)
        log(f"  {name:22} drawn={m['drawn']} ink={m['ink']} ({m['ink_per_glyph']} px/glyph)")
    log("")

    # --- encoder sweep ---------------------------------------------------------
    log("== sizes by codec (bytes) ==")
    header = (f"{'content':22} {'PNG':>9} {'WP-m4':>9} {'WP-m6':>9} "
              f"{'WP-nl60':>9} {'WP-nl100':>9}")
    log(header)
    log("-" * len(header))

    table: dict[str, dict[str, int]] = {}
    for name, (image, m) in rendered.items():
        png = encode_png(image)
        wp_m4 = encode_webp(image, lossless=True, quality=100, method=4)
        wp_m6 = encode_webp(image, lossless=True, quality=100, method=6)
        wp_nl60 = encode_webp(image, lossless=True, quality=100, method=6, near_lossless=60)
        wp_nl100 = encode_webp(image, lossless=True, quality=100, method=6, near_lossless=100)
        table[name] = {
            "PNG": len(png),
            "WP-m4": len(wp_m4),
            "WP-m6": len(wp_m6),
            "WP-nl60": len(wp_nl60),
            "WP-nl100": len(wp_nl100),
        }
        log(f"{name:22} {len(png):>9} {len(wp_m4):>9} {len(wp_m6):>9} "
            f"{len(wp_nl60):>9} {len(wp_nl100):>9}")

        (IMG_DIR / f"{name}.png").write_bytes(png)
        (IMG_DIR / f"{name}-wp-lossless.webp").write_bytes(wp_m6)
        (IMG_DIR / f"{name}-wp-nearlossless60.webp").write_bytes(wp_nl60)
    log("")

    # --- the claim: does the WebP advantage GROW with repetition? ---------------
    log("== WebP-lossless as a fraction of PNG (lower = bigger WebP win) ==")
    log(f"{'content':22} {'WP/PNG':>8} {'bytes/glyph':>12} {'PNG B/glyph':>12} {'entropy':>9}")
    log("-" * len(header))
    entropies = {}
    for name, (image, m) in rendered.items():
        ratio = table[name]["WP-m6"] / table[name]["PNG"]
        entropies[name] = {
            "wp_per_glyph": round(table[name]["WP-m6"] / max(1, m["drawn"]), 3),
            "png_per_glyph": round(table[name]["PNG"] / max(1, m["drawn"]), 3),
        }
        log(f"{name:22} {ratio:>7.2f}x {entropies[name]['wp_per_glyph']:>12} "
            f"{entropies[name]['png_per_glyph']:>12} {ratio:>9.2f}")
    log("")

    log("== encoder effort and near-lossless on the realistic content ==")
    log(f"{'codec':28} {'kernel-code':>12} {'prose':>10} {'random':>10}")
    log("-" * 62)
    for label, key in (
        ("PNG (optimize, level 9)", "PNG"),
        ("WebP lossless method=4", "WP-m4"),
        ("WebP lossless method=6", "WP-m6"),
        ("WebP near_lossless=60", "WP-nl60"),
        ("WebP near_lossless=100", "WP-nl100"),
    ):
        log(f"{label:28} {table['kernel-code'][key]:>12} {table['prose'][key]:>10} "
            f"{table['random-digits'][key]:>10}")
    log("")

    # --- verdict ---------------------------------------------------------------
    log("== verdict ==")
    rep = table["random-line-repeated"]["WP-m6"] / table["random-line-repeated"]["PNG"]
    rnd = table["random-digits"]["WP-m6"] / table["random-digits"]["PNG"]
    log(f"  vertical repetition (one line x {ROWS} rows): WebP = {rep:.3f} x PNG")
    log(f"  no repetition (independent cells)          : WebP = {rnd:.3f} x PNG")
    if rep < rnd:
        log(f"  -> WebP's advantage GROWS with 2D repetition (by {round(100 * (rnd - rep) / rnd)}%),")
        log(f"     consistent with 2D spatial prediction rather than linear matching.")
    else:
        log("  -> no extra 2D advantage observed; the claim is not supported by this test.")
    log("")
    log("  best absolute result on realistic content:")
    for key in ("WP-m6", "WP-nl60"):
        log(f"    kernel-code {key}: {table['kernel-code'][key]} bytes "
            f"({round(table['kernel-code'][key] / table['kernel-code']['PNG'] * 100)}% of PNG)")

    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
