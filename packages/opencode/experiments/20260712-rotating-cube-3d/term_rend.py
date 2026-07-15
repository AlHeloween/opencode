import os
import sys
import time
import math
try:
    import msvcrt  # Windows keyboard input
except ImportError:
    msvcrt = None


class Cube:
    """A single 3D wireframe cube with its own rotation state, color, and label."""
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
            [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1]
        ]
        self.edges = [
            (0,1), (1,2), (2,3), (3,0), (4,5), (5,6),
            (6,7), (7,4), (0,4), (1,5), (2,6), (3,7)
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


def generate_sixel(pixel_matrix, w, h, edge_rgb, fill_rgb=None):
    """
    Convert 2D pixel array to Sixel bytes.
    edge_rgb  = (r%, g%, b%) for value 1 (wireframe edges)
    fill_rgb  = (r%, g%, b%) for value 2 (filled areas), optional
    """
    r1, g1, b1 = edge_rgb
    parts = ["\033Pq", f"#1;2;{r1};{g1};{b1}"]
    if fill_rgb:
        r2, g2, b2 = fill_rgb
        parts.append(f"#2;2;{r2};{g2};{b2}")

    for y_band in range(0, h, 6):
        parts.append("#1")
        current_color = 1
        for x in range(w):
            sixel_code = 0
            for bit in range(6):
                yy = y_band + bit
                if yy < h and pixel_matrix[yy][x]:
                    val = pixel_matrix[yy][x]
                    if val != current_color:
                        parts.append(f"#{val}")
                        current_color = val
                    sixel_code |= (1 << bit)
            parts.append(chr(0x3F + sixel_code))
        parts.append("-")

    parts.append("\033\\")
    return "".join(parts)


class SixelDualCubeEngine:
    def __init__(self):
        # Each cube gets its own 300x300 pixel canvas
        self.cube_w = 300
        self.cube_h = 300
        self.cube_center = (self.cube_w // 2, self.cube_h // 2)

        self.cubes = [
            Cube(
                offset_x=self.cube_center[0], offset_y=self.cube_center[1],
                scale=80, label="OPENCODE", rotation_speed=(2.0, 3.0),
            ),
            Cube(
                offset_x=self.cube_center[0], offset_y=self.cube_center[1],
                scale=80, label="SIXEL 3D", rotation_speed=(-2.5, 3.5),
            ),
        ]

        self.frame = 0
        # Cached Sixel output dimensions (in terminal rows) for cursor repositioning
        self.sixel_rows = 0

    def clear_terminal(self):
        os.system('cls' if os.name == 'nt' else 'clear')

    def run(self):
        self.clear_terminal()
        sys.stdout.write("\033[?25l")  # hide cursor

        # ── Header: real terminal text, always crisp ──
        print("\033[38;2;0;255;255m  ╔══════════════════════════════════════════╗")
        print("  ║   \033[1mOPENCODE\033[0m\033[38;2;0;255;255m  +  \033[38;2;255;128;255m\033[1mSIXEL\033[0m\033[38;2;0;255;255m  —  Dual Rotating Cubes      ║")
        print("  ╚══════════════════════════════════════════╝\033[0m")
        print()
        print("  Press \033[1mQ\033[0m to exit  |  FPS: computing...")
        print()

        # Capture initial cursor row for Sixel output positioning
        self.sixel_rows = 0  # will be measured from first Sixel render
        time.sleep(0.5)

        last_time = time.time()
        frame_times = []

        try:
            while True:
                if msvcrt and msvcrt.kbhit():
                    key = msvcrt.getch().decode('utf-8', errors='ignore').lower()
                    if key == 'q':
                        break

                now = time.time()

                # Render both cubes onto their own canvases
                sixel_outputs = []
                for i, cube in enumerate(self.cubes):
                    pixel_matrix = [[0] * self.cube_w for _ in range(self.cube_h)]
                    cube.tick()
                    projected = [
                        cube.rotate_and_project(*v, self.cube_w, self.cube_h)
                        for v in cube.vertices
                    ]
                    for edge in cube.edges:
                        p1, p2 = projected[edge[0]], projected[edge[1]]
                        draw_line(p1[0], p1[1], p2[0], p2[1],
                                  pixel_matrix, self.cube_w, self.cube_h)

                    color = (0, 100, 0) if i == 0 else (100, 0, 100)  # cyan / magenta
                    sixel_outputs.append(generate_sixel(pixel_matrix, self.cube_w, self.cube_h, color))

                # ── Cursor to Sixel row, draw both cubes side by side ──
                # No \033[0J — just overwrite previous frame (avoids blink)
                # Row 5 = below header, col 1
                sys.stdout.write("\033[5;1H")

                # Cube labels in real terminal text
                sys.stdout.write("\033[38;2;0;255;255m  \033[1mOPENCODE\033[0m"
                                 "                                          "
                                 "\033[38;2;255;128;255m\033[1mSIXEL 3D\033[0m\n")

                # Save cursor, render cube 1
                sys.stdout.write("\033[s")       # save position
                sys.stdout.write(sixel_outputs[0])
                # Restore cursor, move right past cube 1 (~38 cols for 300px sixel)
                sys.stdout.write("\033[u\033[42C")
                sys.stdout.write(sixel_outputs[1])
                sys.stdout.write("\n")

                # FPS counter in real terminal text
                frame_times.append(now - last_time)
                if len(frame_times) > 30:
                    frame_times.pop(0)
                avg_ms = (sum(frame_times) / len(frame_times)) * 1000
                fps = len(frame_times) / (sum(frame_times) or 0.001)
                sys.stdout.write(f"\n  FPS: {fps:5.1f}  |  frame: {self.frame:5d}  |  "
                                 f"avg {avg_ms:5.1f} ms  ")
                sys.stdout.flush()

                last_time = now
                self.frame += 1
                time.sleep(0.015)

        finally:
            sys.stdout.write("\033[?25h\n")  # restore cursor
            print(f"\nRendered {self.frame} frames. Goodbye!")


if __name__ == "__main__":
    SixelDualCubeEngine().run()
