#!/usr/bin/env python3
"""
Unified Pipeline — Python reference: Sixel + WebGL test.

TUI path:   PNG → Jimp → Sixel → terminal
Web path:   Three.js WebGL → HTML canvas

This mirrors the TypeScript pipeline for cross-validation.
"""
import os, sys, struct
from pathlib import Path

HERE = Path(__file__).parent
PNG_PATH = HERE / "test_pattern.png"

# ── Dynamic DLL resolution (from test_cube.py) ──────────────────────
def resolve_dlls():
    target_files = ["dxcompiler.dll", "dxil.dll"] if sys.platform.startswith("win32") else ["dxc"]
    lookup_cmd = ["where.exe"] if sys.platform.startswith("win32") else ["which"]
    discovered = set()
    for fname in target_files:
        try:
            res = os.popen(" ".join(lookup_cmd + [fname])).read()
            for line in res.strip().splitlines():
                p = Path(line.strip()).parent
                if p.exists(): discovered.add(str(p))
        except: continue
    for p in discovered:
        if sys.platform.startswith("win32") and "x86" in p.lower() and "x64" not in p.lower(): continue
        if p not in os.environ["PATH"]:
            os.environ["PATH"] = p + os.pathsep + os.environ["PATH"]
        if sys.platform.startswith("win32"):
            try: os.add_dll_directory(p)
            except: pass
    return len(discovered)

# ── Sixel TUI path ─────────────────────────────────────────────────
def sixel_from_png(png_path: str, max_cols: int = 60):
    try:
        from PIL import Image
    except ImportError:
        print("Install Pillow: pip install Pillow")
        return None

    img = Image.open(png_path)
    aspect = img.width / img.height
    cols = min(img.width, max_cols)
    rows = round(cols / aspect)
    rows = ((rows + 5) // 6) * 6  # round up to multiple of 6
    img = img.resize((cols, rows), Image.LANCZOS)
    pixels = list(img.getdata())

    # Uniform 5-6-5 quantization (same as TypeScript sixel-render.ts)
    palette = {}
    idx_map = []
    for r, g, b in pixels:
        key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
        if key not in palette:
            palette[key] = len(palette)
        idx_map.append(palette[key])

    palette_list = [(k >> 11 & 0x1F) * 255 // 31,
                    (k >> 5 & 0x3F) * 255 // 63,
                    (k & 0x1F) * 255 // 31]
    # Wait we need full palette mapping
    pal_rgb = {}
    for key, idx in palette.items():
        pr = min(100, round((key >> 11) * 100 / 31))
        pg = min(100, round(((key >> 5) & 0x3F) * 100 / 63))
        pb = min(100, round((key & 0x1F) * 100 / 31))
        pal_rgb[idx] = (pr, pg, pb)

    out = ["\x1bPq"]
    for i in range(len(palette)):
        r, g, b = pal_rgb[i]
        out.append(f"#{i};2;{r};{g};{b}")

    bands = rows // 6
    for band in range(bands):
        base_y = band * 6
        color_bands = {}
        for x in range(cols):
            for bit in range(6):
                y = base_y + bit
                if y >= rows: continue
                ci = idx_map[y * cols + x]
                if ci >= len(palette): continue
                if ci not in color_bands:
                    color_bands[ci] = [0] * cols
                color_bands[ci][x] = (color_bands[ci][x] or 0) | (1 << bit)

        # Sort by frequency (most used first)
        sorted_colors = sorted(color_bands.items(),
            key=lambda kv: sum(1 for v in kv[1] if v), reverse=True)

        for ci, bitmask in sorted_colors:
            out.append(f"#{ci}")
            for x in range(cols):
                code = bitmask[x] or 0
                out.append(chr(63 + code))
            out.append("$")
        out.append("-")

    out.append("\x1b\\")
    return "".join(out)

if __name__ == "__main__":
    print("=== Unified Pipeline: Python Reference ===")
    print(f"\n1. Dynamic DLL resolution: {resolve_dlls()} directories found")
    if PNG_PATH.exists():
        print(f"2. Sixel TUI path: ", end="")
        seq = sixel_from_png(str(PNG_PATH))
        if seq:
            print(f"{len(seq)} bytes generated")
            with open(HERE / "sixel_python.txt", "w") as f:
                f.write(seq)
            print(f"   Saved to sixel_python.txt")
        else:
            print("FAILED")
    else:
        print(f"2. Generate test PNG first: bun run test_pipeline.ts")
