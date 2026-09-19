import { describe, expect, test, setDefaultTimeout } from "bun:test"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Session as SessionNs } from "@/session/session"
import { use as projectDb } from "@/storage/project-db"
import { MessageV2 } from "../../src/session/message-v2"
import { type StoredPart } from "../../src/session/stored-part"
import { resolveSpan, withLifetime } from "../../src/tool/temp-lifetime"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "@/provider/provider"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

Log.init()

// A tmpdir Instance plus a real write path: bun's 5 s default sits below this suite's floor.
setDefaultTimeout(20_000)

const env = Layer.mergeAll(SessionNs.defaultLayer, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

const SPAM = "a heavy tool result the agent wants back for exactly two more turns"

/**
 * The conversion fixture only. The stored rows carry the real session id, read from the table COLUMNS —
 * this one exists so the assistant message has a well-typed session, not so it matches a row.
 */
const conversionSession = SessionID.make("session-lifetime")

const assistantInfo = (id: string, part: MessageV2.Part): MessageV2.WithParts => ({
  info: {
    id,
    sessionID: conversionSession,
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
  } as unknown as MessageV2.Assistant,
  parts: [part],
})

/** The wire body of the piece, at a given turn. Whole-envelope containment, so the provider shape is irrelevant. */
async function wire(part: MessageV2.Part, turn: number): Promise<string> {
  return JSON.stringify(await MessageV2.toModelMessages([assistantInfo("m-a", part)], model, { turn }))
}

const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
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

describe("the declared-lifetime writers", () => {
  test("a span is resolved into an ABSOLUTE turn, and turns 0 means this turn only", () => {
    expect(resolveSpan(0, 335)).toBe(335)
    expect(resolveSpan(2, 335)).toBe(337)
    // The gate holds while `ttlUntil >= turn`. Naming the boundary here because BOTH sides depend on it
    // and a disagreement of one turn would be invisible.
    expect(resolveSpan(0, 335) < 335).toBe(false)
    expect(resolveSpan(0, 335) < 336).toBe(true)
    // A negative or fractional request cannot produce a span in the past or a fractional turn.
    expect(resolveSpan(-5, 335)).toBe(335)
    expect(resolveSpan(1.9, 335)).toBe(336)
  })

  test("an absent span OMITS the keys, and a rewrite keeps everything it holds", () => {
    const stored: StoredPart = {
      id: "prt_x",
      sessionID: "ses_x",
      messageID: "msg_x",
      json: { type: "file", url: "data:image/webp;base64,AA", mime: "image/webp", dimensions: { width: 8, height: 8 } },
    }
    const held = withLifetime(stored, 42, "tmp_a") as unknown as Record<string, unknown>
    expect(held).toMatchObject({ id: "prt_x", ttlUntil: 42, ttlScope: "tmp_a", type: "file", mime: "image/webp" })
    expect(held.dimensions).toEqual({ width: 8, height: 8 })

    // "Permanent" is the ABSENCE of a span — not a sentinel — so nothing here can later be read as a live
    // span, and the stored json stays clean.
    const freed = withLifetime(stored) as unknown as Record<string, unknown>
    expect("ttlUntil" in freed).toBe(false)
    expect("ttlScope" in freed).toBe(false)
    expect(freed.url).toBe("data:image/webp;base64,AA")
  })

  it.live("the declaration reaches the COLUMNS, the payload then leaves the wire, and removing it restores the piece", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const su = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() },
        })

        const partID = PartID.ascending()
        yield* ssn.updatePart({
          id: partID,
          messageID: su.id,
          sessionID: info.id,
          type: "tool",
          callID: "call-lifetime",
          tool: "bash",
          state: { status: "completed", input: {}, output: SPAM, title: "spam", metadata: {}, time: { start: 0, end: 1 } },
        })

        // The part AS THE WRITER MUST SEE IT: identity from the table COLUMNS, fields from the json. This
        // is the composition the tools perform, and the layer where `recall`'s `keep` silently wrote
        // nothing for every build — a cast asserted a `sessionID` that the query never returned.
        const row = projectDb((db) =>
          db.all<{ session_id: string; message_id: string; data: string }>(
            sql`SELECT session_id, message_id, data FROM part WHERE id = ${partID}`,
          ),
        )[0]
        expect(row.session_id).toBe(info.id)
        const stored: StoredPart = {
          id: partID,
          sessionID: row.session_id,
          messageID: row.message_id,
          json: JSON.parse(row.data) as Record<string, unknown>,
        }

        // temp_enable, at the turn the tool would resolve from.
        const until = resolveSpan(2, 100)
        const held = withLifetime(stored, until)
        yield* ssn.updatePart(held)

        // The artifact, read back — not the call's report.
        const columns = projectDb((db) =>
          db.all<{ ttl_until: number | null; ttl_scope: string | null }>(
            sql`SELECT ttl_until, ttl_scope FROM part WHERE id = ${partID}`,
          ),
        )[0]
        expect(columns).toEqual({ ttl_until: until, ttl_scope: null })

        // On the wire: held through the declared turn, released after it, with the address kept.
        expect(yield* Effect.promise(() => wire(held, until))).toContain(SPAM)
        const released = yield* Effect.promise(() => wire(held, until + 1))
        expect(released).not.toContain(SPAM)
        expect(released).toContain(partID)

        // temp_disable: the declaration is REMOVED, so the piece is permanent again and rides in full.
        yield* ssn.updatePart(withLifetime(stored))
        const after = projectDb((db) =>
          db.all<{ ttl_until: number | null; json_until: number | null }>(
            sql`SELECT ttl_until, json_extract(data, '$.ttlUntil') AS json_until FROM part WHERE id = ${partID}`,
          ),
        )[0]
        expect(after.ttl_until).toBeNull()
        expect(after.json_until).toBeNull()
        expect(yield* Effect.promise(() => wire(withLifetime(stored), until + 1))).toContain(SPAM)

        // The record was never touched by a hold: the stored output is the original text throughout.
        expect(stored.json).toMatchObject({ state: { status: "completed", output: SPAM } })
      }),
    ),
  )
})
