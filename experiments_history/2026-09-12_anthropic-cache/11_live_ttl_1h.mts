/**
 * PROBE 11 - LIVE 5m vs 1h cache TTL. [needs ANTHROPIC_API_KEY]
 *
 * @ai-sdk/anthropic@4.0.7 accepts ttl:"5m"|"1h" in cacheControl natively
 * (anthropicProviderOptions schema, dist/index.js:1032). What is NOT
 * established here is the beta header the account needs for the 1h tier -
 * pass it explicitly:
 *
 *   PROBE_TTL_BETA=extended-cache-ttl-2025-04-11   (default; unverified guess)
 *
 * If the API rejects the header or the ttl, the error is printed verbatim -
 * that IS the result, not a probe bug. Do not promote the 1h claim past
 * Hypothetical until this returns a cacheRead > 0 after a >5min gap.
 *
 * Two phases so the gap can straddle the 5m expiry:
 *   bun run experiments/2026-09-12_anthropic-cache/11_live_ttl_1h.mts --phase=write
 *   (wait > 5 min, < 1 h)
 *   bun run experiments/2026-09-12_anthropic-cache/11_live_ttl_1h.mts --phase=read
 *
 * PASS for 1h: read-phase cacheRead > 0 for the 1h arm and == 0 for the 5m arm.
 */
import path from "path"
import { systemSlots, table } from "./lib/fixture.mts"
import { client, requireKey, usageOf } from "./lib/live.mts"

requireKey("11_live_ttl_1h.mts")
const MODEL = process.env.PROBE_MODEL ?? "claude-opus-5"
const BETA = process.env.PROBE_TTL_BETA ?? "extended-cache-ttl-2025-04-11"
const phase = (process.argv.find((arg) => arg.startsWith("--phase=")) ?? "--phase=write").split("=")[1]
const statePath = path.join(import.meta.dir, ".ttl-probe-state.json")
const slots = await systemSlots()

const nonce = await (async () => {
  if (phase === "write") {
    const value = `ttl-${Date.now()}`
    await Bun.write(statePath, JSON.stringify({ nonce: value }))
    return value
  }
  return JSON.parse(await Bun.file(statePath).text()).nonce as string
})()

const rows: Record<string, string | number>[] = []
for (const ttl of ["5m", "1h"] as const) {
  const prompt: any[] = slots.map((slot, i) => ({
    role: "system",
    content: i === 0 ? `ttl:${ttl}|${nonce}\n${slot.text}` : slot.text,
    ...(i === slots.length - 2
      ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl } } } }
      : {}),
  }))
  prompt.push({ role: "user", content: [{ type: "text", text: "reply with ok" }] })
  try {
    const result = await client(ttl === "1h" ? BETA : undefined)(MODEL).doGenerate({ prompt, maxOutputTokens: 32 })
    rows.push({ phase: phase!, ttl, ...usageOf(result) })
  } catch (error: any) {
    rows.push({ phase: phase!, ttl, input: "-", cacheWrite: "-", cacheRead: "-", output: `ERROR ${error?.message ?? error}` })
  }
}

console.log(`\n=== ttl probe (phase=${phase}, beta=${BETA}) ===`)
console.log(table(rows as any))
if (phase === "write") console.log("\nnow wait > 5 min and re-run with --phase=read")
