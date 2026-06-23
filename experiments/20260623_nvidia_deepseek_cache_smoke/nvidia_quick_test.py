"""Quick test: NVIDIA chat completions endpoint."""
import json, time, ssl, socket

with open("bin/auth.json") as f:
    auth = json.load(f)
nvidia_key = auth["nvidia"]["key"]

host = "integrate.api.nvidia.com"
port = 443

body = json.dumps({
    "model": "deepseek-ai/deepseek-v4-pro",
    "messages": [{"role": "user", "content": "Say hi"}],
    "max_tokens": 10,
    "temperature": 0,
    "stream": False,
})

req = (
    f"POST /v1/chat/completions HTTP/1.1\r\n"
    f"Host: {host}\r\n"
    f"Authorization: Bearer {nvidia_key}\r\n"
    f"Content-Type: application/json\r\n"
    f"Content-Length: {len(body)}\r\n"
    f"Connection: close\r\n"
    f"\r\n"
    f"{body}"
).encode()

print(f"Sending request to {host}...")
t0 = time.time()
sock = socket.create_connection((host, port), timeout=10)
ctx = ssl.create_default_context()
ssock = ctx.wrap_socket(sock, server_hostname=host)
ssock.settimeout(30)
ssock.sendall(req)

resp = b""
while True:
    try:
        chunk = ssock.recv(4096)
        if not chunk:
            break
        resp += chunk
    except socket.timeout:
        print("TIMEOUT while reading response")
        break

ssock.close()
elapsed = time.time() - t0
text = resp.decode("utf-8", errors="replace")

# Find JSON body (after headers)
parts = text.split("\r\n\r\n", 1)
if len(parts) > 1:
    headers = parts[0]
    body_text = parts[1]
    status_line = headers.split("\r\n")[0]
    print(f"Response: {status_line} ({elapsed:.1f}s)")
    print(f"Body: {body_text[:1000]}")
else:
    print(f"Raw response ({elapsed:.1f}s): {text[:500]}")
