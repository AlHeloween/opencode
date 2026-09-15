"""Build the T1 patch for transform.ts deterministically, with hard assertions.

Why a script: three attempts at piecemeal edits drifted (the file changed between
reads, `edit` anchors failed, duplicates appeared). This applies every hunk to an
in-memory copy of the HEAD baseline and refuses to write unless every anchor is
found EXACTLY once and every post-condition holds.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("transform.base.ts")
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("transform.patched.ts")

src = BASE.read_text(encoding="utf-8")

HELPERS = '''const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]

/** Retired DeepSeek aliases: not thinking-toggle models - excluded from every path below. */
const DEEPSEEK_RETIRED_ALIASES = ["deepseek-chat", "deepseek-reasoner", "deepseek-r1", "deepseek-v3"]
/** Effort values api.deepseek.com accepts (live-verified 2026-09-12). */
const DEEPSEEK_WIRE_EFFORTS = ["low", "high", "max"]

/**
 * DeepSeek V4.x thinking family - the single predicate for every DeepSeek site
 * (resolveNpm, variants, thinking injection).
 *
 * The 2026-09-10 release ships as plain `deepseek-flash` (DeepSeek-V4.1-Flash),
 * which contains neither `v4` nor `deepseek-v4`, so a version-substring test
 * silently dropped the *current* model onto the generic openai-compatible path:
 * wrong npm package, `low/medium/high` variants (no `off`, no `max`) and no
 * `thinking` injection. Measured live - experiments/2026-09-12_deepseek-h3/REPORT.md.
 */
export function isDeepSeekThinkingId(apiId: string): boolean {
  const id = apiId.toLowerCase()
  if (!id.includes("deepseek")) return false
  if (DEEPSEEK_RETIRED_ALIASES.some((alias) => id.includes(alias))) return false
  return id.includes("v4") || id.includes("deepseek-flash")
}

/**
 * Effort values for a DeepSeek model, taken from the registry's own
 * `reasoning_options` when present. The declared set is PER MODEL, not one
 * family constant: `deepseek-flash` declares `low|high|max` while
 * `deepseek-v4-pro` declares only `high|max` - a shared list would hand `-pro`
 * an effort it never declared. `minimal`/`medium`/`xhigh` are vendor aliases
 * (medium maps to high) and are not surfaced, so the menu has no duplicate
 * entries for identical behaviour.
 */
function deepSeekEfforts(model: Provider.Model): string[] {
  const declared = model.reasoning_options?.find((option) => option.type === "effort")?.values ?? []
  const supported = declared.filter((effort): effort is string => DEEPSEEK_WIRE_EFFORTS.includes(effort))
  if (supported.length > 0) return [...new Set(supported)]
  return model.api.id.toLowerCase().includes("pro") ? ["high", "max"] : [...DEEPSEEK_WIRE_EFFORTS]
}

/**
 * Thinking variants for a DeepSeek model: `off` from the registry's `toggle`
 * option, plus one entry per declared effort. Callers shape the payload per
 * route (SDK vs openai-compatible vs anthropic).
 */
function deepSeekThinkingVariants(
  model: Provider.Model,
  enabled: (effort: string) => Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const declaresToggle = model.reasoning_options?.some((option) => option.type === "toggle") ?? true
  return {
    ...(declaresToggle ? { off: { thinking: { type: "disabled" } } } : {}),
    ...Object.fromEntries(deepSeekEfforts(model).map((effort) => [effort, enabled(effort)])),
  }
}

function anthropicAdaptiveEfforts'''

ANCHOR_HELPERS = '''const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]

function anthropicAdaptiveEfforts'''

SDK_OLD = '''    case "@ai-sdk/deepseek":
      if (!model.api.id.includes("deepseek-v4")) return {}
      return {
        off: { thinking: { type: "disabled" } },
        low: { thinking: { type: "enabled" }, reasoningEffort: "low" },
        high: { thinking: { type: "enabled" }, reasoningEffort: "high" },
        max: { thinking: { type: "enabled" }, reasoningEffort: "max" },
      }'''

SDK_NEW = '''    case "@ai-sdk/deepseek":
      if (!isDeepSeekThinkingId(model.api.id)) return {}
      return deepSeekThinkingVariants(model, (effort) => ({ thinking: { type: "enabled" }, reasoningEffort: effort }))'''

COMPAT_OLD = '''    case "@ai-sdk/openai-compatible":
      const efforts = [...WIDELY_SUPPORTED_EFFORTS]
      if (model.api.id.includes("deepseek-v4")) {
        return {
          high: { reasoningEffort: "high" },
          max: { reasoningEffort: "max" },
        }
      }
      return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))'''

COMPAT_NEW = '''    case "@ai-sdk/openai-compatible":
      if (isDeepSeekThinkingId(model.api.id)) {
        return deepSeekThinkingVariants(model, (effort) => ({ reasoningEffort: effort }))
      }
      return Object.fromEntries(
        WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]),
      )'''

ANTHROPIC_OLD = '''      if (model.api.id.includes("deepseek-v4")) {
        return {
          high: { thinking: { type: "enabled" }, effort: "high" },
          max: { thinking: { type: "enabled" }, effort: "max" },
        }
      }'''

ANTHROPIC_NEW = '''      if (isDeepSeekThinkingId(model.api.id)) {
        return deepSeekThinkingVariants(model, (effort) => ({ thinking: { type: "enabled" }, effort }))
      }'''

INJECT_OLD = '''    input.model.api.id.includes("deepseek-v4") &&
    ["@ai-sdk/deepseek", "@ai-sdk/openai-compatible"].includes(input.model.api.npm)'''

INJECT_NEW = '''    isDeepSeekThinkingId(input.model.api.id) &&
    ["@ai-sdk/deepseek", "@ai-sdk/openai-compatible"].includes(input.model.api.npm)'''

HUNKS = [
    ("helpers", ANCHOR_HELPERS, HELPERS),
    ("sdk", SDK_OLD, SDK_NEW),
    ("compat", COMPAT_OLD, COMPAT_NEW),
    ("anthropic", ANTHROPIC_OLD, ANTHROPIC_NEW),
    ("inject", INJECT_OLD, INJECT_NEW),
]

errors: list[str] = []
for name, old, new in HUNKS:
    count = src.count(old)
    if count != 1:
        errors.append(f"hunk {name}: anchor found {count} times (need exactly 1)")
        continue
    src = src.replace(old, new, 1)

if errors:
    raise SystemExit("PATCH ABORTED (nothing written):\n  " + "\n  ".join(errors))

# ---- post-conditions ----
checks = {
    "isDeepSeekThinkingId declared once": len(re.findall(r"function isDeepSeekThinkingId\(", src)) == 1,
    "deepSeekEfforts declared once": len(re.findall(r"function deepSeekEfforts\(", src)) == 1,
    "deepSeekThinkingVariants declared once": len(re.findall(r"function deepSeekThinkingVariants\(", src)) == 1,
    "predicate used at 4 sites": len(re.findall(r"isDeepSeekThinkingId\((model|input\.model)\.api\.id\)", src)) == 4,
    "no live deepseek-v4 literal except nvidia": len(re.findall(r'includes\("deepseek-v4"\)', src)) == 1,
    "nvidia site untouched": 'providerID === "nvidia" && input.model.api.id.includes("deepseek-v4")' in src,
    "case @openrouter present": src.count('case "@openrouter/ai-sdk-provider":') == 1,
    "case @ai-sdk/gateway present": src.count('case "@ai-sdk/gateway":') == 1,
    "case github-copilot present": src.count('case "@ai-sdk/github-copilot":') == 1,
    "no reasoning_options typo": "reasoning_options" in src,
}
failed = [k for k, ok in checks.items() if not ok]
if failed:
    raise SystemExit("POST-CONDITIONS FAILED (nothing written):\n  " + "\n  ".join(failed))

OUT.write_text(src, encoding="utf-8", newline="\n")
print(f"OK wrote {OUT} ({len(src.encode('utf-8'))} bytes, {src.count(chr(10)) + 1} lines)")
for k in checks:
    print(f"  [ok] {k}")
