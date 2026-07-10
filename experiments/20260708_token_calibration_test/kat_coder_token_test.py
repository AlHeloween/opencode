"""
Token calibration test for kat-coder-pro-v2 (StreamLake, likely Qwen3-based).
Compares chars/4, tiktoken, and Qwen3 tokenizers with the provider's actual
prompt_tokens. When we hit the context limit, parses the error for the limit.

Compares all available tokenizers to find the best match for this model family.

Reads API key from ../../bin/auth.json (streamlake-openai-1.key).
Requires: pip install tiktoken tokenizers transformers
"""
import json
import re
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# ── Auth ──────────────────────────────────────────────────────────────────────
AUTH_PATH = Path(__file__).resolve().parents[2] / "bin" / "auth.json"
with open(AUTH_PATH) as f:
    auth = json.load(f)

API_KEY = auth.get("streamlake-openai-1", {}).get("key", "")
if not API_KEY:
    sys.exit("No streamlake-openai-1 key in bin/auth.json")

API_URL = "https://vanchin.streamlake.ai/api/gateway/coding/v1/chat/completions"
MODEL = "ep-23exxd-1776195159781896082"

# ── Tokenizer estimates ──────────────────────────────────────────────────────

def estimate_chars4(text: str) -> int:
    """opencode fallback heuristic: chars / 4"""
    return len(text) // 4


def estimate_tiktoken(text: str) -> int | None:
    """tiktoken o200k_base count (if tiktoken installed)."""
    try:
        import tiktoken
        enc = tiktoken.get_encoding("o200k_base")
        return len(enc.encode(text))
    except ImportError:
        return None


def estimate_qwen3(text: str) -> int | None:
    """Qwen3 tokenizer via HuggingFace tokenizers library.
    kat-coder-pro-v2 is likely Qwen3-based -- this should be the closest match."""
    try:
        from transformers import AutoTokenizer
        tok = AutoTokenizer.from_pretrained("Qwen/Qwen3-8B", trust_remote_code=True)
        return len(tok.encode(text))
    except Exception:
        try:
            from tokenizers import Tokenizer
            tok = Tokenizer.from_pretrained("Qwen/Qwen3-8B")
            return len(tok.encode(text).ids)
        except Exception:
            return None


# ── Test payloads ─────────────────────────────────────────────────────────────
PAYLOAD_SIZES = [1_000, 5_000, 10_000, 50_000, 100_000, 150_000, 200_000, 250_000]


def make_text(n_chars: int) -> str:
    """Generate ~n_chars of realistic code-like text."""
    line = "def calculate_fibonacci(n: int) -> list[int]:\n"
    line += '    """Return the first n Fibonacci numbers."""\n'
    line += "    if n <= 0:\n        return []\n"
    line += "    fib = [0, 1]\n"
    line += "    for i in range(2, n):\n        fib.append(fib[-1] + fib[-2])\n"
    line += "    return fib[:n]\n\n"
    repeats = n_chars // len(line) + 1
    return (line * repeats)[:n_chars]


def send(text: str) -> dict:
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": text}],
        "max_tokens": 16,
        "temperature": 0,
        "stream": False,
    }).encode()
    req = Request(API_URL, data=body, headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    })
    try:
        with urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        return {"error": True, "status": e.code, "body": e.read().decode()}


# ── Run ───────────────────────────────────────────────────────────────────────
print(f"Model: {MODEL} (likely Qwen3-based)")
print(f"{'Chars':>8} | {'chars/4':>8} | {'tiktoken':>10} | {'Qwen3':>10} | {'Provider':>10} | {'R c4':>6} | {'R tk':>6} | {'R q3':>6} | Status")
print("-" * 100)

observed_limit = None
best_match: dict = {"name": "none", "ratio": 999.0}

for size in PAYLOAD_SIZES:
    text = make_text(size)
    c4 = estimate_chars4(text)
    tk = estimate_tiktoken(text)
    q3 = estimate_qwen3(text)

    result = send(text)

    if "error" in result:
        body = result.get("body", "")
        m = re.search(
            r"(?:maximum context length|context length is only|exceeds the limit of)"
            r"\s*(?:is\s*)?(\d[\d,]*)",
            body, re.I,
        )
        if m:
            observed_limit = int(m.group(1).replace(",", ""))
        print(
            f"{size:>8} | {c4:>8} | {tk or 'N/A':>10} | {q3 or 'N/A':>10} | "
            f"{'ERR':>10} | {'---':>6} | {'---':>6} | {'---':>6} | "
            f"HTTP {result.get('status', '')}"
        )
    else:
        usage = result.get("usage", {})
        p_input = usage.get("prompt_tokens", 0)
        p_total = usage.get("total_tokens", 0)
        r_c4 = p_input / c4 if c4 else 0
        r_tk = (p_input / tk) if tk else 0
        r_q3 = (p_input / q3) if q3 else 0

        # Track best match (ratio closest to 1.0)
        for name, ratio in [("chars/4", r_c4), ("tiktoken", r_tk), ("Qwen3", r_q3)]:
            if ratio > 0 and abs(ratio - 1) < abs(best_match["ratio"] - 1):
                best_match = {"name": name, "ratio": ratio}

        print(
            f"{size:>8} | {c4:>8} | {tk or 'N/A':>10} | {q3 or 'N/A':>10} | "
            f"{p_input:>10} | {r_c4:>6.3f} | {r_tk:>6.3f} | {r_q3:>6.3f} | OK"
        )

    time.sleep(1)

print(f"\n{'=' * 100}")
if observed_limit:
    print(f"Observed provider context limit: {observed_limit}")
    print(f"Configured limit: 256000")
print(f"Best tokenizer match: {best_match['name']} (ratio={best_match['ratio']:.3f})")
print(f"Recommendation: register kat-coder-pro-v2 to use the {best_match['name']} tokenizer")
