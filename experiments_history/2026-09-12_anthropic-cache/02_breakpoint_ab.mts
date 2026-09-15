/**
 * PROBE 02 — breakpoint layout A/B. [offline, no key]
 *
 * Same fixture as probe 01, three candidate layouts, one question each:
 * how much of the STATIC prefix (tools + system) is anchored by a breakpoint
 * that survives a tail reset (new session, compaction, fork, agent switch)?
 *
 * A breakpoint caches everything up to and including itself, so the answer is
 * just "position of the last static breakpoint". Tail breakpoints anchor
 * nothing that survives a reset.
 *
 * This probe measures placement arithmetic, not provider behaviour — it cannot
 * prove a cache HIT. That is probe 10 (live).
 *
 * Run:  bun run experiments/2026-09-12_anthropic-cache/02_breakpoint_ab.mts
 */
import { agenticTail, anthropicModel, estTokens, systemSlots, table } from "./lib/fixture.mts"

const slots = await systemSlots()
const model = anthropicModel()
const tail = agenticTail(3)

// tools as probe 01 sends them
const TOOLS_CHARS = JSON.stringify([
  { name: "read", description: "read a file", input_schema: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } },
  { name: "edit", description: "edit a file", input_schema: { type: "object", properties: { filePath: { type: "string" }, old: { type: "string" }, new: { type: "string" } }, required: ["filePath", "old", "new"] } },
]).length

const sysChars = slots.map((s) => s.text.length)
const staticTotal = TOOLS_CHARS + sysChars.reduce((a, b) => a + b, 0)
const stableStatic = staticTotal - sysChars[sysChars.length - 1]! // everything except the mutable tail slot

/** anchored chars for a breakpoint placed on system slot i */
const anchoredAt = (i: number) => TOOLS_CHARS + sysChars.slice(0, i + 1).reduce((a, b) => a + b, 0)

type Layout = { name: string; systemIdx: number[]; tailCount: number; note: string }

const LAYOUTS: Layout[] = [
  {
    name: "A current (transform.ts:308)",
    systemIdx: [0, 1],
    tailCount: 2,
    note: "system.slice(0,2) + last 2 non-system",
  },
  {
    name: "B last-stable + mutable + 1 tail",
    systemIdx: [slots.length - 2, slots.length - 1],
    tailCount: 1,
    note: "1 breakpoint spare for future use",
  },
  {
    name: "C last-stable + mutable + 2 tail",
    systemIdx: [slots.length - 2, slots.length - 1],
    tailCount: 2,
    note: "all 4 used, no spare",
  },
]

const rows = LAYOUTS.map((layout) => {
  const used = layout.systemIdx.length + layout.tailCount
  const lastStatic = Math.max(...layout.systemIdx)
  const anchored = anchoredAt(lastStatic)
  // a breakpoint on the mutable tail slot does not survive an agent switch
  const survivesAgentSwitch = anchoredAt(Math.max(...layout.systemIdx.filter((i) => i < slots.length - 1), -1))
  return {
    layout: layout.name,
    bps: `${used}/4`,
    "anchored (chars)": anchored,
    "anchored %": ((anchored / staticTotal) * 100).toFixed(1),
    "survives agent switch": survivesAgentSwitch <= 0 ? 0 : survivesAgentSwitch,
    "re-written on reset": staticTotal - anchored,
  }
})

console.log("\n=== static prefix anchored by a reset-surviving breakpoint ===")
console.log(`tools:${TOOLS_CHARS}  system:${sysChars.reduce((a, b) => a + b, 0)}  static total:${staticTotal} chars (~${estTokens("x".repeat(staticTotal))} est tokens)`)
console.log(`stable static (excl. mutable tail slot): ${stableStatic} chars\n`)
console.log(table(rows))

console.log("\n=== system slots and what each layout anchors ===")
console.log(
  table(
    slots.map((slot, i) => ({
      idx: i,
      slot: slot.name,
      chars: slot.text.length,
      A: LAYOUTS[0]!.systemIdx.includes(i) ? "BP" : "",
      B: LAYOUTS[1]!.systemIdx.includes(i) ? "BP" : "",
      C: LAYOUTS[2]!.systemIdx.includes(i) ? "BP" : "",
    })),
  ),
)

// ── indicative cost model ───────────────────────────────────────────────────
// ESTIMATE ONLY: chars/4 tokens, claude-opus-5 list prices from the catalog.
// Real numbers come from probe 10 (usage.cache_*_input_tokens).
const tok = (chars: number) => chars / 4
const price = model.cost // {input, output, cache:{read, write}} per 1M
const perReset = (anchored: number) => {
  const cold = tok(staticTotal - anchored) // re-written at write price
  const warm = tok(anchored) // served at read price
  return (cold * price.cache.write + warm * price.cache.read) / 1_000_000
}
console.log("\n=== indicative $ per cold-start/compaction event (static prefix only, ESTIMATE) ===")
console.log(
  table(
    LAYOUTS.map((layout, i) => ({
      layout: layout.name,
      "$ per reset": perReset(Number(rows[i]!["anchored (chars)"])).toFixed(5),
    })),
  ),
)
console.log("\nnote: chars/4 is an estimate, not a token count; prices are catalog list for claude-opus-5.")
