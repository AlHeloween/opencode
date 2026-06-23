"""
Smoke test: NVIDIA vs direct DeepSeek prompt caching.
Isolates the API call to determine whether NVIDIA's API gateway
honors prompt_cache_key / promptCacheKey for DeepSeek models.

Reads keys from ../../bin/auth.json (portable config, not committed).
"""

import json
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

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

# Small system prompt + user message — big enough to matter for caching
SYSTEM_TEXT = "You are a helpful coding assistant. Reply concisely."
USER_TEXT = "What is 2+2? Answer with just the number."

BASE_BODY = {
    "model": None,  # set per-provider
    "messages": [
        {"role": "system", "content": SYSTEM_TEXT},
        {"role": "user", "content": USER_TEXT},
    ],
    "max_tokens": 10,
    "temperature": 0,
    "stream": False,
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def send_request(url: str, key: str, model: str, extra: dict, label: str) -> dict | None:
    """Send a chat completion request and return parsed JSON response or None."""
    body = {**BASE_BODY, "model": model, **extra}
    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    try:
        with urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            return result
    except HTTPError as e:
        err_body = e.read().decode()[:500] if e.fp else "(no body)"
        print(f"  [{label}] HTTP {e.code}: {err_body}")
        return None
    except Exception as e:
        print(f"  [{label}] Error: {e}")
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
        "cache_read_tokens": details.get("cache_read_tokens", 0),
        "cache_creation_tokens": details.get("cache_creation_tokens", 0),
        "prompt_cache_hit_tokens": usage.get("prompt_cache_hit_tokens", 0),
        "prompt_cache_miss_tokens": usage.get("prompt_cache_miss_tokens", 0),
        "system_fingerprint": resp.get("system_fingerprint", ""),
    }


def test_provider(name: str, url: str, key: str, model: str):
    """Run cache smoke test for one provider: 1st request (populate) + 2nd request (should hit)."""
    print(f"\n{'='*60}")
    print(f"  {name}  |  model={model}")
    print(f"{'='*60}")

    if not key:
        print("  SKIP: no API key configured")
        return

    # --- Test 1: camelCase (what opencode currently sends) ---
    print("\n--- camelCase: promptCacheKey (current opencode behavior) ---")
    cache_key = f"smoke-test:{model}"

    r1 = send_request(url, key, model,
        {"promptCacheKey": cache_key},
        "req1-camelCase")
    if r1:
        c1 = extract_cache_info(r1)
        print(f"  req1 (populate): tokens={c1['total_tokens']}, cached={c1['cached_tokens']}, "
              f"hit={c1['prompt_cache_hit_tokens']}, miss={c1['prompt_cache_miss_tokens']}")
        time.sleep(1)  # brief gap so cache registers
        r2 = send_request(url, key, model,
            {"promptCacheKey": cache_key},
            "req2-camelCase")
        if r2:
            c2 = extract_cache_info(r2)
            print(f"  req2 (reuse):   tokens={c2['total_tokens']}, cached={c2['cached_tokens']}, "
                  f"hit={c2['prompt_cache_hit_tokens']}, miss={c2['prompt_cache_miss_tokens']}")
            hit = c2.get("cached_tokens", 0) or c2.get("prompt_cache_hit_tokens", 0)
            print(f"  RESULT: {'CACHE HIT' if hit else 'NO CACHE'} "
                  f"(cached_tokens={hit})")

    time.sleep(1)

    # --- Test 2: snake_case (what OpenAI spec expects) ---
    print("\n--- snake_case: prompt_cache_key (OpenAI spec) ---")
    cache_key2 = f"smoke-test-snake:{model}"

    r1 = send_request(url, key, model,
        {"prompt_cache_key": cache_key2},
        "req1-snake_case")
    if r1:
        c1 = extract_cache_info(r1)
        print(f"  req1 (populate): tokens={c1['total_tokens']}, cached={c1['cached_tokens']}, "
              f"hit={c1['prompt_cache_hit_tokens']}, miss={c1['prompt_cache_miss_tokens']}")
        time.sleep(1)
        r2 = send_request(url, key, model,
            {"prompt_cache_key": cache_key2},
            "req2-snake_case")
        if r2:
            c2 = extract_cache_info(r2)
            print(f"  req2 (reuse):   tokens={c2['total_tokens']}, cached={c2['cached_tokens']}, "
                  f"hit={c2['prompt_cache_hit_tokens']}, miss={c2['prompt_cache_miss_tokens']}")
            hit = c2.get("cached_tokens", 0) or c2.get("prompt_cache_hit_tokens", 0)
            print(f"  RESULT: {'CACHE HIT' if hit else 'NO CACHE'} "
                  f"(cached_tokens={hit})")

    time.sleep(1)

    # --- Test 3: with cache_control markers (ephemeral) ---
    print("\n--- cache_control markers + prompt_cache_key (full opencode format) ---")
    cache_key3 = f"smoke-test-full:{model}"

    body_with_cache_control = [
        {"role": "system", "content": [
            {"type": "text", "text": SYSTEM_TEXT,
             "cache_control": {"type": "ephemeral"}}
        ]},
        {"role": "user", "content": USER_TEXT},
    ]

    r1 = send_request(url, key, model,
        {"prompt_cache_key": cache_key3},
        "req1-full")
    # Override messages for cache_control test
    full_body = {
        **BASE_BODY, "model": model,
        "prompt_cache_key": cache_key3,
        "messages": body_with_cache_control,
    }
    data = json.dumps(full_body).encode("utf-8")
    req = Request(url, data=data, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    try:
        with urlopen(req, timeout=30) as resp:
            r1 = json.loads(resp.read().decode())
            c1 = extract_cache_info(r1)
            print(f"  req1 (populate): tokens={c1['total_tokens']}, cached={c1['cached_tokens']}, "
                  f"hit={c1['prompt_cache_hit_tokens']}, miss={c1['prompt_cache_miss_tokens']}")
    except Exception as e:
        print(f"  req1-full Error: {e}")
        r1 = None

    if r1:
        time.sleep(1)
        try:
            with urlopen(req, timeout=30) as resp:
                r2 = json.loads(resp.read().decode())
                c2 = extract_cache_info(r2)
                print(f"  req2 (reuse):   tokens={c2['total_tokens']}, cached={c2['cached_tokens']}, "
                      f"hit={c2['prompt_cache_hit_tokens']}, miss={c2['prompt_cache_miss_tokens']}")
                hit = c2.get("cached_tokens", 0) or c2.get("prompt_cache_hit_tokens", 0)
                print(f"  RESULT: {'CACHE HIT' if hit else 'NO CACHE'} "
                      f"(cached_tokens={hit})")
        except Exception as e:
            print(f"  req2-full Error: {e}")

    # --- Test 4: no cache key (baseline — should never cache) ---
    print("\n--- No cache key (baseline control) ---")
    r1 = send_request(url, key, model, {}, "req1-no-key")
    if r1:
        c1 = extract_cache_info(r1)
        print(f"  req1 (populate): tokens={c1['total_tokens']}, cached={c1['cached_tokens']}")
        time.sleep(1)
        r2 = send_request(url, key, model, {}, "req2-no-key")
        if r2:
            c2 = extract_cache_info(r2)
            print(f"  req2 (reuse):   tokens={c2['total_tokens']}, cached={c2['cached_tokens']}")
            hit = c2.get("cached_tokens", 0) or c2.get("prompt_cache_hit_tokens", 0)
            print(f"  RESULT: {'CACHE HIT' if hit else 'NO CACHE'} (expected: NO CACHE)")

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  NVIDIA vs DeepSeek Cache Smoke Test")
    print(f"  Auth: {AUTH_PATH}")
    print(f"  NVIDIA key: {'present' if NVIDIA_KEY else 'MISSING'}")
    print(f"  DeepSeek key: {'present' if DEEPSEEK_KEY else 'MISSING'}")
    print("=" * 60)

    # Test direct DeepSeek first (known-working baseline)
    test_provider("DeepSeek DIRECT", DEEPSEEK_URL, DEEPSEEK_KEY, DEEPSEEK_MODEL)

    # Test NVIDIA (the failing case)
    test_provider("NVIDIA", NVIDIA_URL, NVIDIA_KEY, NVIDIA_MODEL)

    print("\n" + "=" * 60)
    print("  Smoke test complete.")
    print("=" * 60)

if __name__ == "__main__":
    main()
