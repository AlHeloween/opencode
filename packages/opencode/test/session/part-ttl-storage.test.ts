import { describe, expect, setDefaultTimeout } from "bun:test"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Session as SessionNs } from "@/session/session"
import { use as projectDb } from "@/storage/project-db"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

Log.init()

// A tmpdir Instance plus a real write path: bun's 5 s default sits below this suite's floor.
setDefaultTimeout(20_000)

const env = Layer.mergeAll(SessionNs.defaultLayer, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

/**
 * The declared lifetime is described TWICE — inside the part's json `data`, where the part schema puts it,
 * and in the `part` COLUMNS, which are what make it walkable by query. That is the `compacted` shape, and
 * the projector derives the second from the first at ONE write point, which is the only reason the two
 * cannot drift.
 *
 * So the assertions here are about the pair: absent means NULL on both sides (the mechanism does not
 * apply — "permanent" needs no value of its own), a declared span appears on both sides, and moving it
 * moves both. `ttlUntil` is on the part BASE, so the part's own type is irrelevant to this test; the
 * payload case (a file part whose bytes leave the wire) belongs to the conversion gate.
 */
describe("the part's declared lifetime", () => {
  it.live("rides in the json and is promoted to the columns, and the columns follow the part", () =>
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

        const columns = (partID: string) =>
          projectDb((db) =>
            db.all<{ ttl_until: number | null; ttl_scope: string | null; json: number | null }>(
              sql`SELECT ttl_until, ttl_scope, json_extract(data, '$.ttlUntil') AS json
                  FROM part WHERE id = ${partID}`,
            ),
          )[0]

        // Undeclared: both sides NULL. This IS the semantics — no value means no mechanism.
        const forever = PartID.ascending()
        yield* ssn.updatePart({
          id: forever,
          messageID: su.id,
          sessionID: info.id,
          type: "text",
          text: "kept forever",
        })
        expect(columns(forever)).toEqual({ ttl_until: null, ttl_scope: null, json: null })

        // Declared: the json carries it and the columns carry it.
        const held = PartID.ascending()
        const declare = (ttlUntil?: number, ttlScope?: string) =>
          ssn.updatePart({
            id: held,
            messageID: su.id,
            sessionID: info.id,
            type: "text",
            text: "a temporary note",
            ...(ttlUntil === undefined ? {} : { ttlUntil }),
            ...(ttlScope === undefined ? {} : { ttlScope }),
          })

        yield* declare(7, "tmp_abc")
        expect(columns(held)).toEqual({ ttl_until: 7, ttl_scope: "tmp_abc", json: 7 })

        // The drift guard: an update that moves the span must move BOTH homes together.
        yield* declare(11, "tmp_abc")
        expect(columns(held)).toEqual({ ttl_until: 11, ttl_scope: "tmp_abc", json: 11 })

        // …and dropping the declaration drops both, so a release needs no sentinel value.
        yield* declare()
        expect(columns(held)).toEqual({ ttl_until: null, ttl_scope: null, json: null })
      }),
    ),
  )
})
