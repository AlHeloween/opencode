"""Quick check: list DeepSeek models available on NVIDIA API."""
import json, ssl, socket, re
with open("bin/auth.json") as f:
    key = json.load(f)["nvidia"]["key"]

host = "integrate.api.nvidia.com"
sock = socket.create_connection((host, 443), timeout=10)
ssock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
req = f"GET /v1/models HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {key}\r\nConnection: close\r\n\r\n".encode()
ssock.sendall(req)

# Read full response
raw = b""
while True:
    try:
        chunk = ssock.recv(65536)
        if not chunk:
            break
        raw += chunk
    except Exception:
        break
ssock.close()
text = raw.decode("utf-8", errors="replace")

# Parse chunked transfer encoding
header_body = text.split("\r\n\r\n", 1)
if len(header_body) < 2:
    print("ERROR: no body")
    print(text[:500])
    exit(1)

headers = header_body[0]
raw_body = header_body[1]

# Dechunk
body = ""
pos = 0
while pos < len(raw_body):
    crlf = raw_body.find("\r\n", pos)
    if crlf < 0:
        break
    hex_size = raw_body[pos:crlf]
    try:
        size = int(hex_size, 16)
    except ValueError:
        break
    if size == 0:
        break
    chunk_start = crlf + 2
    body += raw_body[chunk_start:chunk_start + size]
    pos = chunk_start + size + 2  # skip chunk + trailing \r\n

# Handle non-chunked fallback
if not body:
    body = raw_body

data = json.loads(body)
models = [m["id"] for m in data.get("data", [])]
deepseek_models = [m for m in models if "deepseek" in m.lower()]
print(f"Total models: {len(models)}")
print(f"DeepSeek models ({len(deepseek_models)}):")
for m in deepseek_models:
    marker = " <-- TARGET" if m == "deepseek-ai/deepseek-v4-pro" else ""
    print(f"  {m}{marker}")

if "deepseek-ai/deepseek-v4-pro" not in deepseek_models:
    print("\nWARNING: deepseek-ai/deepseek-v4-pro NOT in model list!")
