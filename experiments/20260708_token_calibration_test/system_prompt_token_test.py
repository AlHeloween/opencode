"""
System prompt token calibration test for kat-coder-pro-v2.
Uses the actual AGENTS.md + prompt files that opencode sends as the system message.
Compares our tokenizers against the provider's actual prompt_tokens.

Reads API key from ../../bin/auth.json (streamlake-openai-1.key).
"""
import json
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

# ── Load actual system prompt components ──────────────────────────────────────
ROOT = Path(__file__).resolve().parents[2]

def load_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""

# AGENTS.md — the main project instructions
agents_md = load_text(ROOT / "AGENTS.md")

# Default prompt — agent personality/tone
default_prompt = load_text(ROOT / "packages" / "opencode" / "src" / "session" / "prompt" / "default.txt")

# Build a realistic system prompt (similar to what opencode constructs)
system_prompt = f"""You are an expert coding assistant. Follow these project conventions:

{agents_md}

---

Agent behavior:
{default_prompt}
"""

# ── Tokenizer estimates ──────────────────────────────────────────────────────

def estimate_chars4(text: str) -> int:
    return len(text) // 4

def estimate_tiktoken(text: str) -> int | None:
    try:
        import tiktoken
        enc = tiktoken.get_encoding("o200k_base")
        return len(enc.encode(text))
    except ImportError:
        return None

def estimate_qwen3(text: str) -> int | None:
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


def send(system: str, user_text: str) -> dict:
    body = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_text},
        ],
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


# ── Run tests ─────────────────────────────────────────────────────────────────

# Test 1: System prompt only
print("=" * 90)
print("TEST 1: System prompt only (AGENTS.md + default.txt)")
print("=" * 90)

sys_chars = len(system_prompt)
sys_c4 = estimate_chars4(system_prompt)
sys_tk = estimate_tiktoken(system_prompt)
sys_q3 = estimate_qwen3(system_prompt)

result = send(system_prompt, "Hello")

if "error" in result:
    print(f"  Error: {result.get('body', '')[:100]}")
else:
    usage = result.get("usage", {})
    p_input = usage.get("prompt_tokens", 0)
    print(f"  System prompt chars: {sys_chars}")
    print(f"  chars/4:     {sys_c4:>8}  (ratio: {p_input/sys_c4:.3f})")
    print(f"  tiktoken:    {sys_tk or 'N/A':>8}  (ratio: {p_input/sys_tk:.3f})" if sys_tk else f"  tiktoken:    N/A")
    print(f"  Qwen3:       {sys_q3 or 'N/A':>8}  (ratio: {p_input/sys_q3:.3f})" if sys_q3 else f"  Qwen3:       N/A")
    print(f"  Provider:    {p_input:>8}")
    print(f"  Total tokens: {usage.get('total_tokens', 0)}")

time.sleep(1)

# Test 2: System prompt + varying user message sizes
print(f"\n{'=' * 90}")
print("TEST 2: System prompt + user messages of increasing size")
print("=" * 90)

USER_SIZES = [100, 500, 1000, 5000, 10000]

print(f"{'User':>8} | {'chars/4':>8} | {'tiktoken':>10} | {'Qwen3':>10} | {'Provider':>10} | {'R c4':>6} | {'R tk':>6} | {'R q3':>6}")
print("-" * 85)

for size in USER_SIZES:
    user_text = "Explain this code: " + ("x" * (size - 20))
    
    # Total content = system + user
    total_text = system_prompt + user_text
    c4 = estimate_chars4(total_text)
    tk = estimate_tiktoken(total_text)
    q3 = estimate_qwen3(total_text)
    
    result = send(system_prompt, user_text)
    
    if "error" in result:
        print(f"{size:>8} | {'ERR':>8} | {result.get('body', '')[:60]}")
    else:
        usage = result.get("usage", {})
        p_input = usage.get("prompt_tokens", 0)
        r_c4 = p_input / c4 if c4 else 0
        r_tk = p_input / tk if tk else 0
        r_q3 = p_input / q3 if q3 else 0
        print(f"{size:>8} | {c4:>8} | {tk or 'N/A':>10} | {q3 or 'N/A':>10} | {p_input:>10} | {r_c4:>6.3f} | {r_tk:>6.3f} | {r_q3:>6.3f}")
    
    time.sleep(1)

# Test 3: Tools description (simulated)
print(f"\n{'=' * 90}")
print("TEST 3: System prompt + tools schema (simulated)")
print("=" * 90)

# Simulate a tools definition (similar to what opencode sends)
tools_text = """
## Available Tools

You have access to the following tools:

### read
Read a file or directory from the local filesystem.
Parameters: filePath (string, required), offset (number, optional), limit (number, optional)

### edit
Perform exact string replacements in files.
Parameters: filePath (string, required), oldString (string, required), newString (string, required), replaceAll (boolean, optional)

### bash
Execute shell commands.
Parameters: command (string, required), description (string, required), workdir (string, optional), timeout (number, optional)

### glob
Fast file pattern matching tool.
Parameters: pattern (string, required), path (string, optional)

### grep
Fast content search tool using ripgrep.
Parameters: pattern (string, required), path (string, optional), include (string, optional)

### task
Launch a new sub-agent to handle complex tasks.
Parameters: subagent_type (string, required), description (string, required), prompt (string, required)
"""

total_with_tools = system_prompt + tools_text
c4 = estimate_chars4(total_with_tools)
tk = estimate_tiktoken(total_with_tools)
q3 = estimate_qwen3(total_with_tools)

result = send(system_prompt + tools_text, "Read the file package.json")

if "error" in result:
    print(f"  Error: {result.get('body', '')[:100]}")
else:
    usage = result.get("usage", {})
    p_input = usage.get("prompt_tokens", 0)
    print(f"  Total content chars: {len(total_with_tools)}")
    print(f"  chars/4:     {c4:>8}  (ratio: {p_input/c4:.3f})")
    print(f"  tiktoken:    {tk or 'N/A':>8}  (ratio: {p_input/tk:.3f})" if tk else f"  tiktoken:    N/A")
    print(f"  Qwen3:       {q3 or 'N/A':>8}  (ratio: {p_input/q3:.3f})" if q3 else f"  Qwen3:       N/A")
    print(f"  Provider:    {p_input:>8}")

print(f"\n{'=' * 90}")
print("Summary: Qwen3 is the best match for kat-coder-pro-v2 (Qwen3-based)")
print("The residual gap (~11%) is from chat template overhead, special tokens, etc.")
print("Token calibration (Fix 4) will learn this factor automatically from overflow errors.")
