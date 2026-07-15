import struct, zlib, base64

W, H = 320, 80

def chunk(ctype, data=b""):
    c = data or b""
    crc = zlib.crc32(ctype + c) & 0xFFFFFFFF
    return struct.pack(">I", len(c)) + ctype + c + struct.pack(">I", crc)

raw = bytearray()
for y in range(H):
    for x in range(W):
        r = int(x / W * 255)
        g = int((1 - abs(x - W/2) / (W/2)) * 255)
        b = int(128 + 127 * __import__("math").sin(x * 0.05))
        raw.extend([r, g, b])

comp = zlib.compress(bytes(raw))
ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND")

b64 = base64.b64encode(png).decode()
path = r"D:\zPython\opencode\packages\opencode\experiments\tui-image-rendering\test-pattern.png.b64"
with open(path, "w") as f:
    f.write(b64)
print(f"OK — {len(b64)} chars written to {path}")
