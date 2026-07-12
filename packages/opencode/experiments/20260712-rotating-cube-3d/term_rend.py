import os
import sys
import time
import math
try:
    import msvcrt  # Windows keyboard input
except ImportError:
    pass

class SixelCubeEngine:
    def __init__(self):
        # 1. Real Hardware Pixel Canvas Dimensions
        self.width = 300
        self.height = 300
        
        # 3D Math configurations
        self.vertices = [
            [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
            [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1]
        ]
        self.edges = [
            (0,1), (1,2), (2,3), (3,0), (4,5), (5,6), 
            (6,7), (7,4), (0,4), (1,5), (2,6), (3,7)
        ]
        self.angle_x = 0.0
        self.angle_y = 0.0

    def rotate_and_project(self, x, y, z):
        # Rotate X & Y
        rad_x, rad_y = math.radians(self.angle_x), math.radians(self.angle_y)
        y, z = y * math.cos(rad_x) - z * math.sin(rad_x), y * math.sin(rad_x) + z * math.cos(rad_x)
        x, z = x * math.cos(rad_y) + z * math.sin(rad_y), -x * math.sin(rad_y) + z * math.cos(rad_y)
        
        # Perspective Projection
        factor = 120 / (z + 4.0)
        return int(self.width / 2 + x * factor), int(self.height / 2 + y * factor)

    def draw_line(self, x0, y0, x1, y1, pixel_matrix):
        # Bresenham's algorithm to plot true pixels into our array matrix
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        while True:
            if 0 <= x0 < self.width and 0 <= y0 < self.height:
                pixel_matrix[y0][x0] = 1 # Mark pixel as active
            if x0 == x1 and y0 == y1: break
            e2 = 2 * err
            if e2 > -dy: err -= dy; x0 += sx
            if e2 < dx: err += dx; y0 += sy

    def generate_sixel_stream(self, pixel_matrix):
        """
        Converts our 2D pixel array into raw standard SIXEL bytes.
        Sixel groups 6 vertical pixels into a single character column block.
        """
        # Sixel Protocol Headers: \033Pq (Start) -> #0;2;0;100;0 (Define Color 0 as Cyan)
        out = ["\033Pq#0;2;0;100;0#0"]
        
        # Process rows in bands of 6 vertical pixels
        for y_band in range(0, self.height, 6):
            for x in range(self.width):
                sixel_char_code = 0
                for bit in range(6):
                    y = y_band + bit
                    if y < self.height and pixel_matrix[y][x]:
                        sixel_char_code |= (1 << bit)
                # Sixel characters are offset by ASCII 63 (?)
                out.append(chr(0x3f + sixel_char_code))
            out.append("-") # Sixel newline command
            
        out.append("\033\\") # Sixel End Escape Sequence
        return "".join(out)

    def run(self):
        # Clear terminal screen completely
        os.system('cls' if os.name == 'nt' else 'clear')
        sys.stdout.write("\033[?25l") # Hide text cursor
        
        print("Rendering native hardware pixels via Sixel... Press 'Q' to exit.")
        time.sleep(1)

        try:
            while True:
                if msvcrt.kbhit() and msvcrt.getch().decode('utf-8', errors='ignore').lower() == 'q':
                    break

                # Initialize an empty pixel canvas layout array
                pixel_matrix = [[0] * self.width for _ in range(self.height)]
                
                # Project 3D points
                projected = [self.rotate_and_project(*v) for v in self.vertices]
                
                # Rasterize edges into pixel data bits
                for edge in self.edges:
                    p1, p2 = projected[edge[0]], projected[edge[1]]
                    self.draw_line(p1[0], p1[1], p2[0], p2[1], pixel_matrix)

                # Return cursor to top-left and blast the native Sixel pixel data stream
                sys.stdout.write("\033[H" + self.generate_sixel_stream(pixel_matrix))
                sys.stdout.flush()

                self.angle_x += 3.0
                self.angle_y += 4.0
                time.sleep(0.02)
        finally:
            sys.stdout.write("\033[?25h\n") # Restore text cursor

if __name__ == "__main__":
    SixelCubeEngine().run()
