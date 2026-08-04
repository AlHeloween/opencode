# Plan: Kernel truncation guards — word-boundary + stale fallback fix

## Summary

Add word-boundary-aware truncation to 5 unguarded `[:N]` slices in the kernel SVG anchor layer,
fix a stale `kernel_max_bytes` fallback, and add smoke coverage for the bug class
discovered in `request-diff.ts` (mid-word splits → corrupted canonical hashes / keywords).

## Prior art

- `packages/opencode/src/session/request-diff.ts` — `isWordChar()` + `truncateText()` already fixed
  with Unicode `\p{L}\p{N}_` boundary detection, 200-char backscan, `cut = i + 1`.

## Files to modify (4)

### 1. `prompts_kernel/05_svm_anchor.py` (line 125)

**Before:** `dominant=signal.content[:100]`
**After:** `dominant=safe_truncate(signal.content, 100)`

### 2. `prompts_kernel/13_bug_fix.py` (lines 86, 106, 110, 112)

| Line | Before | After |
|------|--------|-------|
| 86 | `dominant=bug_description[:100]` | `dominant=safe_truncate(bug_description, 100)` |
| 106 | `dominant=approach[:100]` | `dominant=safe_truncate(approach, 100)` |
| 110 | `keywords=[approach[:20]]` | `keywords=[safe_truncate(approach, 20)]` |
| 112 | `dominant=approach[:100]` | `dominant=safe_truncate(approach, 100)` |

### 3. `prompts_kernel/28_runtime_render.py` (line 29)

**Before:** `max_bytes = int(PROMPT_ABI.get("kernel_max_bytes", 48_000))`
**After:** Import `kernel_max_bytes` from `27_runtime_dict` and use it as fallback:
```python
from prompts_kernel._27_runtime_dict import kernel_max_bytes as _KERNEL_MAX_BYTES
max_bytes = int(PROMPT_ABI.get("kernel_max_bytes", _KERNEL_MAX_BYTES))
```

### 4. `prompts_kernel/tests/test_svm_anchor.py` (new smoke test)

Add a test that:
- Creates long strings (Cyrillic, ASCII, mixed) that exceed truncation limits
- Calls `safe_truncate` on each
- Asserts last character before truncation is NOT a word character (`\p{L}\p{N}_`)
- Asserts no mid-word split for known problematic cases (`"завершённых"`, `"OUTPUT_TOKEN_MAX"`)

## New helper: `safe_truncate` (add to `05_svm_anchor.py` or shared util)

```python
import re

_WORD_CHAR = re.compile(r"[\w]", re.UNICODE)  # letter, digit, underscore (Unicode-aware)

def safe_truncate(text: str, max_len: int) -> str:
    """Truncate to max_len, stepping back to last non-word-char boundary."""
    if len(text) <= max_len:
        return text
    cut = max_len
    for i in range(max_len - 1, max(0, max_len - 200), -1):
        if not _WORD_CHAR.match(text[i]):
            cut = i + 1  # include boundary char
            break
    return text[:cut]
```

## Smoke test (baseline BEFORE, oracle AFTER)

| # | Command (cwd=repo root) | Expected |
|---|------------------------|----------|
| 1 | `python prompts_kernel/tests/test_svm_anchor.py` | All truncation tests pass (no mid-word splits) |
| 2 | `python opencode_prompts_kernel.py` | Conformance suite passes |
| 3 | `python prompts_kernel/_assemble_prompts_kernel.py` | Regenerates precompiled without errors |

## What stays

- All existing truncation limits (100, 20) — we fix *how* they truncate, not *that* they truncate.
- `_kernel_precompiled.py` — regenerated from fragments, not hand-edited.
- Hash/ID slices (`[:12]`, `[:16]`) — these are fixed-width fingerprints, not prose.
- `TITLE.max_length: 50` — declarative model instruction, not a code slice.
