"""Reader for the flicker pixel oracle (T4 of the reasoning-stream-render-stability plan).

WHY IT EXISTS. The first live frames were compared with eyes and imagerender's ink bands —
neither is a reproducible instrument. T4's open criterion is "stable lines above the live tail
are byte-identical between frames"; the naive form of it is wrong for a SCROLLING viewport
(the whole page moves down as lines are appended), so this reader measures three things and
lets the caller decide:

  ink      fraction of non-background pixels in the content area — a frame whose visible
           reasoning collapsed (the flicker we are hunting) has a DROPPING ink.
  shift    the vertical offset that best aligns frame A's content rows onto frame B's. A shift
           that equals the appended line height is the viewport moving WITH the stream, which
           is the healthy case; a shift that jumps further means the viewport moved without
           content (the jump the plan complains about).
  matched  fraction of content rows of A that reappear byte-identical in B after the shift.
           This is T4's "stable lines" criterion stated in a form that survives scrolling.

USAGE: python reader.py frameA.png frameB.png [--top N] [--bottom N] [--width W]
Exit code 0 when a report was produced. The numbers ARE the report; the caller asserts.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except Exception as error:  # pragma: no cover - environment guard, printed not swallowed
    print(f"reader: Pillow unavailable ({error})", file=sys.stderr)
    raise SystemExit(2)


def load_mask(path: Path, top: int, bottom: int, width: int) -> tuple[list[bytes], int, int]:
    """Rows of a binary ink mask for the content area, one bytes object per row."""
    with Image.open(path) as image:
        grey = image.convert("L")
        w, h = grey.size
        if width:
            grey = grey.crop((0, 0, min(width, w), h))
            w = grey.size[0]
        box = (0, top, w, max(top + 1, h - bottom))
        region = grey.crop(box)
        pixels = region.load()
        # INK IS DEVIATION FROM THE BACKGROUND, not "dark pixels". The terminal theme is DARK, so a
        # `pixel < 128` test counts the BACKGROUND as ink and reports ~94% for every frame — measured
        # on this reader's first run, where it said ink collapsed on two frames that plainly grew.
        # The background level is the MODE of the brightness histogram; ink is what departs from it.
        counts = [0] * 256
        for y in range(region.size[1]):
            for x in range(region.size[0]):
                counts[pixels[x, y]] += 1
        background = counts.index(max(counts))
        rows: list[bytes] = []
        for y in range(region.size[1]):
            rows.append(
                bytes(1 if abs(pixels[x, y] - background) > 32 else 0 for x in range(region.size[0]))
            )
        return rows, region.size[0], region.size[1]


def ink(rows: list[bytes]) -> float:
    total = sum(len(row) for row in rows)
    if total == 0:
        return 0.0
    return sum(sum(row) for row in rows) / total


def best_shift(a: list[bytes], b: list[bytes], limit: int) -> tuple[int, float]:
    """Vertical shift of A that best matches B, and the matched-row fraction at that shift.

    shift > 0 means A's rows appear LOWER in B (the stream scrolled down between the frames).
    """
    best = (0, -1.0)
    for shift in range(0, limit + 1):
        pairs = 0
        equal = 0
        for i, row in enumerate(a):
            j = i + shift
            if j >= len(b):
                break
            pairs += 1
            equal += int(row == b[j])
        score = equal / pairs if pairs else -1.0
        if score > best[1]:
            best = (shift, score)
    return best


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("frame_a")
    parser.add_argument("frame_b")
    parser.add_argument("--top", type=int, default=60, help="rows to cut above the content area")
    parser.add_argument("--bottom", type=int, default=70, help="rows to cut below it")
    parser.add_argument("--width", type=int, default=0, help="crop width (0 = full)")
    parser.add_argument("--limit", type=int, default=200, help="largest vertical shift to try")
    args = parser.parse_args()

    a = Path(args.frame_a)
    b = Path(args.frame_b)
    rows_a, width_a, height_a = load_mask(a, args.top, args.bottom, args.width)
    rows_b, _, _ = load_mask(b, args.top, args.bottom, args.width)

    shift, matched = best_shift(rows_a, rows_b, args.limit)

    print(f"reader: A={a.name} ({width_a}x{height_a} content rows)")
    print(f"reader: B={b.name}")
    print(f"reader: ink A={ink(rows_a):.4f}")
    print(f"reader: ink B={ink(rows_b):.4f}")
    print(f"reader: best_shift={shift} rows")
    print(f"reader: matched_after_shift={matched:.4f}")
    # Health lines the caller can cite directly.
    print(f"reader: ink_rose={'yes' if ink(rows_b) >= ink(rows_a) else 'NO — visible content collapsed'}")
    print(f"reader: stable_above_tail={'yes' if matched >= 0.9 else 'no'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
