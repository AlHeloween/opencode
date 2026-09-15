// Smoke (2026-09-07): C3 deliver-once placeholder replay.
// 1. Byte-stability: same (tool, id, title, chars) → identical placeholder text.
// 2. Current-turn assistant's heavy tool part replays in full.
// 3. Earlier-turn heavy tool part collapses to the placeholder.
// 4. Light earlier-turn parts replay unchanged (< 8000 chars).
// 5. Legacy path (no currentTurnAssistantID): heavy replays full (title/checkpoint).
import { toModelMessagesEffect, toolPlaceholder, TOOL_PLACEHOLDER_THRESHOLD_CHARS } from "../../packages/opencode/src/session/message-v2.ts"
import { Effect } from "effect"
import * as EffectLogger from "../../packages/core/src/effect/logger.ts"

const model = {
  providerID: "zai-org",
  id: "glm-test",
  api: { npm: "@openrouter/ai-sdk-provider" },
  capabilities: { input: { image: true, video: true } },
} as any

const heavy = "x".repeat(50_000)
const light = "short result"

function toolPart(id: string, callID: string, output: string, title: string) {
  return {
    type: "tool",
    id,
    messageID: "a1",
    sessionID: "s1",
    tool: "read",
    callID,
    state: { status: "completed", input: {}, output, title, metadata: {}, time: { start: 0, end: 1 } },
  } as any
}

const history = [
  {
    info: { id: "a0", role: "assistant", providerID: "zai-org", modelID: "glm-test" },
    parts: [toolPart("prt_old_heavy", "call_old_heavy", heavy, "big file"), toolPart("prt_old_light", "call_old_light", light, "small")],
  },
  {
    info: { id: "u1", role: "user" },
    parts: [{ type: "text", id: "prt_u1", messageID: "u1", sessionID: "s1", text: "go" }],
  },
  {
    info: { id: "a1", role: "assistant", providerID: "zai-org", modelID: "glm-test" },
    parts: [toolPart("prt_cur_heavy", "call_cur_heavy", heavy, "current turn heavy")],
  },
] as any

const run = async (opts: Record<string, unknown>) => {
  const program = toModelMessagesEffect(history, model, opts as any)
  return await Effect.runPromise(program.pipe(Effect.provide(EffectLogger.layer)))
}

// 1. byte stability
const p1 = toolPlaceholder({ tool: "read", partID: "prt_x", title: "f.ts", chars: 50_000 })
const p2 = toolPlaceholder({ tool: "read", partID: "prt_x", title: "f.ts", chars: 50_000 })
console.log("1. byte-stable:", p1 === p2 ? "PASS" : "FAIL", JSON.stringify(p1))

// current turn = a1: old heavy → placeholder; old light → full; current heavy → full
const msgs = await run({ currentTurnAssistantID: "a1", toolOutputMaxChars: 32_000 })
const wire = JSON.stringify(msgs)
console.log("2. old heavy placeholderd:", wire.includes(toolPlaceholder({ tool: "read", partID: "prt_old_heavy", title: "big file", chars: heavy.length })) ? "PASS" : "FAIL")
// The old heavy part must contribute only its placeholder; verify the byte
// count on the wire is placeholder-scale, not 50k-scale. Use a unique marker
// substring that only the raw payload would contain at scale.
const oldHeavyPayloadTail = "x".repeat(40000) // placeholder never carries this
console.log("3. old heavy text NOT on wire:", !wire.includes(oldHeavyPayloadTail) ? "PASS" : "FAIL")
console.log("4. old light full:", wire.includes(light) ? "PASS" : "FAIL")
console.log("5. current heavy full:", wire.slice(wire.indexOf("call_cur_heavy")).includes("x".repeat(1000)) ? "PASS" : "FAIL")

// no currentTurn (title/checkpoint path): heavy replays full (legacy behavior)
const msgsLegacy = await run({ toolOutputMaxChars: 32_000 })
const wireLegacy = JSON.stringify(msgsLegacy)
console.log("6. legacy (no currentTurn): heavy full replay:", wireLegacy.includes("x".repeat(1000)) ? "PASS" : "FAIL")
console.log("7. threshold value:", TOOL_PLACEHOLDER_THRESHOLD_CHARS)
