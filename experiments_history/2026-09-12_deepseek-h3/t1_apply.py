"""Atomic T1 application for provider/transform.ts.

Replaces the four live `deepseek-v4` substring sites with the shared predicate.
Every replacement asserts EXACTLY ONE occurrence; if any assertion fails the file
is left untouched. This exists because repeated stale-anchor edits were inserting
duplicates instead of replacing text.

Run: python experiments/2026-09-12_deepseek-h3/t1_apply.py
"""

from __future__ import annotations

import pathlib
import sys

TARGET = pathlib.Path("packages/opencode/src/provider/transform.ts")

REPLACEMENTS: list[tuple[str, str, str]] = [
    (
        "deepseek-sdk-case",
        """    case "@ai-sdk/deepseek":
      if (!model.api.id.includes("deepseek-v4")) return {}
      return {
        off: { thinking: { type: "disabled" } },
        low: { thinking: { type: "enabled" }, reasoningEffort: "low" },
        high: { thinking: { type: "enabled" }, reasoningEffort: "high" },
        max: { thinking: { type: "enabled" }, reasoningEffort: "max" },
      }""",
        """    case "@ai-sdk/deepseek":
      if (!isDeepSeekThinkingId(model.api.id)) return {}
      return deepSeekThinkingVariants(model, (effort) => ({ thinking: { type: "enabled" }, reasoningEffort: effort }))""",
    ),
    (
        "openai-compatible",
        """    case "@ai-sdk/openai-compatible":
      const efforts = [...WIDELY_SUPPORTED_EFFORTS]
      if (model.api.id.includes("deepseek-v4")) {
        return {
          high: { reasoningEffort: "high" },
          max: { reasoningEffort: "max" },
        }
      }
      return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))""",
        """    case "@ai-sdk/openai-compatible":
      if (isDeepSeekThinkingId(model.api.id)) {
        return deepSeekThinkingVariants(model, (effort) => ({ reasoningEffort: effort }))
      }
      return Object.fromEntries(
        WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]),
      )""",
    ),
    (
        "anthropic",
        """      if (model.api.id.includes("deepseek-v4")) {
        return {
          high: { thinking: { type: "enabled" }, effort: "high" },
          max: { thinking: { type: "enabled" }, effort: "max" },
        }
      }""",
        """      if (isDeepSeekThinkingId(model.api.id)) {
        return deepSeekThinkingVariants(model, (effort) => ({
          thinking: { type: "enabled" },
          effort,
        }))
      }""",
    ),
    (
        "thinking-injection",
        """    input.model.api.id.includes("deepseek-v4") &&""",
        """    isDeepSeekThinkingId(input.model.api.id) &&""",
    ),
]


def main() -> int:
    text = TARGET.read_text(encoding="utf-8")

    if "function isDeepSeekThinkingId" not in text:
        print("FAIL: predicate helper is missing; helpers must be added first")
        return 1

    for name, old, new in REPLACEMENTS:
        count = text.count(old)
        if count != 1:
            print(f"FAIL: {name}: expected exactly 1 occurrence, found {count} — no write")
            return 1
        text = text.replace(old, new, 1)
        print(f"ok: {name} replaced")

    # The NVIDIA site keeps its own chat_template_kwargs semantics — assert it survived.
    if 'model.providerID === "nvidia" && input.model.api.id.includes("deepseek-v4")' not in text:
        print("FAIL: nvidia sitechanged unexpectedly — no write")
        return 1

    remaining = text.count('includes("deepseek-v4")')
    if remaining != 1:
        print(f"FAIL: expected exactly 1 residual deepseek-v4 literal (nvidia), found {remaining} — no write")
        return 1

    TARGET.write_text(text, encoding="utf-8", newline="\n")
    print(f"written: {TARGET} ({len(text.encode('utf-8'))} bytes, {text.count(chr(10)) + 1} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
