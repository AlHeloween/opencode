"""Smoke (live, KAT): gap-fill retry parity — does the SECOND summary attempt
(with gap list + previous draft in the user message) preserve the cache prefix?

User spec (soft gap-fill): attempt 1 = full M + summary prose. If the body is
invalid, attempt 2 = SAME request shape (full M, same system, same tools,
standard budget) with the user message extended by the gap list + previous
draft. Nothing is switched off — only the tail message changes.

Question under test: does the parity gap-fill retry hit the M prefix, while
the OLD gap-fill style (system: [], [assistant draft, user fill]) went cold?

Requests (one cache key G = shared, mirroring session:model default):
  A1  M + P1                     cold (warm-up)
  A2  M + P1                     retry-same baseline → expect FULL hit
  B1  M + P2 (P1+gaps+draft)     parity gap-fill → expect hit on M prefix,
                                 miss only the P2 tail (~user message)
  B2  M + P2                     repeat → full hit
  C1  old-style: system "", [assistant draft, user fill-prompt] → expect cold
                                 (different prefix = why the old style was bad)
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
P1 = "Summarize the conversation above into a compact memory block with sections: Semantic Vector, Goal, Key decisions, Current state."
DRAFT = (
    "## Semantic Vector\n"
    'dominant: "cache gapfill"\n\n'
    "## Goal\n"
    "Verify the retry keeps the cache prefix.\n\n"
    "## Key decisions\n"
    "- parity form only\n\n"
    "## Current state\n"
    "experiment running"
)
P2 = (
    P1
    + "\n\nYour previous draft was checked — these sections are deficient: "
    "- Goal (12/60 chars), - Key decisions (0 bullets, need >=1). "
    "Rewrite the FULL summary with all four sections fixed.\n\nPrevious draft:\n"
    + DRAFT
)
GAP_PROMPT = "Fill the missing Goal / Key decisions / Current state sections."


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
    print(f"{label:>30} {str(p):>7} {str(c):>7} {ratio:>7} {ms:>5}ms")
    stats["ms"] = ms
    return stats


def main() -> None:
    client = OpenAI(base_url=BASE_URL, api_key=load_key())
    key = "smoke-gapfill:main"

    print("== A. retry-same baseline ==")
    a1 = ask(client, key, SYSTEM, MAIN_MSGS + [("user", P1)], "A1 M+P1 (cold)")
    a2 = ask(client, key, SYSTEM, MAIN_MSGS + [("user", P1)], "A2 M+P1 (retry-same)")
    print(f"  A2 cached={a2.get('cached')}/{a2.get('prompt')} → {'FULL HIT' if a2.get('cached') and a2['prompt'] and a2['cached'] >= a2['prompt'] - 200 else 'partial/cold'}")

    print("\n== B. parity gap-fill retry (M + P2, same key, same system) ==")
    b1 = ask(client, key, SYSTEM, MAIN_MSGS + [("user", P2)], "B1 M+P2 (parity gapfill)")
    b2 = ask(client, key, SYSTEM, MAIN_MSGS + [("user", P2)], "B2 M+P2 (repeat)")
    m_hit = b1.get("cached") if isinstance(b1.get("cached"), int) else 0
    a_full = a2.get("prompt") if isinstance(a2.get("prompt"), int) else 0
    print(f"  B1 cached={m_hit}/{b1.get('prompt')} (A2 total={a_full}) → M prefix {'HIT' if m_hit >= a_full - 600 else 'NOT HIT'}")

    print("\n== C. old-style gap-fill (system '', [assistant, user]) ==")
    c1 = ask(client, key, "", [("assistant", DRAFT), ("user", GAP_PROMPT)], "C1 old-style gapfill")
    print(f"  C1 cached={c1.get('cached')} → {'cold (different prefix)' if not c1.get('cached') else 'unexpected hit'}")

    print("\nVERDICT:", "PASS — parity gap-fill keeps the M prefix; old style is cold" if m_hit >= a_full - 600 else "REVIEW — numbers above")


if __name__ == "__main__":
    main()
