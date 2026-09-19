import { beforeEach, describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionID, MessageID, PartID } from "../../src/session/schema"

/**
 * The declared-lifetime gate, at the layer where the claim lives: the REQUEST.
 *
 * A part that declares a span stops sending its payload once that span has passed, while the record, the
 * parts table and the TUI stay untouched — the release happens on the wire, in the copy the conversion
 * walks, which is the whole design. So the assertions here are deliberately two-sided for every case:
 * what the wire carries, AND that the input object was not mutated.
 *
 * Falsifiers pinned, each a real failure mode:
 *   - a part whose span has passed must NOT carry its payload (the point of the mechanism);
 *   - a part without a span, or with a span still running, must carry it (no collateral release);
 *   - a span ending exactly ON this turn is still held, matching the store's `expires_at_turn < turn`;
 *   - an absent `turn` judges nothing, because "not judged" must never read as "expired".
 */

const sessionID = SessionID.make("session-gate")
const providerID = ProviderID.make("test")
const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID,
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai" },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 0, input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const assistantInfo = (id: string): MessageV2.Assistant =>
  ({
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID: "m-u",
    modelID: "test-model",
    providerID: "test",
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as unknown as MessageV2.Assistant

const basePart = (id: string) => ({
  id: PartID.make(id),
  sessionID,
  messageID: MessageID.make("m-a"),
})

const SPAM = "a tool result the agent no longer needs to read again in full"

const toolPart = (id: string, ttlUntil?: number, status: "completed" | "error" = "completed"): MessageV2.Part =>
  ({
    ...basePart(id),
    type: "tool",
    callID: `call-${id}`,
    tool: "bash",
    state:
      status === "completed"
        ? { status, input: {}, output: SPAM, title: "spam", metadata: {}, time: { start: 0, end: 1 } }
        : { status, input: {}, error: SPAM, metadata: {}, time: { start: 0, end: 1 } },
    ...(ttlUntil === undefined ? {} : { ttlUntil }),
  }) as MessageV2.Part

/** The wire text of one assistant message carrying one part, plus the part itself for the mutation check. */
async function wire(part: MessageV2.Part, turn?: number) {
  MessageV2.clearConversionCache()
  const input: MessageV2.WithParts[] = [{ info: assistantInfo("m-a"), parts: [part] }]
  const rendered = await MessageV2.toModelMessages(input, model, turn === undefined ? {} : { turn })
  // Whole-envelope containment, so the assertion does not depend on the provider envelope's exact shape.
  const body = JSON.stringify(rendered)
  const state = (input[0].parts[0] as MessageV2.ToolPart).state
  return { body, source: state.status === "error" ? state.error : state.status === "completed" ? state.output : "" }
}

describe("the declared-lifetime gate", () => {
  beforeEach(() => {
    MessageV2.clearConversionCache()
  })

  test("a span still running, and no span at all, both RIDE — no collateral release", async () => {
    const undeclared = await wire(toolPart("prt-undeclared"), 100)
    expect(undeclared.body).toContain(SPAM)

    const running = await wire(toolPart("prt-running", 101), 100)
    expect(running.body).toContain(SPAM)
  })

  test("a span ending exactly ON this turn is still held — the same direction as the store", async () => {
    const { body } = await wire(toolPart("prt-boundary", 100), 100)
    expect(body).toContain(SPAM)
  })

  test("a spent span releases the payload on the WIRE and names the recall address", async () => {
    const part = toolPart("prt-spent", 100)
    const { body, source } = await wire(part, 101)

    // The payload is gone from the request…
    expect(body).not.toContain(SPAM)
    // …the model is told, is given the address recall can actually fetch, and is told which turn it was…
    expect(body).toContain("prt-spent")
    expect(body).toContain("recall")
    expect(body).toContain("100")
    // …and the stored part still holds the full text: the release is on the wire, not in the record.
    expect(source).toContain(SPAM)
  })

  test("an errored result is released the same way — that is where the spam has no size gate", async () => {
    const { body, source } = await wire(toolPart("prt-errored", 100, "error"), 101)
    expect(body).not.toContain(SPAM)
    expect(body).toContain("prt-errored")
    expect(source).toContain(SPAM)
  })

  test("no turn means NOT JUDGED — never expired", async () => {
    const { body } = await wire(toolPart("prt-unjudged", 100), undefined)
    expect(body).toContain(SPAM)
  })

  test("a cached pre-release entry is never served after the release — the fingerprint carries it", async () => {
    const part = toolPart("prt-cached", 5)
    MessageV2.clearConversionCache()
    const input: MessageV2.WithParts[] = [{ info: assistantInfo("m-a"), parts: [part] }]

    // Turn 4 — the span is still RUNNING, so this entry is the full payload.
    const running = await MessageV2.toModelMessages(input, model, { turn: 4 })
    expect(JSON.stringify(running)).toContain(SPAM)

    // The SAME parts, now past the span, with no clearing in between: the release must reach the wire
    // even though these very messages are already cached. It holds because the release REWRITES the
    // parts and the cache key is taken from them — established by the negative control that dropped a
    // `turn` component from the key and left this case green.
    const spent = await MessageV2.toModelMessages(input, model, { turn: 6 })
    expect(JSON.stringify(spent)).not.toContain(SPAM)
    expect(JSON.stringify(spent)).toContain("prt-cached")
  })

  test("a null span means PERMANENT, not expired — the contract's own value for it", async () => {
    // The contract says a null span IS permanent. A bare `!== undefined` test coerced null to 0 and
    // RELEASED exactly the piece it was told to keep — and the `ttl_until` column is nullable, so
    // another writer's null must never read as "expired" either.
    MessageV2.clearConversionCache()
    const input: MessageV2.WithParts[] = [
      { info: assistantInfo("m-a"), parts: [{ ...toolPart("prt-null"), ttlUntil: null } as unknown as MessageV2.Part] },
    ]
    const body = JSON.stringify(await MessageV2.toModelMessages(input, model, { turn: 1000 }))
    expect(body).toContain(SPAM)
  })

  test("the fold's reset EXPIRES a running span and never un-declares it", () => {
    const running = toolPart("prt-fold", 102)
    const alreadyExpired = toolPart("prt-fold-old", 40)
    const undeclared = toolPart("prt-fold-none")
    const messages = [{ parts: [running, alreadyExpired, undeclared] }]

    // Only what is still RUNNING at the boundary moves. An already-expired span is left exactly as it is
    // (moving it again would erase when it actually ended) and an undeclared part is not touched at all.
    expect(MessageV2.spansToExpire(messages, 100).map((part) => String(part.id))).toEqual(["prt-fold"])
    expect(MessageV2.expiredSpan(100)).toBe(99)

    // The release takes effect IN THIS TURN, not the next: the gate reads the moved value as expired
    // immediately, which is what puts the payload off the wire in the same request.
    const moved = { ...running, ttlUntil: MessageV2.expiredSpan(100) } as MessageV2.Part
    expect(MessageV2.isSpanExpired(moved, 100)).toBe(true)
    expect(MessageV2.isSpanExpired(running, 100)).toBe(false)

    // And the boundary rule is the SAME one the gate uses, so a span ending exactly ON the turn rides.
    expect(MessageV2.isSpanExpired(toolPart("prt-edge", 100), 100)).toBe(false)
    expect(MessageV2.isSpanExpired(toolPart("prt-edge", 99), 100)).toBe(true)
  })
})
