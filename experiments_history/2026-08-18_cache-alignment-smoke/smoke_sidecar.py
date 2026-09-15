"""Smoke (live): replay the EXACT sidecar-summary geometry vs the main chain on the
KAT gateway to check whether the ~64K summary breaks the main cache.

opencode mechanics (prompt.ts maybeCaptureSidecar, grounded):
- main chain:   system S + full conversation M          (key = session:model)
- sidecar (~64K): system S + OPEN RANGE ONLY + summary prompt — a SEPARATE
  llm.stream call; the visible chain in DB is untouched.
- providerCacheKey is OPTIONAL; when unset, llm.ts falls back to
  sessionID:modelID for BOTH main and sidecar → SAME cache bucket, different
  prefix. gap-fill additionally sends system:[] + 2 tiny messages on the same key.

Hypothesis: on this gateway (single cache unit per key), the sidecar's range
prefix clobbers the main prefix → next main request misses.

Phase 1: sidecar on the SAME key (current default behaviour).
Phase 2: sidecar on key `:sidecar` (P7 fix) + gap-fill on `:gapfill`.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from openai import OpenAI

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / "bin"
MODEL = "ep-kneqk9-1786632248553436783"
BASE_URL = "https://vanchin.streamlake.ai/api/gateway/coding/v1"
PAD_UNITS = 2_000  # ~8K tokens system prefix
SYSTEM = "You are a coding assistant.\n# PAD\n" + "cache-block-128 " * PAD_UNITS

MAIN_MSGS = [
    ("user", "First question: what is 1+1? Reply with exactly: two"),
    ("assistant", "two"),
    ("user", "Second question: what is 2+2? Reply with exactly: four"),
    ("assistant", "four"),
    ("user", "Third question: what is 3+3? Reply with exactly: six"),
    ("assistant", "six"),
]
SUMMARY_PROSE = "Summarize the conversation above into a compact memory block."
GAPFILL_PROSE = "Fill the missing Goal / Key decisions / Current state sections."


def load_key() -> str:
    key = (json.loads((BIN / "auth.json").read_text(encoding="utf-8")).get("pasha-coder") or {}).get("key") or ""
    if not key:
        raise SystemExit("no key in bin/auth.json")
    return key


def ask(client: OpenAI, cache_key: str, system: str, messages: list[tuple], label: str) -> dict:
    t0 = time.perf_counter()
    stream = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": system}, *[{"role": r, "content": c} for r, c in messages]],
        max_tokens=64,
        stream=True,
        stream_options={"include_usage": True},
        extra_body={"prompt_cache_key": cache_key},
    )
    stats: dict = {}
    for chunk in stream:
        u = getattr(chunk, "usage", None)
        if u is not None:
            d = getattr(u, "prompt_tokens_details", None)
            stats = {
                "prompt": getattr(u, "prompt_tokens", None),
                "cached": getattr(d, "cached_tokens", None) if d else None,
            }
    ms = int((time.perf_counter() - t0) * 1000)
    c, p = stats.get("cached"), stats.get("prompt")
    ratio = f"{c / p:.3f}" if isinstance(c, int) and p else "—"
    print(f"{label:>22} {str(p):>6} {str(c):>6} {ratio:>7} {ms:>5}ms")
    stats["ms"] = ms
    return stats


def main() -> None:
    client = OpenAI(base_url=BASE_URL, api_key=load_key())
    print("warming main chain on key K...")
    ask(client, "smoke-sidecar:main", SYSTEM, MAIN_MSGS, "main-1 (cold)")
    ask(client, "smoke-sidecar:main", SYSTEM, MAIN_MSGS + [("user", "Appended turn. Reply with exactly: ok"), ("assistant", "ok")], "main-2 (append, expect hit)")

    print("\nPHASE 1 — sidecar on SAME key (current default when providerCacheKey unset)")
    ask(client, "smoke-sidecar:main", SYSTEM, MAIN_MSGS[-4:] + [("user", SUMMARY_PROSE)], "sidecar (same key K)")
    m3 = ask(client, "smoke-sidecar:main", SYSTEM, MAIN_MSGS + [("user", "Next real turn. Reply with exactly: done"), ("assistant", "done")], "main-3 after sidecar")
    print(f"  main-3 cached: {m3.get('cached')} → {'MISS (cache clobbered)' if not m3.get('cached') else 'HIT (cache survived)'}")

    print("\nPHASE 2 — sidecar on :sidecar key, gap-fill on :gapfill (P7 fix)")
    ask(client, "smoke-sidecar:main", SYSTEM, MAIN_MSGS + [("user", "Appended again. Reply with exactly: ok"), ("assistant", "ok")], "main-4 (rewarm)")
    ask(client, "smoke-sidecar:sidecar", SYSTEM, MAIN_MSGS[-4:] + [("user", SUMMARY_PROSE)], "sidecar (key :sidecar)")
    ask(client, "smoke-sidecar:gapfill", "", [("assistant", "summary body"), ("user", GAPFILL_PROSE)], "gap-fill (key :gapfill)")
    m5 = ask(client, "smoke-sidecar:main", SYSTEM, MAIN_MSGS + [("user", "Final real turn. Reply with exactly: done"), ("assistant", "done")], "main-5 after split keys")
    print(f"  main-5 cached: {m5.get('cached')} → {'MISS (still broken)' if not m5.get('cached') else 'HIT (P7 fix works)'}")


if __name__ == "__main__":
    main()
