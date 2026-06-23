"""
Smoke test v2: NVIDIA vs direct DeepSeek prompt caching.
Uses a realistic-sized system prompt (~2K tokens) since most
providers require minimum thresholds for cache activation.

Reads keys from ../../bin/auth.json (portable config, not committed).
"""

import json
import socket
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ── Load auth ────────────────────────────────────────────────────────────────
AUTH_PATH = Path(__file__).resolve().parents[2] / "bin" / "auth.json"
with open(AUTH_PATH) as f:
    auth = json.load(f)

NVIDIA_KEY = auth.get("nvidia", {}).get("key", "")
DEEPSEEK_KEY = auth.get("deepseek", {}).get("key", "")

# ── Config ───────────────────────────────────────────────────────────────────
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"

NVIDIA_MODEL = "deepseek-ai/deepseek-v4-pro"
DEEPSEEK_MODEL = "deepseek-v4-pro"

# Generate a realistic-sized system prompt (~2000 chars, ~500 tokens)
# to cross the minimum cache threshold most providers use.
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

USER_TEXT = "What is 2+2? Reply with only the number."

# ── Helpers ──────────────────────────────────────────────────────────────────

def check_connectivity(url: str) -> bool:
    """Quick DNS/TCP check."""
    host = url.split("//")[1].split("/")[0]
    port = 443
    try:
        socket.create_connection((host, port), timeout=5)
        return True
    except Exception as e:
        print(f"  CONNECTIVITY FAIL: {host}:{port} — {e}")
        return False


def send_request(url: str, key: str, model: str, extra: dict, label: str,
                 timeout: int = 60) -> dict | None:
    """Send a chat completion request and return parsed JSON response."""
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": LARGE_SYSTEM},
            {"role": "user", "content": USER_TEXT},
        ],
        "max_tokens": 10,
        "temperature": 0,
        "stream": False,
        **extra,
    }
    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    t0 = time.time()
    try:
        with urlopen(req, timeout=timeout) as resp:
            elapsed = time.time() - t0
            result = json.loads(resp.read().decode())
            result["_elapsed"] = elapsed
            return result
    except HTTPError as e:
        elapsed = time.time() - t0
        err_body = e.read().decode()[:500] if e.fp else "(no body)"
        print(f"  [{label}] HTTP {e.code} in {elapsed:.1f}s: {err_body}")
        return None
    except URLError as e:
        elapsed = time.time() - t0
        print(f"  [{label}] URLError in {elapsed:.1f}s: {e.reason}")
        return None
    except TimeoutError:
        elapsed = time.time() - t0
        print(f"  [{label}] TIMEOUT after {elapsed:.1f}s")
        return None
    except Exception as e:
        elapsed = time.time() - t0
        print(f"  [{label}] Error in {elapsed:.1f}s: {type(e).__name__}: {e}")
        return None


def extract_cache_info(resp: dict | None) -> dict:
    """Extract cache-related info from response."""
    if resp is None:
        return {"error": "no response"}
    usage = resp.get("usage", {})
    details = usage.get("prompt_tokens_details", {}) or {}
    return {
        "total_tokens": usage.get("total_tokens"),
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "cached_tokens": details.get("cached_tokens", 0),
        "prompt_cache_hit_tokens": usage.get("prompt_cache_hit_tokens", 0),
        "prompt_cache_miss_tokens": usage.get("prompt_cache_miss_tokens", 0),
        "elapsed": resp.get("_elapsed", 0),
    }


def test_pair(url: str, key: str, model: str, label: str, extra1: dict,
              extra2: dict | None = None):
    """Send 2 requests with same cache key, check if 2nd hits cache."""
    if extra2 is None:
        extra2 = extra1

    r1 = send_request(url, key, model, extra1, f"{label}-req1")
    if r1 is None:
        print(f"  [{label}] SKIP: first request failed")
        return

    c1 = extract_cache_info(r1)
    print(f"  [{label}] req1: total={c1['total_tokens']} prompt={c1['prompt_tokens']} "
          f"hit={c1['prompt_cache_hit_tokens']} miss={c1['prompt_cache_miss_tokens']} "
          f"({c1['elapsed']:.1f}s)")

    time.sleep(2)  # allow cache to settle

    r2 = send_request(url, key, model, extra2, f"{label}-req2")
    if r2 is None:
        print(f"  [{label}] SKIP: second request failed")
        return

    c2 = extract_cache_info(r2)
    hit = c2.get("prompt_cache_hit_tokens", 0) or c2.get("cached_tokens", 0)
    miss = c2.get("prompt_cache_miss_tokens", 0)
    print(f"  [{label}] req2: total={c2['total_tokens']} prompt={c2['prompt_tokens']} "
          f"hit={hit} miss={miss} ({c2['elapsed']:.1f}s)")

    if hit > 0:
        pct = (hit / (hit + miss) * 100) if (hit + miss) > 0 else 0
        print(f"  [{label}] >>> CACHE HIT: {hit}/{hit+miss} tokens ({pct:.0f}%) <<<")
    elif miss > 0:
        print(f"  [{label}] >>> NO CACHE: {miss} tokens missed <<<")
    else:
        print(f"  [{label}] >>> UNKNOWN: no cache tokens reported <<<")

    return {"hit": hit, "miss": miss}


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  NVIDIA vs DeepSeek Cache Smoke Test v2")
    print(f"  System prompt: ~{len(LARGE_SYSTEM)} chars")
    print(f"  NVIDIA key: {'present' if NVIDIA_KEY else 'MISSING'}")
    print(f"  DeepSeek key: {'present' if DEEPSEEK_KEY else 'MISSING'}")
    print("=" * 60)

    # ── Connectivity check ──────────────────────────────────────────────────
    print("\n--- Connectivity check ---")
    ds_ok = check_connectivity(DEEPSEEK_URL)
    nv_ok = check_connectivity(NVIDIA_URL)
    if not ds_ok and not nv_ok:
        print("  FATAL: neither API reachable")
        return

    # ── Test: DeepSeek DIRECT (known-working baseline) ─────────────────────
    if DEEPSEEK_KEY and ds_ok:
        print(f"\n{'='*60}")
        print(f"  DeepSeek DIRECT  |  {DEEPSEEK_MODEL}")
        print(f"{'='*60}")

        cache_key = "smoke-test-v2:ds-direct"
        test_pair(DEEPSEEK_URL, DEEPSEEK_KEY, DEEPSEEK_MODEL,
                  "DS-snake", {"prompt_cache_key": cache_key})

        time.sleep(2)
        test_pair(DEEPSEEK_URL, DEEPSEEK_KEY, DEEPSEEK_MODEL,
                  "DS-camel", {"promptCacheKey": cache_key + "-camel"})

    # ── Test: NVIDIA ───────────────────────────────────────────────────────
    if NVIDIA_KEY and nv_ok:
        print(f"\n{'='*60}")
        print(f"  NVIDIA  |  {NVIDIA_MODEL}")
        print(f"{'='*60}")

        cache_key = "smoke-test-v2:nv"
        test_pair(NVIDIA_URL, NVIDIA_KEY, NVIDIA_MODEL,
                  "NV-snake", {"prompt_cache_key": cache_key})

        time.sleep(2)
        test_pair(NVIDIA_URL, NVIDIA_KEY, NVIDIA_MODEL,
                  "NV-camel", {"promptCacheKey": cache_key + "-camel"})

    # ── Summary ────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  Smoke test v2 complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
