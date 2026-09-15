/**
 * PROBE 10 - LIVE breakpoint-layout A/B. [needs ANTHROPIC_API_KEY]
 *
 * The decisive oracle for probe 02. Probe 02 measures placement arithmetic;
 * only this one can show a cache HIT.
 *
 * Arms:
 *   A = current layout  (system.slice(0,2) + last 2 non-system)
 *   B = proposed layout (last stable system slot + mutable tail + last tail)
 *
 * Each arm runs 3 sequential turns over the same prefix and reports
 * cache_creation / cache_read per turn. The arms are namespaced by a nonce at
 * the head of the prefix so arm B cannot read the cache entries arm A wrote.
 *
 * PASS for B: on warm turns cacheRead(B) >= cacheRead(A), and the static
 *             prefix stops reappearing as cacheWrite on every reset.
 *
 * Run:  ANTHROPIC_API_KEY=... bun run experiments/2026-09-12_anthropic-cache/10_live_cache_ab.mts
 */
import { agenticTail, systemSlots, table } from "./lib/fixture.mts"
import { client, requireKey, usageOf } from "./lib/live.mts"

requireKey("10_live_cache_ab.mts")
const MODEL = process.env.PROBE_MODEL ?? "claude-opus-5"
const MARK = { anthropic: { cacheControl: { type: "ephemeral" } } }
const slots = await systemSlots()

type Layout = "A" | "B"
const systemIdx = (layout: Layout) => (layout === "A" ? [0, 1] : [slots.length - 2, slots.length - 1])
const tailCount = (layout: Layout) => (layout === "A" ? 2 : 1)

function build(layout: Layout, turns: number, nonce: string) {
  const marks = systemIdx(layout)
  const system = slots.map((slot, i) => ({
    role: "system" as const,
    content: i === 0 ? `arm:${nonce}\n${slot.text}` : slot.text,
    ...(marks.includes(i) ? { providerOptions: MARK } : {}),
  }))
  const tail = agenticTail(turns)
  for (const msg of tail.slice(-tailCount(layout))) msg.providerOptions = MARK
  return [...system, ...tail]
}

const rows: Record<string, string | number>[] = []
for (const layout of ["A", "B"] as Layout[]) {
  const nonce = `${layout}-${Date.now()}`
  for (const turns of [1, 2, 3]) {
    const result = await client()(MODEL).doGenerate({
      prompt: build(layout, turns, nonce) as any,
      maxOutputTokens: 64,
    })
    const usage = usageOf(result)
    rows.push({ arm: layout, turn: turns, ...usage })
    console.log(`${layout} turn ${turns}: ${JSON.stringify(usage)}`)
  }
}

console.log("\n=== live cache A/B ===")
console.log(table(rows as any))
const warm = (arm: string) => rows.filter((r) => r.arm === arm && r.turn !== 1)
const sum = (rs: any[], key: string) => rs.reduce((acc, row) => acc + Number(row[key]), 0)
console.log(
  `\nwarm-turn cacheRead  A=${sum(warm("A"), "cacheRead")}  B=${sum(warm("B"), "cacheRead")}` +
    `\nwarm-turn cacheWrite A=${sum(warm("A"), "cacheWrite")}  B=${sum(warm("B"), "cacheWrite")}`,
)
