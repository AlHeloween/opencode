"""Atomic rebuild of the DeepSeek thinking patch (T1+T3) from HEAD.

Why a script instead of edit/applypatch: the worktree is being written by a
second instance of this same session, so any multi-step edit races the writer.
This runs as ONE process: read HEAD -> transform -> verify -> write.

Every replacement asserts its exact occurrence count; a mismatch aborts before
any file is written, so a partial application is impossible.
"""

from __future__ import annotations

import io
import subprocess
import sys

ROOT = r"D:\zPython\opencode"
TRANSFORM = "packages/opencode/src/provider/transform.ts"
PROVIDER = "packages/opencode/src/provider/provider.ts"


def head(path: str) -> str:
    out = subprocess.run(
        ["git", "show", f"HEAD:{path}"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    )
    return out.stdout.decode("utf-8")


def sub(text: str, old: str, new: str, *, count: int = 1, label: str = "") -> str:
    found = text.count(old)
    if found != count:
        raise SystemExit(f"ABORT [{label}]: expected {count} occurrence(s), found {found}")
    return text.replace(old, new, count)


# ---------------------------------------------------------------- transform.ts
tf = head(TRANSFORM)

HELPERS = '''/** Retired DeepSeek aliases: not thinking-toggle models - excluded from every path below. */
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
 * Effort values for a DeepSeek model, from the registry's own `reasoning_options`
 * when present. The declared set is PER MODEL, not one family constant:
 * `deepseek-flash` declares `low|high|max` while `deepseek-v4-pro` declares only
 * `high|max` - a shared list would hand `-pro` an effort it never declared.
 * `minimal`/`medium`/`xhigh` are vendor aliases (medium->high) and stay unsurfaced.
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

anchor = 'const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]\n\n'
tf = sub(tf, anchor, anchor + HELPERS, label="insert helpers")

tf = sub(
    tf,
    '    case "@ai-sdk/deepseek":\n'
    '      if (!model.api.id.includes("deepseek-v4")) return {}\n'
    "      return {\n"
    '        off: { thinking: { type: "disabled" } },\n'
    '        low: { thinking: { type: "enabled" }, reasoningEffort: "low" },\n'
    '        high: { thinking: { type: "enabled" }, reasoningEffort: "high" },\n'
    '        max: { thinking: { type: "enabled" }, reasoningEffort: "max" },\n'
    "      }\n",
    '    case "@ai-sdk/deepseek":\n'
    "      if (!isDeepSeekThinkingId(model.api.id)) return {}\n"
    "      return deepSeekThinkingVariants(model, (effort) => ({\n"
    '        thinking: { type: "enabled" },\n'
    "        reasoningEffort: effort,\n"
    "      }))\n",
    label="deepseek case",
)

tf = sub(
    tf,
    "    case \"@ai-sdk/openai-compatible\":\n"
    "      const efforts = [...WIDELY_SUPPORTED_EFFORTS]\n"
    '      if (model.api.id.includes("deepseek-v4")) {\n'
    "        return {\n"
    '          high: { reasoningEffort: "high" },\n'
    '          max: { reasoningEffort: "max" },\n'
    "        }\n"
    "      }\n"
    "      return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))\n",
    "    case \"@ai-sdk/openai-compatible\":\n"
    "      if (isDeepSeekThinkingId(model.api.id)) {\n"
    "        return deepSeekThinkingVariants(model, (effort) => ({ reasoningEffort: effort }))\n"
    "      }\n"
    "      return Object.fromEntries(\n"
    "        WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]),\n"
    "      )\n",
    label="openai-compatible case",
)

tf = sub(
    tf,
    '      if (model.api.id.includes("deepseek-v4")) {\n'
    "        return {\n"
    '          high: { thinking: { type: "enabled" }, effort: "high" },\n'
    '          max: { thinking: { type: "enabled" }, effort: "max" },\n'
    "        }\n"
    "      }\n",
    "      if (isDeepSeekThinkingId(model.api.id)) {\n"
    "        return deepSeekThinkingVariants(model, (effort) => ({\n"
    '          thinking: { type: "enabled" },\n'
    "          effort,\n"
    "        }))\n"
    "      }\n",
    label="anthropic case",
)

tf = sub(
    tf,
    "  if (\n"
    '    input.model.api.id.includes("deepseek-v4") &&\n'
    '    ["@ai-sdk/deepseek", "@ai-sdk/openai-compatible"].includes(input.model.api.npm)\n'
    "  ) {\n"
    '    result["thinking"] = { type: "enabled" }\n'
    "  }\n",
    "  if (\n"
    "    isDeepSeekThinkingId(input.model.api.id) &&\n"
    '    ["@ai-sdk/deepseek", "@ai-sdk/openai-compatible"].includes(input.model.api.npm)\n'
    "  ) {\n"
    '    result["thinking"] = { type: "enabled" }\n'
    "  }\n",
    label="thinking injection",
)

# ---------------------------------------------------------------- provider.ts
pv = head(PROVIDER)

pv = sub(
    pv,
    "function resolveNpm(providerID: string, modelID: string, fallback: string): string {\n"
    "  const id = modelID.toLowerCase()\n"
    '  if (providerID === "deepseek" && id.includes("v4")) {\n'
    '    return "@ai-sdk/deepseek"\n'
    "  }\n"
    "  return fallback\n"
    "}\n",
    "function resolveNpm(providerID: string, modelID: string, fallback: string): string {\n"
    '  if (providerID === "deepseek" && ProviderTransform.isDeepSeekThinkingId(modelID)) {\n'
    '    return "@ai-sdk/deepseek"\n'
    "  }\n"
    "  return fallback\n"
    "}\n",
    label="resolveNpm",
)

pv = sub(
    pv,
    "  release_date: Schema.String,\n"
    "  variants: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Any))),\n",
    "  release_date: Schema.String,\n"
    "  /**\n"
    "   * Declared reasoning control surface from the registry. The variant list is\n"
    "   * derived from this, not from a hardcoded family set: `deepseek-flash`\n"
    "   * declares `low|high|max` while `deepseek-v4-pro` declares only `high|max`,\n"
    "   * so one shared constant would offer an effort a model never declared.\n"
    "   */\n"
    "  reasoning_options: Schema.optional(\n"
    "    Schema.Array(\n"
    "      Schema.Struct({\n"
    "        type: Schema.String,\n"
    "        values: Schema.optional(Schema.Array(Schema.String)),\n"
    "      }),\n"
    "    ),\n"
    "  ),\n"
    "  variants: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Any))),\n",
    label="Model schema field",
)

pv = sub(
    pv,
    '    release_date: model.release_date ?? "",\n    variants: {},\n',
    '    release_date: model.release_date ?? "",\n'
    "    reasoning_options: model.reasoning_options?.map((option) => ({\n"
    "      type: option.type,\n"
    "      ...(option.values ? { values: [...option.values] } : {}),\n"
    "    })),\n"
    "    variants: {},\n",
    label="reasoning_options propagation",
)

# ------------------------------------------------------------------- write
for path, content in ((TRANSFORM, tf), (PROVIDER, pv)):
    with io.open(f"{ROOT}/{path}", "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
    print(f"wrote {path}: {len(content.encode('utf-8'))} bytes, {content.count(chr(10)) + 1} lines")

print("OK")
