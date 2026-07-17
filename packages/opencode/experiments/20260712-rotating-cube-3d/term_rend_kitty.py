"""
term_rend_kitty.py — Rotating 3D cube rendered via Kitty graphics protocol.

Kitty transmits raw RGBA pixel data (base64-encoded) instead of Sixel's
vertical-band encoding.  The wireframe cube logic is shared with the Sixel
variant; only the terminal output layer differs.

Requires a Kitty-compatible terminal: Kitty, WezTerm, Ghostty, Konsole ≥ 24.08,
or Windows Terminal ≥ 1.22 (all support the Kitty graphics protocol).
"""
import os
import sys
import time
import math
import base64

try:
    import msvcrt
except ImportError:
    msvcrt = None


# ── Cube geometry (shared with term_rend.py) ──────────────────────────────────

class Cube:
    def __init__(self, offset_x, offset_y, scale, label, rotation_speed):
        self.offset_x = offset_x
        self.offset_y = offset_y
        self.scale = scale
        self.label = label
        self.rot_speed = rotation_speed
        self.angle_x = 0.0
        self.angle_y = 0.0

        self.vertices = [
            [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
            [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        ]
        self.edges = [
            (0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6),
            (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7),
        ]

    def rotate_and_project(self, x, y, z, canvas_w, canvas_h):
        rad_x, rad_y = math.radians(self.angle_x), math.radians(self.angle_y)
        y, z = y * math.cos(rad_x) - z * math.sin(rad_x), y * math.sin(rad_x) + z * math.cos(rad_x)
        x, z = x * math.cos(rad_y) + z * math.sin(rad_y), -x * math.sin(rad_y) + z * math.cos(rad_y)

        factor = self.scale / (z + 4.0)
        px = self.offset_x + int(x * factor)
        py = self.offset_y + int(y * factor)
        return px, py

    def tick(self):
        self.angle_x += self.rot_speed[0]
        self.angle_y += self.rot_speed[1]


def draw_line(x0, y0, x1, y1, pixel_matrix, w, h):
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy
    while True:
        if 0 <= x0 < w and 0 <= y0 < h:
            pixel_matrix[y0][x0] = 1
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0 += sx
        if e2 < dx:
            err += dx
            y0 += sy


# ── Kitty graphics protocol output ────────────────────────────────────────────
#
# Kitty graphics protocol (https://sw.kovidgoyal.net/kitty/graphics-protocol/)
#
# Key differences from Sixel:
#   - Transmits raw RGBA pixel data, not 6-pixel vertical bands.
#   - Uses base64 encoding, transmitted in 4096-byte chunks.
#   - Supports image IDs for in-place updates (no delete-then-redraw).
#   - Uses \x1b_G ... \x1b\\ framing.
#
# Control codes used:
#   a=T  – transmit + display (no persistence between terminal sessions)
#   f=32 – RGBA format (8 bits per channel)
#   s=W  – pixel width
#   v=H  – pixel height
#   i=ID – image ID (reuse to update in-place without flicker)
#   m=0  – last chunk  /  m=1 – more chunks coming
#   q=1  – quiet (no response from terminal)
#   C=1  – do not move cursor after display
#   z=N  – z-index (negative = behind text)

KITTY_CHUNK = 4096  # max base64 payload per chunk
GREEN_RGBA = (0, 255, 100, 255)
MAGENTA_RGBA = (255, 100, 255, 255)
BG_RGBA = (0, 0, 0, 0)       # transparent background


def pixel_matrix_to_rgba(pixel_matrix, w, h, fg_rgba, bg_rgba=BG_RGBA):
    """Convert 2D pixel matrix (0/1) to flat RGBA byte array."""
    rgba = bytearray(w * h * 4)
    r, g, b, a = fg_rgba
    br, bg_, bb, ba = bg_rgba
    for y in range(h):
        for x in range(w):
            idx = (y * w + x) * 4
            if pixel_matrix[y][x]:
                rgba[idx] = r
                rgba[idx + 1] = g
                rgba[idx + 2] = b
                rgba[idx + 3] = a
            else:
                rgba[idx] = br
                rgba[idx + 1] = bg_
                rgba[idx + 2] = bb
                rgba[idx + 3] = ba
    return bytes(rgba)


def kitty_delete(image_id, virtual_id=None):
    """Delete a kitty image (optional: by virtual placement ID)."""
    if virtual_id is not None:
        # delete by virtual placement (does nothing if never placed)
        pass
    return f"\x1b_Ga=d,d=i,i={image_id},q=1\x1b\\"


def kitty_display(rgba_bytes, w, h, image_id, x=None, y=None, z_index=None):
    """
    Generate Kitty graphics protocol escape sequence.

    Args:
        rgba_bytes: raw RGBA pixel data (w * h * 4 bytes)
        w, h: image dimensions in pixels
        image_id: integer ID for the image (reuse to update in-place)
        x, y: optional terminal cell position (1-based)
        z_index: optional z-index (negative = behind text)
    """
    encoded = base64.standard_b64encode(rgba_bytes).decode("ascii")
    chunks = [encoded[i : i + KITTY_CHUNK] for i in range(0, len(encoded), KITTY_CHUNK)]

    parts = []
    for i, chunk in enumerate(chunks):
        more = 1 if i < len(chunks) - 1 else 0
        header = f"\x1b_Ga=T,f=32,s={w},v={h},i={image_id},m={more},q=1"

        if i == 0 and x is not None and y is not None:
            header += f",X={x},Y={y}"
        if i == 0:
            header += ",C=1"  # don't move cursor after display
        if i == 0 and z_index is not None:
            header += f",z={z_index}"

        parts.append(f"{header};{chunk}\x1b\\")

    return "".join(parts)


# ── Kitty cube engine ─────────────────────────────────────────────────────────

class KittyCubeEngine:
    def __init__(self):
        self.cube_w = 300
        self.cube_h = 300
        self.cube_center = (self.cube_w // 2, self.cube_h // 2)

        self.cubes = [
            Cube(
                offset_x=self.cube_center[0],
                offset_y=self.cube_center[1],
                scale=80,
                label="OPENCODE",
                rotation_speed=(2.0, 3.0),
            ),
            Cube(
                offset_x=self.cube_center[0],
                offset_y=self.cube_center[1],
                scale=80,
                label="KITTY 3D",
                rotation_speed=(-2.5, 3.5),
            ),
        ]

        self.frame = 0
        # Each cube gets a stable image ID — Kitty updates in-place without flicker
        self.image_ids = [1001, 1002]

    def clear_terminal(self):
        os.system("cls" if os.name == "nt" else "clear")

    def run(self):
        self.clear_terminal()
        sys.stdout.write("\033[?25l")  # hide cursor

        # ── Header ──
        header_color = "\033[38;2;100;255;200m"
        print(f"{header_color}  ╔══════════════════════════════════════════╗")
        print(f"  ║   \033[1mOPENCODE\033[0m{header_color}  +  \033[38;2;255;100;200m\033[1mKITTY GFX\033[0m{header_color}  —  Dual Rotating Cubes      ║")
        print(f"  ╚══════════════════════════════════════════╝\033[0m")
        print()
        print("  Press \033[1mQ\033[0m to exit  |  FPS: computing...")
        print()

        last_time = time.time()
        frame_times = []

        try:
            while True:
                if msvcrt and msvcrt.kbhit():
                    key = msvcrt.getch().decode("utf-8", errors="ignore").lower()
                    if key == "q":
                        break

                now = time.time()

                # Render both cubes
                for i, cube in enumerate(self.cubes):
                    pixel_matrix = [[0] * self.cube_w for _ in range(self.cube_h)]
                    cube.tick()
                    projected = [
                        cube.rotate_and_project(*v, self.cube_w, self.cube_h)
                        for v in cube.vertices
                    ]
                    for edge in cube.edges:
                        p1, p2 = projected[edge[0]], projected[edge[1]]
                        draw_line(
                            p1[0], p1[1], p2[0], p2[1],
                            pixel_matrix, self.cube_w, self.cube_h,
                        )

                    fg = GREEN_RGBA if i == 0 else MAGENTA_RGBA
                    rgba = pixel_matrix_to_rgba(pixel_matrix, self.cube_w, self.cube_h, fg)

                    # Position: left cube at (0, 6) rows down, right cube offset by ~50 cols
                    # Kitty positions in terminal cells (1-based). Each cell ≈ 9px wide,
                    # so 300px / 9 ≈ 33 cells. Add 2-cell gap.
                    x_pos = 2 if i == 0 else 2 + 33 + 2  # left / right
                    y_pos = 6  # below header

                    sys.stdout.write(
                        kitty_display(rgba, self.cube_w, self.cube_h, self.image_ids[i],
                                       x=x_pos, y=y_pos, z_index=-1)
                    )

                # Labels in real terminal text (drawn on top of the kitty images)
                sys.stdout.write("\033[6;2H")  # row 6, col 2
                sys.stdout.write("\033[38;2;100;255;200m  \033[1mOPENCODE\033[0m")
                sys.stdout.write("\033[6;37H")  # row 6, col 37
                sys.stdout.write("\033[38;2;255;100;200m\033[1mKITTY 3D\033[0m")
                sys.stdout.write("\033[40;1H")  # move cursor below all graphics

                # FPS counter
                frame_times.append(now - last_time)
                if len(frame_times) > 30:
                    frame_times.pop(0)
                avg_ms = (sum(frame_times) / len(frame_times)) * 1000
                fps = len(frame_times) / (sum(frame_times) or 0.001)
                sys.stdout.write(
                    f"\n  FPS: {fps:5.1f}  |  frame: {self.frame:5d}  |  "
                    f"avg {avg_ms:5.1f} ms  "
                )
                sys.stdout.flush()

                last_time = now
                self.frame += 1
                time.sleep(0.015)

        finally:
            # Delete images so they don't linger after exit
            for image_id in self.image_ids:
                sys.stdout.write(kitty_delete(image_id))
            sys.stdout.flush()
            sys.stdout.write("\033[?25h\n")  # restore cursor
            print(f"\nRendered {self.frame} frames. Goodbye!")


if __name__ == "__main__":
    KittyCubeEngine().run()
