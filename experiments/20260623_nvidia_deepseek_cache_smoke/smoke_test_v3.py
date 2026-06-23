"""
Smoke test v3: Print FULL response JSON from DeepSeek DIRECT API.
Shows exactly what fields the API returns for cache diagnostics.
"""
import json, time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

AUTH_PATH = Path(__file__).resolve().parents[2] / "bin" / "auth.json"
with open(AUTH_PATH) as f:
    auth = json.load(f)

DEEPSEEK_KEY = auth["deepseek"]["key"]
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL = "deepseek-v4-pro"

# Same large system prompt from v2
LARGE_SYSTEM = (
    "You are a helpful coding assistant. Follow these rules carefully.\n\n"
    + "RULE 1: Always respond in valid markdown.\n"
    + "RULE 2: Use proper code fencing with language tags.\n"
    + "RULE 3: Never include sensitive data in responses.\n"
    + "RULE 4: Prefer functional programming patterns.\n"
    + "RULE 5: Use type annotations and clear variable names.\n\n"
    + "CONTEXT:\n"
    + "Working directory: /home/user/project\n"
    + "Platform: linux\n"
    + "Git branch: main\n\n"
    + "AVAILABLE TOOLS:\n"
    + "- read: Read file contents from disk\n"
    + "- write: Write file contents to disk\n"
    + "- edit: Edit existing files\n"
    + "- bash: Execute shell commands\n"
    + "- grep: Search file contents\n"
    + "- glob: Find files by pattern\n"
    + "- task: Launch sub-agent for complex work\n\n"
    + "REPEATED PADDING TO REACH TOKEN THRESHOLD:\n"
    + ("The quick brown fox jumps over the lazy dog. " * 50 + "\n")
    + ("Lorem ipsum dolor sit amet consectetur adipiscing elit. " * 50 + "\n")
    + ("All work and no play makes Jack a dull boy. " * 50 + "\n")
)

CACHE_KEY = "smoke-test-v3:ds"

def send(label: str, key: str) -> dict | None:
    body = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": LARGE_SYSTEM},
            {"role": "user", "content": "What is 2+2? Reply with only the number."},
        ],
        "max_tokens": 10,
        "temperature": 0,
        "stream": False,
        "prompt_cache_key": key,
    }
    data = json.dumps(body).encode("utf-8")
    req = Request(DEEPSEEK_URL, data=data, headers={
        "Authorization": f"Bearer {DEEPSEEK_KEY}",
        "Content-Type": "application/json",
    })
    t0 = time.time()
    try:
        with urlopen(req, timeout=30) as resp:
            elapsed = time.time() - t0
            result = json.loads(resp.read().decode())
            result["_elapsed"] = elapsed
            result["_label"] = label
            return result
    except HTTPError as e:
        err_body = e.read().decode()[:500] if e.fp else "(no body)"
        print(f"[{label}] HTTP {e.code}: {err_body}")
        return None

# ── Run ──────────────────────────────────────────────────────────────────────
print(f"Model: {DEEPSEEK_MODEL}")
print(f"System prompt: {len(LARGE_SYSTEM)} chars\n")

# REQ 1: populate cache
print("=" * 70)
print("REQUEST 1 (populate cache)")
print("=" * 70)
r1 = send("req1", CACHE_KEY)
if r1:
    print(json.dumps(r1, indent=2, ensure_ascii=False))

time.sleep(2)

# REQ 2: should hit cache
print("\n" + "=" * 70)
print("REQUEST 2 (cache hit expected)")
print("=" * 70)
r2 = send("req2", CACHE_KEY)
if r2:
    print(json.dumps(r2, indent=2, ensure_ascii=False))

# ── Summary ─────────────────────────────────────────────────────────────────
if r1 and r2:
    print("\n" + "=" * 70)
    print("COMPARISON")
    print("=" * 70)
    u1 = r1.get("usage", {})
    u2 = r2.get("usage", {})
    d1 = u1.get("prompt_tokens_details", {}) or {}
    d2 = u2.get("prompt_tokens_details", {}) or {}
    print(f"req1: total={u1.get('total_tokens')} prompt={u1.get('prompt_tokens')} "
          f"cached={d1.get('cached_tokens',0)} "
          f"cache_hit={u1.get('prompt_cache_hit_tokens',0)} "
          f"cache_miss={u1.get('prompt_cache_miss_tokens',0)} "
          f"({r1.get('_elapsed',0):.1f}s)")
    print(f"req2: total={u2.get('total_tokens')} prompt={u2.get('prompt_tokens')} "
          f"cached={d2.get('cached_tokens',0)} "
          f"cache_hit={u2.get('prompt_cache_hit_tokens',0)} "
          f"cache_miss={u2.get('prompt_cache_miss_tokens',0)} "
          f"({r2.get('_elapsed',0):.1f}s)")
    print(f"\nResponse id match: {r1.get('id') == r2.get('id')}")
    print(f"System fingerprint: req1={r1.get('system_fingerprint','')} "
          f"req2={r2.get('system_fingerprint','')}")
