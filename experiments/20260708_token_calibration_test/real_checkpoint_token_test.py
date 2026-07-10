"""
Test token counts against kat-coder-pro-v2 using the ACTUAL system prompt
extracted from a real opencode checkpoint (36 turns, 332 messages, mimo-v2.5-pro).
"""
import json
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# ── Auth ──
AUTH_PATH = Path(__file__).resolve().parents[2] / "bin" / "auth.json"
with open(AUTH_PATH) as f:
    auth = json.load(f)

API_KEY = auth.get("streamlake-openai-1", {}).get("key", "")
if not API_KEY:
    sys.exit("No streamlake-openai-1 key in bin/auth.json")

API_URL = "https://vanchin.streamlake.ai/api/gateway/coding/v1/chat/completions"
MODEL = "ep-23exxd-1776195159781896082"

# ── Load checkpoint sample ──
SAMPLE = Path(__file__).parent / "checkpoint_sample.json"
with open(SAMPLE) as f:
    ckpt = json.load(f)

sys_prompt = ckpt["systemPrompt"]
messages = ckpt["messages"]

print(f"Checkpoint: {len(messages)} messages, {len(sys_prompt)} chars system prompt")

# ── Tokenizers ──
def estimate_chars4(text): return len(text) // 4

def estimate_tiktoken(text):
    try:
        import tiktoken
        return len(tiktoken.get_encoding("o200k_base").encode(text))
    except: return None

def estimate_qwen3(text):
    try:
        from transformers import AutoTokenizer
        return len(AutoTokenizer.from_pretrained("Qwen/Qwen3-8B", trust_remote_code=True).encode(text))
    except:
        try:
            from tokenizers import Tokenizer
            return len(Tokenizer.from_pretrained("Qwen/Qwen3-8B").encode(text).ids)
        except: return None


def send(system, msgs):
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "system", "content": system}] + msgs,
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


# ── Tests ──

# Test 1: System prompt only
print(f"\n{'=' * 80}")
print("TEST 1: System prompt only")
print("=" * 80)
c4 = estimate_chars4(sys_prompt)
tk = estimate_tiktoken(sys_prompt)
q3 = estimate_qwen3(sys_prompt)

result = send(sys_prompt, [{"role": "user", "content": "hi"}])
if "error" in result:
    print(f"  Error: {result.get('body', '')[:100]}")
else:
    p = result["usage"]["prompt_tokens"]
    print(f"  chars/4:  {c4:>8}  (ratio: {p/c4:.4f})")
    print(f"  tiktoken: {tk or 'N/A':>8}  (ratio: {p/tk:.4f})" if tk else "  tiktoken: N/A")
    print(f"  Qwen3:    {q3 or 'N/A':>8}  (ratio: {p/q3:.4f})" if q3 else "  Qwen3: N/A")
    print(f"  Provider: {p:>8}")

time.sleep(1)

# Test 2: System prompt + N messages from the checkpoint
print(f"\n{'=' * 80}")
print("TEST 2: System prompt + N checkpoint messages")
print("=" * 80)

MSG_COUNTS = [5, 10, 20, 50, 100, 200, 332]
# Convert checkpoint messages to API format
api_msgs = [{"role": m["role"], "content": m["content"]} for m in messages]

print(f"{'N msgs':>8} | {'chars/4':>8} | {'tiktoken':>10} | {'Qwen3':>10} | {'Provider':>10} | {'R c4':>7} | {'R tk':>7} | {'R q3':>7}")
print("-" * 85)

for n in MSG_COUNTS:
    subset = api_msgs[:n]
    # Total text = system prompt + all message content
    total_text = sys_prompt + "".join(m["content"] for m in subset)
    c4 = estimate_chars4(total_text)
    tk = estimate_tiktoken(total_text)
    q3 = estimate_qwen3(total_text)

    result = send(sys_prompt, subset)
    if "error" in result:
        body = result.get("body", "")
        print(f"{n:>8} | {'ERR':>8} | {body[:60]}")
    else:
        p = result["usage"]["prompt_tokens"]
        r_c4 = p / c4 if c4 else 0
        r_tk = p / tk if tk else 0
        r_q3 = p / q3 if q3 else 0
        print(f"{n:>8} | {c4:>8} | {tk or 'N/A':>10} | {q3 or 'N/A':>10} | {p:>10} | {r_c4:>7.4f} | {r_tk:>7.4f} | {r_q3:>7.4f}")

    time.sleep(1)

print(f"\n{'=' * 80}")
print("Summary: ratio > 1 = our estimate undercounts (provider sees more tokens)")
print("Ratio closest to 1.0 = best tokenizer for this model")
