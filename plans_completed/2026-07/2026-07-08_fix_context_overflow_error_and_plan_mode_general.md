# Fix: Context Overflow Error + Rotating Checkpoints + Checkpoint-Based Compaction + Token Calibration + Block General in Plan Mode

**Created:** 2026-07-08
**Status:** Planning (Fix 1 already applied)

## Changes Summary

| # | Fix | File | Status |
|---|-----|------|--------|
| 1 | Summarizer uses `selected.head` not `msgs` | `prompt.ts:1320` | DONE |
| 2 | Rotating checkpoints (2 slots) | `checkpoint.ts` | DONE |
| 3 | Checkpoint-based compaction fallback | `checkpoint.ts` + `compaction.ts` + `prompt.ts` | DONE |
| 4 | Token calibration from provider errors | `error.ts` + new `token-calibration.ts` + `overflow.ts` + `processor.ts` | DONE |
| 5 | Silent overflow (no error toast) | `processor.ts` + `app.tsx` + `agi-mode.tsx` | DONE |
| 6 | CompactionStuck toast | `app.tsx` | DONE |
| 7 | Block general in plan mode | `agent.ts` + `plan.txt` | DONE |

---

## Fix 1: Summarizer uses head-only (ALREADY APPLIED)

**File: `packages/opencode/src/session/prompt.ts` (line 1320)**

```ts
const modelMsgs = yield* MessageV2.toModelMessagesEffect(
  selected.head.length > 0 ? selected.head : msgs,
  model,
)
```

---

## Fix 2: Rotating Checkpoints (2 slots)

**File: `packages/opencode/src/session/checkpoint.ts`**

### Filename format

```
{provider}_{model}_{agent}_{sessionID}_S0.enc
{provider}_{model}_{agent}_{sessionID}_S1.enc
```

### Implementation

**Add constant + helper (after line 29):**
```ts
const CHECKPOINT_SLOTS = 2

function checkpointSlotPaths(
  sessionID: string, providerID: string, modelID: string, agentName?: string,
): string[] {
  const base = checkpointPath(sessionID, providerID, modelID, agentName)
  return Array.from({ length: CHECKPOINT_SLOTS }, (_, i) =>
    base.replace(/\.enc$/, `_S${i}.enc`),
  )
}
```

**Modify `save()`:** Write to the slot with the OLDER mtime (preserving newer as backup).

**Modify `load()`:** Try both slots sorted by newest mtime. If one corrupt, try the other.

**Add `loadPrevious()`:** Loads the OLDER slot (ascending mtime sort, returns first valid).

**Modify `remove()`:** Match `_${safeSid}_S` OR `_${safeSid}.enc`.

**Modify `findLatest()`:** Strip `_S\d+` suffix from session ID extraction.

---

## Fix 3: Checkpoint-Based Compaction

When overflow triggers, use the previous checkpoint as the compaction boundary.

### Algorithm

```
Previous checkpoint (older slot): [msg1..msg5], messageIDs: [id1..id5]
Current messages:                 [msg1..msg8]

1. Load previous checkpoint → smaller, guaranteed to fit summarizer
2. Summarize checkpoint.messages → summary
3. Delta = current messages where id NOT IN checkpoint.messageIDs = [msg6, msg7, msg8]
4. tail_count = delta.length
5. filterCompactedEffect returns: [summary] + [msg6, msg7, msg8]
```

### Changes

**`compaction.ts` — `create()`:** Add optional `previousCheckpointIDs?: string[]` to input.

**`prompt.ts` — compaction trigger (line 1384, 1453):** Load previous checkpoint, pass `messageIDs` to `create()`.

**`prompt.ts` — compaction handler (line 1255):** When `previousCheckpointIDs` provided, split messages at checkpoint boundary instead of `selectMessages()`.

**`prompt.ts` — summarizer input (line 1320):** When previous checkpoint available, use its messages directly (already in `ModelMessage[]` format).

---

## Fix 4: Token Calibration from Provider Errors

When a provider returns a context overflow error, the error message often contains ground-truth token counts. Parse these and use them to calibrate our internal token estimator.

### What provider errors tell us

| Provider | Error pattern | Extractable info |
|----------|--------------|-----------------|
| OpenRouter/DeepSeek/vLLM | "maximum context length is 128000 tokens" | context limit |
| xAI Grok | "maximum prompt length is 100000" | context limit |
| GitHub Copilot | "exceeds the limit of 128000" | context limit |
| vLLM | "context length is only 32768 tokens" | context limit |
| Mistral | "too large for model with 32768 maximum context length" | context limit |
| Google Gemini | "input token count exceeds the maximum" | (may include count) |
| OpenAI | "exceeds the context window" | (may include count in details) |

### Implementation

**File: `packages/opencode/src/provider/error.ts` — add `extractTokenLimits()`:**

```ts
export function extractTokenLimits(message: string): {
  contextLimit?: number
  inputTokens?: number
} {
  const limitPatterns = [
    /maximum context length is (\d[\d,]*)/i,
    /context length is only (\d[\d,]*)/i,
    /exceeds the limit of (\d[\d,]*)/i,
    /maximum prompt length is (\d[\d,]*)/i,
    /too large for model with (\d[\d,]*) maximum/i,
  ]
  let contextLimit: number | undefined
  for (const p of limitPatterns) {
    const m = message.match(p)
    if (m) { contextLimit = parseInt(m[1]!.replace(/,/g, ""), 10); break }
  }

  const inputPatterns = [
    /input token count[^\d]*(\d[\d,]*)/i,
    /(\d[\d,]*) tokens.*exceeds/i,
    /prompt.*?(\d[\d,]*)\s*tokens/i,
  ]
  let inputTokens: number | undefined
  for (const p of inputPatterns) {
    const m = message.match(p)
    if (m) { inputTokens = parseInt(m[1]!.replace(/,/g, ""), 10); break }
  }

  return { contextLimit, inputTokens }
}
```

**New file: `packages/opencode/src/session/token-calibration.ts`:**

```ts
import type { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "token-calibration" })

interface CalibrationEntry {
  /** Multiplicative correction: provider_count / our_estimate */
  factor: number
  /** Observed context limit from provider error (may differ from config) */
  observedLimit?: number
  /** When this calibration was last updated */
  updatedAt: number
}

const corrections = new Map<string, CalibrationEntry>()

function key(model: Provider.Model): string {
  return `${model.providerID}:${model.id}`
}

/** Update calibration from a provider overflow error. */
export function update(
  model: Provider.Model,
  info: { contextLimit?: number; inputTokens?: number },
  ourEstimate?: number,
): void {
  const k = key(model)
  const existing = corrections.get(k) ?? { factor: 1, updatedAt: 0 }

  if (info.contextLimit) {
    existing.observedLimit = info.contextLimit
    log.info("observed context limit from provider", {
      model: model.id, providerLimit: info.contextLimit,
      configLimit: model.limit.context,
    })
  }

  if (info.inputTokens && ourEstimate && ourEstimate > 0) {
    const newFactor = info.inputTokens / ourEstimate
    // Smooth: blend old factor (70%) with new observation (30%)
    existing.factor = existing.factor === 1
      ? newFactor  // First observation — use directly
      : existing.factor * 0.7 + newFactor * 0.3
    log.info("token calibration updated", {
      model: model.id, factor: existing.factor.toFixed(3),
      providerCount: info.inputTokens, ourEstimate,
    })
  }

  existing.updatedAt = Date.now()
  corrections.set(k, existing)
}

/** Get the correction factor for a model (default 1.0). */
export function getFactor(model: Provider.Model): number {
  return corrections.get(key(model))?.factor ?? 1
}

/** Get the observed context limit from a previous provider error. */
export function getObservedLimit(model: Provider.Model): number | undefined {
  return corrections.get(key(model))?.observedLimit
}

export * as TokenCalibration from "./token-calibration"
```

**File: `packages/opencode/src/session/overflow.ts` — `estimateContentTokens()`:**

Apply correction factor to the raw estimate:

```ts
import { TokenCalibration } from "./token-calibration"

function estimateContentTokens(msgs: MessageV2.WithParts[], model: Provider.Model): number {
  // ... existing fragment collection ...
  const raw = tok ? tok.countTokens(fragments.join("\n")) : Math.ceil(chars / 4)
  // Apply provider-calibrated correction factor
  return Math.ceil(raw * TokenCalibration.getFactor(model))
}
```

**File: `packages/opencode/src/session/processor.ts` — `halt()` (line 836-839):**

Extract token info from the error and update calibration:

```ts
if (MessageV2.ContextOverflowError.isInstance(error)) {
  ctx.needsCompaction = true
  // Calibrate token estimator from provider's ground-truth error message
  const tokenInfo = ProviderError.extractTokenLimits(error.data.message)
  if (tokenInfo.contextLimit || tokenInfo.inputTokens) {
    TokenCalibration.update(ctx.model, tokenInfo, ctx.assistantMessage.tokens?.input)
  }
  return
}
```

---

## Fix 5: Silent Context Overflow

**File: `packages/opencode/src/session/processor.ts` (line 836-839)**

Remove `Session.Event.Error` publish for `ContextOverflowError`.

**File: `packages/opencode/src/cli/cmd/tui/app.tsx` (line 842-853)**

Filter `ContextOverflowError` in error handler.

**File: `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx` (line 652-659)**

Filter `ContextOverflowError` in AGI error handler.

---

## Fix 6: CompactionStuck Toast

**File: `packages/opencode/src/cli/cmd/tui/app.tsx` (after line 862)**

```ts
event.on("session.compaction.stuck", (evt) => {
  toast.show({
    variant: "warning",
    message: "Compaction struggling — try sending a shorter message or start a new session.",
    duration: 8000,
  })
})
```

---

## Fix 7: Block General Agent in Plan Mode

**File: `packages/opencode/src/agent/agent.ts` (line 128-146)**

Add `subagents: ["explore"]` to plan agent.

**File: `packages/opencode/src/session/prompt/plan.txt` (line 39)**

Change: `Launch general agent(s) to design the implementation...`
To: `Design the implementation yourself based on exploration results from Phase 1. Use explore agents for additional codebase research.`

---

## Verification

1. **Type check:** `bun typecheck` from `packages/opencode` — PASSES
2. **New tests:** `bun test test/provider/extract-token-limits.test.ts test/session/token-calibration.test.ts` — 18/18 PASS
3. **Existing tests:** `bun test test/provider/transform.test.ts test/provider/balance.test.ts test/provider/model-resolver.test.ts` — 174/174 PASS
4. **Agent tests:** 2 pre-existing failures (Truncate permission + agent disabling), unrelated to our changes

---

## Bonus: Token Calibration Test Script

**File: `experiments/20260708_token_calibration_test/kat_coder_token_test.py`**

Standalone Python test that compares our tokenizer estimate with kat-coder-pro-v2's actual token counts. Reads auth from `bin/auth.json`.

```python
"""
Token calibration test for kat-coder-pro-v2 (StreamLake, likely Qwen3-based).
Compares chars/4, tiktoken, and Qwen3 tokenizers with the provider's actual
prompt_tokens. When we hit the context limit, parses the error for the limit.

Compares all available tokenizers to find the best match for this model family.

Reads API key from ../../bin/auth.json (streamlake-openai-1.key).
Requires: pip install tiktoken tokenizers
"""
import json, os, re, sys, time
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
    kat-coder-pro-v2 is likely Qwen3-based — this should be the closest match."""
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
best_match = {"name": "none", "ratio": 999}

for size in PAYLOAD_SIZES:
    text = make_text(size)
    c4 = estimate_chars4(text)
    tk = estimate_tiktoken(text)
    q3 = estimate_qwen3(text)

    result = send(text)

    if "error" in result:
        body = result.get("body", "")
        m = re.search(r"(?:maximum context length|context length is only|exceeds the limit of)\s*(?:is\s*)?(\d[\d,]*)", body, re.I)
        if m:
            observed_limit = int(m.group(1).replace(",", ""))
        print(f"{size:>8} | {c4:>8} | {tk or 'N/A':>10} | {q3 or 'N/A':>10} | {'ERR':>10} | {'---':>6} | {'---':>6} | {'---':>6} | HTTP {result.get('status','')}")
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

        print(f"{size:>8} | {c4:>8} | {tk or 'N/A':>10} | {q3 or 'N/A':>10} | {p_input:>10} | {r_c4:>6.3f} | {r_tk:>6.3f} | {r_q3:>6.3f} | OK")

    time.sleep(1)

print(f"\n{'='*100}")
if observed_limit:
    print(f"Observed provider context limit: {observed_limit}")
    print(f"Configured limit: 256000")
print(f"Best tokenizer match: {best_match['name']} (ratio={best_match['ratio']:.3f})")
print(f"Recommendation: register kat-coder-pro-v2 to use the {best_match['name']} tokenizer")
```

This test:
- Sends increasing payload sizes to kat-coder-pro-v2
- Compares `chars/4` and `tiktoken` estimates with the provider's `prompt_tokens`
- When overflow occurs, parses the error for the actual context limit
- Outputs a ratio table — ratio > 1 means our estimate undercounts
