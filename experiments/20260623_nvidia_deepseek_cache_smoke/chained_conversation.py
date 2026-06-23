"""
EXPERIMENT: Chained conversation KV cache test
==============================================

Goal: Test whether DeepSeek DIRECT and NVIDIA-hosted DeepSeek
preserve KV cache across a multi-turn conversation with reasoning enabled.

This mirrors real opencode behavior: growing message history where
the prefix (system + earlier turns) should hit the cache on each
subsequent request.

PLAN:
  Provider 1: DeepSeek DIRECT  (api.deepseek.com)
  Provider 2: NVIDIA           (integrate.api.nvidia.com)

  Per provider:
    Turn 1: [system, user: "Write recursive factorial in Python"]
            → expect 0 cache hit (cold start, different system prompt)
    Turn 2: [system, user1, assistant1, user: "Now iterative"]
            → expect cache hit on prefix (system + user1 + assistant1)

  Track: prompt_cache_hit_tokens, prompt_cache_miss_tokens,
          cached_tokens, system_fingerprint, elapsed time.
"""
import json, time, sys, os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ── Auth ─────────────────────────────────────────────────────────────────────
AUTH_PATH = Path(__file__).resolve().parents[2] / "bin" / "auth.json"
with open(AUTH_PATH) as f:
    auth = json.load(f)

# ── Providers ────────────────────────────────────────────────────────────────
PROVIDERS = {
    "DeepSeek_DIRECT": {
        "url": "https://api.deepseek.com/v1/chat/completions",
        "key": auth.get("deepseek", {}).get("key", ""),
        "model": "deepseek-v4-pro",
    },
    "NVIDIA": {
        "url": "https://integrate.api.nvidia.com/v1/chat/completions",
        "key": auth.get("nvidia", {}).get("key", ""),
        "model": "deepseek-ai/deepseek-v4-pro",
    },
}

# ── Unique system prompt per experiment (prevents cross-provider cache bleed) ─
def make_system(label: str) -> str:
    """Generate a unique system prompt ~2000 tokens with a unique marker."""
    return (
        f"[EXPERIMENT: {label} | ts={time.time()}]\n"
        + "You are a helpful Python coding assistant. Always include reasoning.\n\n"
        + "RULES:\n"
        + "1. Write clean, idiomatic Python with type hints.\n"
        + "2. Use docstrings for all functions.\n"
        + "3. Prefer recursion where appropriate.\n"
        + "4. Handle edge cases explicitly.\n"
        + "5. Include brief complexity analysis.\n\n"
        + "CONTEXT:\n"
        + "Working directory: /home/user/project\n"
        + "Platform: linux\n"
        + "Python version: 3.12\n\n"
        + "PADDING:\n"
        + ("def foo(): pass  # padding line to reach token threshold\n" * 80)
    )

TURN1_USER = "Write a Python function `factorial(n: int) -> int` that computes factorial recursively. Include a docstring and handle negative inputs."

TURN2_USER = "Now write the same `factorial(n: int) -> int` function iteratively instead. Keep the same interface and error handling."

# ── Helpers ──────────────────────────────────────────────────────────────────

def call_api(url: str, key: str, model: str, messages: list,
             label: str, timeout: int = 120) -> dict | None:
    """Send chat completion request, return full JSON response."""
    body = {
        "model": model,
        "messages": messages,
        "max_tokens": 500,
        "temperature": 0,
        "stream": False,
        "thinking": {"type": "enabled"},  # deepseek-v4 reasoning
    }
    data = json.dumps(body).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if "nvidia" in url:
        headers["HTTP-Referer"] = "https://opencode.ai/"
        headers["X-Title"] = "opencode"

    req = Request(url, data=data, headers=headers)
    t0 = time.time()
    try:
        with urlopen(req, timeout=timeout) as resp:
            elapsed = time.time() - t0
            result = json.loads(resp.read().decode())
            result["_elapsed"] = elapsed
            result["_label"] = label
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
        print(f"  [{label}] {type(e).__name__}: {e} ({elapsed:.1f}s)")
        return None


def extract_assistant(resp: dict | None) -> dict | None:
    """Extract the assistant message from a response for chaining."""
    if resp is None:
        return None
    choice = resp.get("choices", [{}])[0]
    msg = choice.get("message", {})
    return {
        "role": msg.get("role", "assistant"),
        "content": msg.get("content", ""),
    }


def summarize_usage(resp: dict | None, label: str) -> str:
    """One-line cache summary."""
    if resp is None:
        return f"[{label}] NO RESPONSE"
    u = resp.get("usage", {})
    d = u.get("prompt_tokens_details", {}) or {}
    hit = u.get("prompt_cache_hit_tokens", 0)
    miss = u.get("prompt_cache_miss_tokens", 0)
    cached = d.get("cached_tokens", 0)
    total = u.get("total_tokens", "?")
    elapsed = resp.get("_elapsed", 0)
    fp = resp.get("system_fingerprint", "")[:30]
    pct = f"{(hit/(hit+miss)*100):.0f}%" if (hit + miss) > 0 else "N/A"
    return (f"[{label}] total={total} hit={hit} miss={miss} "
            f"cached={cached} hit%={pct} fp={fp} ({elapsed:.1f}s)")


# ── Chained conversation test ────────────────────────────────────────────────

def run_chain(provider_name: str, cfg: dict) -> dict:
    """Run chained conversation for one provider. Returns result dict."""
    url = cfg["url"]
    key = cfg["key"]
    model = cfg["model"]

    if not key:
        return {"provider": provider_name, "error": "NO API KEY", "turns": []}

    system_text = make_system(f"{provider_name}-chain")

    results = {
        "provider": provider_name,
        "model": model,
        "url": url,
        "system_chars": len(system_text),
        "turns": [],
    }

    # ── TURN 1: system + user1 ──────────────────────────────────────────────
    print(f"\n{'#'*70}")
    print(f"#  {provider_name} — TURN 1")
    print(f"#  messages: [system ({len(system_text)} chars), user]")
    print(f"{'#'*70}")

    msgs_t1 = [
        {"role": "system", "content": system_text},
        {"role": "user", "content": TURN1_USER},
    ]
    resp_t1 = call_api(url, key, model, msgs_t1, f"{provider_name}-T1")
    results["turns"].append(resp_t1)
    print(f"  {summarize_usage(resp_t1, 'T1')}")

    if resp_t1 is None:
        return results

    # Print full T1 response (truncated)
    t1_text = json.dumps(resp_t1, indent=2, ensure_ascii=False)
    if len(t1_text) > 3000:
        t1_text = t1_text[:3000] + "\n... [truncated]"
    print(f"  --- T1 Response JSON ---\n{t1_text}\n  --- END T1 ---")

    assistant_t1 = extract_assistant(resp_t1)
    if assistant_t1 is None:
        print("  FAIL: no assistant message in T1 response")
        return results

    time.sleep(2)

    # ── TURN 2: system + user1 + assistant1 + user2 ─────────────────────────
    print(f"\n{'#'*70}")
    print(f"#  {provider_name} — TURN 2")
    print(f"#  messages: [system, user1, assistant1, user2]")
    print(f"#  prefix (system+user1+assistant1) should HIT cache from T1")
    print(f"{'#'*70}")

    msgs_t2 = [
        {"role": "system", "content": system_text},
        {"role": "user", "content": TURN1_USER},
        assistant_t1,
        {"role": "user", "content": TURN2_USER},
    ]
    resp_t2 = call_api(url, key, model, msgs_t2, f"{provider_name}-T2")
    results["turns"].append(resp_t2)
    print(f"  {summarize_usage(resp_t2, 'T2')}")

    if resp_t2:
        t2_text = json.dumps(resp_t2, indent=2, ensure_ascii=False)
        if len(t2_text) > 3000:
            t2_text = t2_text[:3000] + "\n... [truncated]"
        print(f"  --- T2 Response JSON ---\n{t2_text}\n  --- END T2 ---")

        # Compute expected hit: T1 total tokens minus just the assistant
        # The system + user1 prefix from T1 should all be cached
        t1_prompt = resp_t1["usage"]["prompt_tokens"]
        t1_completion = resp_t1["usage"]["completion_tokens"]
        expected_prefix = t1_prompt  # system + user1 should all be cached
        t2_hit = resp_t2["usage"].get("prompt_cache_hit_tokens", 0)
        t2_miss = resp_t2["usage"].get("prompt_cache_miss_tokens", 0)
        print(f"  T1: {t1_prompt} prompt tokens → T2 should hit ~{expected_prefix}")
        print(f"  T2: hit={t2_hit} miss={t2_miss} "
              f"(expected: hit~{expected_prefix}, miss=new user2 tokens)")

    return results


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("=" * 70)
    print("  CHAINED CONVERSATION KV CACHE EXPERIMENT")
    print("  Multi-turn test with reasoning-enabled model")
    print("=" * 70)

    all_results = {}

    for name in ["DeepSeek_DIRECT", "NVIDIA"]:
        cfg = PROVIDERS[name]
        print(f"\n{'='*70}")
        print(f"  PROVIDER: {name}  |  model: {cfg['model']}")
        print(f"  endpoint: {cfg['url']}")
        print(f"  key: {'present' if cfg['key'] else 'MISSING'}")
        print(f"{'='*70}")

        if not cfg["key"]:
            print(f"  SKIP: no API key for {name}")
            all_results[name] = {"error": "NO API KEY"}
            continue

        all_results[name] = run_chain(name, cfg)
        time.sleep(3)  # gap between providers

    # ── Cross-provider comparison ────────────────────────────────────────────
    print(f"\n{'='*70}")
    print("  CROSS-PROVIDER COMPARISON")
    print(f"{'='*70}")

    for name, result in all_results.items():
        if result.get("error"):
            print(f"  {name}: {result['error']}")
            continue
        turns = result.get("turns", [])
        for i, t in enumerate(turns):
            print(f"  {name} T{i+1}: {summarize_usage(t, f'T{i+1}')}")

    print(f"\n{'='*70}")
    print("  EXPERIMENT COMPLETE")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
