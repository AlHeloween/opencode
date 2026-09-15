// Live proof for T1–T3: the DeepSeek variant set is driven by the model's own
// declared `reasoning_options`, and the family predicate covers `deepseek-flash`.
//
// Run: bun experiments/2026-09-12_deepseek-h3/verify-deepseek-variants.ts

import * as Transform from "../../packages/opencode/src/provider/transform"

type RO = { type: string; values?: string[] }[]

function mk(apiId: string, reasoning_options?: RO) {
  return {
    id: `deepseek/${apiId}`,
    providerID: "deepseek",
    api: { id: apiId, url: "https://api.deepseek.com", npm: "@ai-sdk/deepseek" },
    name: "x",
    family: "",
    release_date: "",
    status: "active",
    options: {},
    headers: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 0, output: 0 },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    reasoning_options,
    variants: {},
  } as never
}

const flashRO: RO = [
  { type: "toggle" },
  { type: "effort", values: ["low", "high", "max"] },
]
const proRO: RO = [{ type: "toggle" }, { type: "effort", values: ["high", "max"] }]

const rows: [string, unknown][] = [
  ["predicate deepseek-flash (must be true)", Transform.isDeepSeekThinkingId("deepseek-flash")],
  ["predicate deepseek-v4-pro (must be true)", Transform.isDeepSeekThinkingId("deepseek-v4-pro")],
  ["predicate deepseek-chat retired (must be false)", Transform.isDeepSeekThinkingId("deepseek-chat")],
  ["predicate deepseek-r1 retired (must be false)", Transform.isDeepSeekThinkingId("deepseek-r1")],
  ["predicate deepseek-ocr (must be false)", Transform.isDeepSeekThinkingId("deepseek-ocr")],
  [
    "flash variants, catalog RO -> off/low/high/max",
    Object.keys(Transform.variants(mk("deepseek-flash", flashRO))).join(","),
  ],
  [
    "pro variants, catalog RO -> off/high/max",
    Object.keys(Transform.variants(mk("deepseek-v4-pro", proRO))).join(","),
  ],
  [
    "flash variants, NO catalog RO (fallback) -> off/low/high/max",
    Object.keys(Transform.variants(mk("deepseek-flash", undefined))).join(","),
  ],
  [
    "pro variants, NO catalog RO (fallback) -> off/high/max",
    Object.keys(Transform.variants(mk("deepseek-v4-pro", undefined))).join(","),
  ],
  [
    "unknown effort in RO is filtered",
    Object.keys(
      Transform.variants(mk("deepseek-flash", [{ type: "toggle" }, { type: "effort", values: ["ultra", "high"] }])),
    ).join(","),
  ],
]

for (const [label, value] of rows) console.log(`${label}: ${value}`)
