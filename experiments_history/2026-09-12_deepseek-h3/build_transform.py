"""Build the fully-wired DeepSeek variant support in one deterministic pass.

Reads the pristine HEAD revision of transform.ts, applies every change with an
exact-count assertion, and writes the result once. This exists because repeated
`edit` calls raced against concurrent whole-file writes and produced duplicate
helpers; a single generated write has no partial-application window.

Usage: python experiments/2026-09-12_deepseek-h3/build_transform.py
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
TARGET = REPO / "packages/opencode/src/provider/transform.ts"

HELPERS = '''
/** Retired DeepSeek aliases: not thinking-toggle models — excluded from every path below. */
const DEEPSEEK_RETIRED_ALIASES = ["deepseek-chat", "deepseek-reasoner", "deepseek-r1", "deepseek-v3"]
/** Effort values api.deepseek.com accepts (live-verified 2026-09-12). */
const DEEPSEEK_WIRE_EFFORTS = ["low", "high", "max"]

/**
 * DeepSeek V4.x thinking family — the single predicate for every DeepSeek site
 * (resolveNpm, variants, thinking injection).
 *
 * The 2026-09-10 release ships as plain `deepseek-flash` (DeepSeek-V4.1-Flash),
 * which contains neither `v4` nor `deepseek-v4`, so a version-substring test
 * silently dropped the *current* model onto the generic openai-compatible path:
 * wrong npm package, `low/medium/high` variants (no `off`, no `max`) and no
 * `thinking` injection. Measured live — experiments/2026-09-12_deepseek-h3/REPORT.md.
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
 * `deepseek-v4-pro` declares only `high|max` — a shared list would hand `-pro`
 * an effort it never declared. `minimal`/`medium`/`xhigh` are vendor aliases
 * (medium->high) and are not surfaced, so the menu has no duplicate entries.
 */
function deepSeekEfforts(model: Provider.Model): string[] {
  const declared = model.reasoning_options?.find((option) => option.type === "effort")?.values ?? []
  const supported = declared.filter((effort): effort is string => DEEPSEEK_WIRE_EFFORTS.includes(effort))
  if (supported.length > 0) return [...new Set(supported)]
  return model.api.id.toLowerCase().includes("pro") ? ["high", "max"] : [...DEEPSEEK_WIRE_EFFORTS]
}

/**
 * Thinking variants for a DeepSeek model: `off` from the registry's `toggle`
 * option, plus one entry per declared effort. `enabled` shapes the payload per
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
'''

EDITS: tuple[tuple[str, str, str], ...] = (
    (
        "insert helpers",
        'const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]\n',
        'const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]\n' + HELPERS,
    ),
    (
        "sdk deepseek case",
        '''    case "@ai-sdk/deepseek":
      if (!model.api.id.includes("deepseek-v4")) return {}
      return {
        off: { thinking: { type: "disabled" } },
        low: { thinking: { type: "enabled" }, reasoningEffort: "low" },
        high: { thinking: { type: "enabled" }, reasoningEffort: "high" },
        max: { thinking: { type: "enabled" }, reasoningEffort: "max" },
      }
''',
        '''    case "@ai-sdk/deepseek":
      if (!isDeepSeekThinkingId(model.api.id)) return {}
      return deepSeekThinkingVariants(model, (effort) => ({ thinking: { type: "enabled" }, reasoningEffort: effort }))
''',
    ),
    (
        "openai-compatible case",
        '''    case "@ai-sdk/openai-compatible":
      const efforts = [...WIDELY_SUPPORTED_EFFORTS]
      if (model.api.id.includes("deepseek-v4")) {
        return {
          high: { reasoningEffort: "high" },
          max: { reasoningEffort: "max" },
        }
      }
      return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
''',
        '''    case "@ai-sdk/openai-compatible":
      if (isDeepSeekThinkingId(model.api.id)) {
        return deepSeekThinkingVariants(model, (effort) => ({ reasoningEffort: effort }))
      }
      return Object.fromEntries(
        WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]),
      )
''',
    ),
    (
        "anthropic case",
        '''      if (model.api.id.includes("deepseek-v4")) {
        return {
          high: { thinking: { type: "enabled" }, effort: "high" },
          max: { thinking: { type: "enabled" }, effort: "max" },
        }
      }
''',
        '''      if (isDeepSeekThinkingId(model.api.id)) {
        return deepSeekThinkingVariants(model, (effort) => ({ thinking: { type: "enabled" }, effort }))
      }
''',
    ),
    (
        "thinking injection",
        '''    input.model.api.id.includes("deepseek-v4") &&
''',
        '''    isDeepSeekThinkingId(input.model.api.id) &&
''',
    ),
)


def main() -> int:
    base = subprocess.run(
        ["git", "show", "HEAD:packages/opencode/src/provider/transform.ts"],
        cwd=REPO,
        capture_output=True,
    )
    if base.returncode != 0:
        print("cannot read HEAD revision", file=sys.stderr)
        return 1
    text = base.stdout.decode("utf-8")
    print(f"base: {len(text)} chars, {text.count(chr(10)) + 1} lines")

    for label, old, new in EDITS:
        found = text.count(old)
        if found != 1:
            print(f"ABORT [{label}]: anchor occurs {found}x, expected 1", file=sys.stderr)
            return 1
        text = text.replace(old, new, 1)
        print(f"ok: {label}")

    for symbol in ("isDeepSeekThinkingId", "deepSeekEfforts", "deepSeekThinkingVariants"):
        declarations = text.count(f"function {symbol}")
        if declarations != 1:
            print(f"ABORT: {symbol} declared {declarations}x", file=sys.stderr)
            return 1

    TARGET.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {TARGET}: {len(text)} chars, {text.count(chr(10)) + 1} lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
