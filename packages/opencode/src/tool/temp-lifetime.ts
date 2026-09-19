import { Effect, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import * as Tool from "./tool"
import { Session } from "../session/session"
import { MessageV2 } from "../session/message-v2"
import { SessionID } from "../session/schema"
import { currentTurn } from "../session/turn"
import { readStoredPart, type StoredPart } from "../session/stored-part"

/**
 * THE WRITERS OF THE DECLARED LIFETIME (owner ruling, 2026-09-19).
 *
 * The declaration already exists: `ttlUntil`/`ttlScope` on the part, promoted to the `part` COLUMNS at
 * the single write point and judged by the conversion gate against ONE number — the current turn. These
 * two tools are what PUT a value there, and nothing else does. Without them the gate is live on the
 * wire and permanently inert, because no part ever declares a span.
 *
 * The address they take is the PART ID a placeholder prints (`id=<partID>`) — the one handle the system
 * already hands the model for content it has paid for. No new address surface is invented, and a piece
 * whose id the model has never seen is a piece it cannot name.
 *
 * The asymmetry worth stating: the model can see a handle, so it can hold a heavy result for the few
 * turns it actually needs instead of dragging every result it ever read to the end of the session.
 */

/**
 * "Hold it for N more turns" resolved into the ABSOLUTE turn the part carries.
 *
 * Absolute because the reader that judges it is the conversion, which sees stored parts long after the
 * tool that made them and has exactly one number available — the current turn. A relative value would
 * have to say since WHEN, which is the writer's information and never the reader's.
 *
 * The gate holds while `ttlUntil >= turn` and releases once `ttlUntil < turn`, so `turns: 0` means
 * "this turn only": it rides now and leaves from the next turn on. Naming that boundary here is not
 * decoration — both sides must agree on it, and a disagreement of one turn is invisible.
 */
export function resolveSpan(turns: number, now: number): number {
  return now + Math.max(0, Math.floor(turns))
}

/**
 * The part as it must be WRITTEN BACK.
 *
 * Built from the STORED json plus the identity read from the table COLUMNS — never from a caller's
 * object, and never with an asserted field. The `as` at the end is over a payload whose identity is
 * typed and verified, which is the one situation a cast in a write path is acceptable in: the earlier
 * version of this same idea (recall's `keep`) asserted `sessionID` into existence and therefore wrote
 * nothing, in every build, green in every test.
 *
 * An ABSENT span is expressed by OMITTING the keys rather than writing `null`/`undefined` into them —
 * both read back as SQL NULL, but only one leaves the stored json clean, and "permanent" needs no
 * stored value of its own. The gate treats `null` as "no declaration" too, because the column is
 * nullable and another writer's null must never be read as "expired".
 */
export function withLifetime(stored: StoredPart, ttlUntil?: number, ttlScope?: string): MessageV2.Part {
  return {
    ...stored.json,
    id: stored.id,
    sessionID: stored.sessionID,
    messageID: stored.messageID,
    ...(ttlUntil === undefined ? {} : { ttlUntil }),
    ...(ttlScope === undefined ? {} : { ttlScope }),
  } as unknown as MessageV2.Part
}

/** `tool: title` when the part stored one, else just the tool — the same label the placeholder prints. */
function describe(stored: StoredPart): string {
  const json = stored.json as { type?: string; tool?: string; state?: { title?: string } }
  const tool = typeof json.tool === "string" && json.tool !== "" ? json.tool : (json.type ?? "part")
  const title = json.state?.title
  return typeof title === "string" && title !== "" ? `${tool}: ${title}` : tool
}

/** A part that carries no payload cannot be held, so it is refused BY NAME rather than silently ignored. */
function holdable(stored: StoredPart): { ok: true } | { ok: false; error: string } {
  const json = stored.json as { type?: string }
  if (json.type === "tool" || json.type === "file") return { ok: true }
  return {
    ok: false,
    error: `part ${stored.id} is a ${json.type ?? "unknown"} part — only a tool result or an attached file carries a payload a hold could release`,
  }
}

const dbPath = () => path.join(Global.Path.data, "opencode.db")

const EnableParameters = Schema.Struct({
  id: Schema.String.annotate({
    description:
      'Part id of the piece to hold — exactly the `id=` value printed beside it, e.g. `[grep id=prt_0b8da48fb001… — result delivered earlier (10.0 KB)]` → "prt_0b8da48fb001…".',
  }),
  turns: Schema.optional(Schema.Number).annotate({
    description:
      "Hold it for this many MORE turns (0 = only the turn you are in). Omit `turns` and `scope` together to make it permanent, i.e. to remove the declaration entirely.",
  }),
  scope: Schema.optional(Schema.String).annotate({
    description:
      "Optional label binding the hold to one named temporary enable (`tmp_…`), so a group can be released together later. Stored, and reported back — it is NOT judged by the gate yet, so a scope alone does not change what is sent.",
  }),
  reason: Schema.String.annotate({
    description:
      "WHY this piece has to survive — e.g. \"still diffing against this schema\". Required, and echoed into this tool's own output so the motive is readable after the fact.",
  }),
})

const DisableParameters = Schema.Struct({
  id: Schema.String.annotate({
    description: "Part id whose hold is to be removed — the id this tool reported when the hold was declared.",
  }),
  reason: Schema.String.annotate({
    description:
      "WHY it is safe to let this piece go — e.g. \"the migration is written; the schema is no longer needed\". Required, and echoed into this tool's own output.",
  }),
})

/** The declared-lifetime tools return exactly this shape: the piece, what happened, and the ids affected. */
type LifetimeVictory = {
  title: string
  metadata: { id: string; report: string; ids_range: string; ttlUntil: number | undefined; scope: string; type: string; error: string }
  output: string
}

export const TempEnableTool = Tool.define(
  "tempenable",
  Effect.gen(function* () {
    const session = yield* Session.Service
    return {
      description:
        "Hold a heavy result that was already delivered — a tool result or an attached file — for a bounded number of turns, so it keeps riding the wire and is not released, and so a fold can let it go on schedule. The address is the part id a placeholder prints (id=…). Nothing is stored twice: the declaration lives on the part itself, and removing it (TempDisable) restores the piece.",
      parameters: EnableParameters,
      execute: (params: { id: string; turns?: number; scope?: string; reason: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "tempenable",
            patterns: [params.id],
            always: ["*"],
            metadata: { id: params.id, turns: params.turns, scope: params.scope },
          })

          const fail = (error: string): LifetimeVictory => ({
            title: `tempenable: ${params.id} failed`,
            metadata: { id: params.id, report: "", ids_range: "", ttlUntil: undefined, scope: "", type: "", error },
            output: `tempenable failed: ${error}`,
          })

          const lookup = readStoredPart({ dbPath: dbPath(), id: params.id })
          if (!lookup.ok) return fail(lookup.error)
          const allowed = holdable(lookup.part)
          if (!allowed.ok) return fail(allowed.error)

          const label = describe(lookup.part)
          const turns = params.turns === undefined ? undefined : Math.max(0, Math.floor(params.turns))
          const now = turns === undefined ? undefined : currentTurn(SessionID.make(lookup.part.sessionID))
          const ttlUntil = turns === undefined || now === undefined ? undefined : resolveSpan(turns, now)

          yield* session.updatePart(withLifetime(lookup.part, ttlUntil, params.scope))

          const report =
            ttlUntil === undefined
              ? `no span declared: ${label} is PERMANENT, so the mechanism does not apply to it at all. ${params.scope === undefined ? "" : `Scope "${params.scope}" stored as a label (not judged by the gate yet). `}Reason: ${params.reason}`
              : `held ${label} until turn ${ttlUntil} — this turn is ${now}, so it rides ${turns} more turn(s) and is released after that. It is not counted in a summary, and a fold releases it. Reason: ${params.reason}`

          return {
            title: `tempenable: ${label}${ttlUntil === undefined ? " (permanent)" : ` until turn ${ttlUntil}`}`,
            metadata: {
              id: params.id,
              report,
              ids_range: params.id,
              ttlUntil,
              scope: params.scope ?? "",
              type: String((lookup.part.json as { type?: string }).type ?? ""),
              error: "",
            },
            output:
              `tempenable — id=${params.id}\n` +
              `  report: ${report}\n` +
              `  ids_range: ${params.id}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
  "tempenable",
)

export const TempDisableTool = Tool.define(
  "tempdisable",
  Effect.gen(function* () {
    const session = yield* Session.Service
    return {
      description:
        "Remove a declared hold from a piece, so its payload is permanent again and rides the wire in full. The counterpart of tempenable, on the same address (the part id). Nothing is deleted: the record always kept the payload, and a hold only ever affected what was SENT.",
      parameters: DisableParameters,
      execute: (params: { id: string; reason: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "tempdisable",
            patterns: [params.id],
            always: ["*"],
            metadata: { id: params.id },
          })

          const fail = (error: string): LifetimeVictory => ({
            title: `tempdisable: ${params.id} failed`,
            metadata: { id: params.id, report: "", ids_range: "", ttlUntil: undefined, scope: "", type: "", error },
            output: `tempdisable failed: ${error}`,
          })

          const lookup = readStoredPart({ dbPath: dbPath(), id: params.id })
          if (!lookup.ok) return fail(lookup.error)

          const before = (lookup.part.json as { ttlUntil?: number | null }).ttlUntil
          const label = describe(lookup.part)

          // The declaration is removed by OMITTING the keys — "permanent" is the absence of a span, not a
          // sentinel value, so there is nothing here that a later reader could mistake for a live span.
          yield* session.updatePart(withLifetime(lookup.part))

          const report =
            typeof before === "number"
              ? `released ${label} — it was held until turn ${before} and is PERMANENT again, so the full payload rides the wire from the next request on. Reason: ${params.reason}`
              : `${label} carried no declared span, so there was nothing to release — it was already permanent. Reason: ${params.reason}`

          return {
            title: `tempdisable: ${label}`,
            metadata: {
              id: params.id,
              report,
              ids_range: params.id,
              ttlUntil: undefined,
              scope: "",
              type: String((lookup.part.json as { type?: string }).type ?? ""),
              error: "",
            },
            output: `tempdisable — id=${params.id}\n  report: ${report}\n  ids_range: ${params.id}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
  "tempdisable",
)
