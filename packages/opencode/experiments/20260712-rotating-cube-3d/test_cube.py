import os
import sys
import time
import math
import subprocess
from pathlib import Path

# Try importing Windows keyboard utilities
try:
    import msvcrt
except ImportError:
    msvcrt = None

# 1. DYNAMIC DEPENDENCY RESOLVER (From previous step)
def resolve_and_inject_dependencies():
    target_files = ["dxcompiler.dll", "dxil.dll"] if sys.platform.startswith("win32") else ["dxc"]
    lookup_cmd = ["where.exe"] if sys.platform.startswith("win32") else ["which"]
    discovered_paths = set()
    for file_name in target_files:
        try:
            res = subprocess.run(lookup_cmd + [file_name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            for line in res.stdout.strip().splitlines():
                p = Path(line.strip()).parent
                if p.exists(): discovered_paths.add(str(p))
        except subprocess.CalledProcessError: continue
    for path_entry in discovered_paths:
        if sys.platform.startswith("win32") and "x86" in path_entry.lower() and "x64" not in path_entry.lower(): continue
        if path_entry not in os.environ["PATH"]: os.environ["PATH"] = path_entry + os.pathsep + os.environ["PATH"]
        if sys.platform.startswith("win32"):
            try: os.add_dll_directory(path_entry)
            except Exception: pass

resolve_and_inject_dependencies()

# Import wgpu after paths have been cleanly mounted
import wgpu

# 2. COMPUTE SHADER CODE (WGSL)
# Computes 3D rotations, projects vectors, and rasterizes pixels into a continuous storage buffer.
COMPUTE_SHADER = """
struct Vertex { x: f32, y: f32, z: f32, padding: f32 };
struct Edge { v0: u32, v1: u32 };
struct Config { width: u32, height: u32, angle_x: f32, angle_y: f32 };

@group(0) @binding(0) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(1) var<storage, read> edges: array<Edge>;
@group(0) @binding(2) var<uniform> config: Config;
@group(0) @binding(3) var<storage, read_write> pixel_buffer: array<u32>;

// Helper function to rasterize a line into the pixel array using Bresenham's logic
fn draw_line(x0_in: i32, y0_in: i32, x1_in: i32, y1_in: i32) {
    var x0 = x0_in; var y0 = y0_in; var x1 = x1_in; var y1 = y1_in;
    let dx = abs(x1 - x0); let dy = abs(y1 - y0);
    var sx: i32 = -1; if (x0 < x1) { sx = 1; }
    var sy: i32 = -1; if (y0 < y1) { sy = 1; }
    var err = dx - dy;

    loop {
        if (x0 >= 0 && x0 < i32(config.width) && y0 >= 0 && y0 < i32(config.height)) {
            let index = u32(y0) * config.width + u32(x0);
            pixel_buffer[index] = 1u; // Turn hardware pixel on
        }
        if (x0 == x1 && y0 == y1) { break; }
        let e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    // We only need the very first thread (0) to run this entire frame draw
    if (id.x != 0u) { return; }

    // 1. Clear the pixel canvas completely
    let total_pixels = config.width * config.height;
    for (var i = 0u; i < total_pixels; i = i + 1u) {
        pixel_buffer[i] = 0u;
    }
    
    // 2. Compute and rasterize all 12 edges sequentially to prevent collision
    for (var edge_idx = 0u; edge_idx < 12u; edge_idx = edge_idx + 1u) {
        let edge = edges[edge_idx];
        let v0 = vertices[edge.v0];
        let v1 = vertices[edge.v1];

        // 3D Matrix Rotations
        let cos_x = cos(config.angle_x); let sin_x = sin(config.angle_x);
        let cos_y = cos(config.angle_y); let sin_y = sin(config.angle_y);

        // Rotate Vertex 0
        var y0_r = v0.y * cos_x - v0.z * sin_x;
        var z0_r = v0.y * sin_x + v0.z * cos_x;
        var x0_r = v0.x * cos_y + z0_r * sin_y;
        z0_r = -v0.x * sin_y + z0_r * cos_y;

        // Rotate Vertex 1
        var y1_r = v1.y * cos_x - v1.z * sin_x;
        var z1_r = v1.y * sin_x + v1.z * cos_x;
        var x1_r = v1.x * cos_y + z1_r * sin_y;
        z1_r = -v1.x * sin_y + z1_r * cos_y;

        // 3D to 2D Perspective Projection
        let f0 = 120.0 / (z0_r + 4.0);
        let px0 = i32(f32(config.width) / 2.0 + x0_r * f0);
        let py0 = i32(f32(config.height) / 2.0 + y0_r * f0);

        let f1 = 120.0 / (z1_r + 4.0);
        let px1 = i32(f32(config.width) / 2.0 + x1_r * f1);
        let py1 = i32(f32(config.height) / 2.0 + y1_r * f1);

        // Draw the line into the buffer safely
        draw_line(px0, py0, px1, py1);
    }
}
"""

class WgpuSixelEngine:
    def __init__(self):
        self.width, self.height = 300, 300
        self.angle_x, self.angle_y = 0.0, 0.0

        # Create WebGPU Device Context using standard explicit pipeline configurations
        self.adapter = wgpu.gpu.request_adapter(power_preference="high-performance")
        self.device = self.adapter.request_device()

        # Compile WebGPU shader asset code 
        self.shader_module = self.device.create_shader_module(code=COMPUTE_SHADER)

        self.setup_gpu_buffers()

    def setup_gpu_buffers(self):
        # 3D Positions Matrix Setup Data Array 
        vertices_data = bytearray()
                # Define 8 precise vertices for a symmetric 3D Cube (X, Y, Z)
        raw_v = [
            [-1.0, -1.0, -1.0],  # 0: Back-Bottom-Left
            [ 1.0, -1.0, -1.0],  # 1: Back-Bottom-Right
            [ 1.0,  1.0, -1.0],  # 2: Back-Top-Right
            [-1.0,  1.0, -1.0],  # 3: Back-Top-Left
            [-1.0, -1.0,  1.0],  # 4: Front-Bottom-Left
            [ 1.0, -1.0,  1.0],  # 5: Front-Bottom-Right
            [ 1.0,  1.0,  1.0],  # 6: Front-Top-Right
            [-1.0,  1.0,  1.0]   # 7: Front-Top-Left
        ]

        for v in raw_v:
            import struct
            vertices_data.extend(struct.pack("ffff", v[0], v[1], v[2], 0.0)) # 16-byte aligned

        edges_data = bytearray()
        raw_e = [(0,1), (1,2), (2,3), (3,0), (4,5), (5,6), (6,7), (7,4), (0,4), (1,5), (2,6), (3,7)]
        for e in raw_e:
            import struct
            edges_data.extend(struct.pack("II", e[0], e[1]))

        # Instantiate GPU Buffers
        self.b_vert = self.device.create_buffer_with_data(data=vertices_data, usage=wgpu.BufferUsage.STORAGE)
        self.b_edge = self.device.create_buffer_with_data(data=edges_data, usage=wgpu.BufferUsage.STORAGE)
        self.b_config = self.device.create_buffer(size=16, usage=wgpu.BufferUsage.UNIFORM | wgpu.BufferUsage.COPY_DST)
        
        # Pixels Buffer Storage
        self.pixel_buffer_size = self.width * self.height * 4
        self.b_pixel = self.device.create_buffer(size=self.pixel_buffer_size, usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC)
        self.b_readback = self.device.create_buffer(size=self.pixel_buffer_size, usage=wgpu.BufferUsage.COPY_DST | wgpu.BufferUsage.MAP_READ)

        # Map Binding Layout Profiles
        b_layout = [
            {"binding": 0, "visibility": wgpu.ShaderStage.COMPUTE, "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
            {"binding": 1, "visibility": wgpu.ShaderStage.COMPUTE, "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
            {"binding": 2, "visibility": wgpu.ShaderStage.COMPUTE, "buffer": {"type": wgpu.BufferBindingType.uniform}},
            {"binding": 3, "visibility": wgpu.ShaderStage.COMPUTE, "buffer": {"type": wgpu.BufferBindingType.storage}},
        ]
        self.bind_group_layout = self.device.create_bind_group_layout(entries=b_layout)
        self.pipeline_layout = self.device.create_pipeline_layout(bind_group_layouts=[self.bind_group_layout])
        self.compute_pipeline = self.device.create_compute_pipeline(layout=self.pipeline_layout, compute={"module": self.shader_module, "entry_point": "main"})

        self.bind_group = self.device.create_bind_group(layout=self.bind_group_layout, entries=[
            {"binding": 0, "resource": {"buffer": self.b_vert, "offset": 0, "size": len(vertices_data)}},
            {"binding": 1, "resource": {"buffer": self.b_edge, "offset": 0, "size": len(edges_data)}},
            {"binding": 2, "resource": {"buffer": self.b_config, "offset": 0, "size": 16}},
            {"binding": 3, "resource": {"buffer": self.b_pixel, "offset": 0, "size": self.pixel_buffer_size}},
        ])

    def generate_sixel_stream(self, pixel_data_uint32):
        """ Translates raw 1D pixel status integers directly into formatted Sixel buffers. """
        out = ["\033Pq#0;2;0;90;90#0"] # Palette Register #0 = Soft Cyan Tint
        for y_band in range(0, self.height, 6):
            for x in range(self.width):
                sixel_code = 0
                for bit in range(6):
                    y = y_band + bit
                    if y < self.height:
                        # Extract integer index value sequence state
                        if pixel_data_uint32[y * self.width + x] > 0:
                            sixel_code |= (1 << bit)
                out.append(chr(63 + sixel_code))
            out.append("-")
        out.append("\033\\")
        return "".join(out)

    def run_loop(self):
        os.system('cls' if os.name == 'nt' else 'clear')
        sys.stdout.write("\033[?25l") # Hide typing cursor
        print("WebGPU Engine Active. Streaming live hardware pixels directly via Sixels...")
        time.sleep(1)

        import struct
        try:
            while True:
                if msvcrt and msvcrt.kbhit() and msvcrt.getch().decode('utf-8', errors='ignore').lower() == 'q':
                    break

                # 1. Push modern orientation updates into Uniform buffers
                config_bytes = struct.pack("IIff", self.width, self.height, self.angle_x, self.angle_y)
                self.device.queue.write_buffer(self.b_config, 0, config_bytes)

                # 2. Construct GPU Work Command Encoder Dispatch Pipeline
                encoder = self.device.create_command_encoder()
                compute_pass = encoder.begin_compute_pass()
                compute_pass.set_pipeline(self.compute_pipeline)
                compute_pass.set_bind_group(0, self.bind_group, [], 0, 0)
                compute_pass.dispatch_workgroups(12, 1, 1) # 1 thread per edge segment line
                compute_pass.end()

                # Copy GPU pixel canvas array storage to staging buffer
                encoder.copy_buffer_to_buffer(self.b_pixel, 0, self.b_readback, 0, self.pixel_buffer_size)
                self.device.queue.submit([encoder.finish()])
                                # =======================================================
                # 3. Readback pixels safely from GPU
                # =======================================================
                # Using map_sync forces Python to wait until the buffer is ready.
                # Do NOT include device.poll() here.
                self.b_readback.map_sync(wgpu.MapMode.READ)
                
                # The buffer is now guaranteed to be mapped!
                view = self.b_readback.read_mapped()
                
                # Convert buffer views to uint32 elements natively 
                import numpy as np
                pixel_data = np.frombuffer(view, dtype=np.uint32)

                # 4. Stream pixel bytes as hardware Sixel imagery to Terminal output
                sys.stdout.write("\033[H" + self.generate_sixel_stream(pixel_data))
                sys.stdout.flush()

                # CRITICAL: Always unmap so the GPU can use the buffer again next frame!
                self.b_readback.unmap()
                # =======================================================
                # Progress loop velocities
                self.angle_x += 0.04
                self.angle_y += 0.05
                time.sleep(0.01)
        finally:
            sys.stdout.write("\033[?25h\n")
            
if __name__ == "__main__":
    WgpuSixelEngine().run_loop()