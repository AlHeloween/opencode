/**
 * Correct the prose of a Layer-1 summary before the fold carries it into `m*`.
 * The mechanical half of a summary is structure and stays untouched — see
 * `IncrementalCheckpoint.reviseBody`, where the update names one column.
 */
import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./summaryedit.txt"
import { Instance } from "../project/instance"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { IncrementalCheckpoint } from "@/session/incremental-checkpoint"

const REVISIONS_DIR = ".opencode/data/summary-revisions"

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({
    description: "Checkpoint id of the summary, as listed by checkstate.",
  }),
  sessionId: Schema.optional(Schema.String).annotate({
    description:
      "Session to look in. Defaults to the current one. Another session's summaries are readable but not writable.",
  }),
  // Literal union rather than a loose string: an unknown action must be
  // rejected, not silently resolved to whichever branch happens to be last.
  action: Schema.Literals(["read", "write"]).annotate({
    description: "'read' returns the current body; 'write' replaces it.",
  }),
  body: Schema.optional(Schema.String).annotate({
    description: "The corrected prose. Required for action='write'.",
  }),
})

type Metadata = { id: string; action: string; revision?: string }

/** Path for the replaced text. Nothing is lost, including a correction. */
export function revisionPath(id: string, now: Date): string {
  return path.posix.join(REVISIONS_DIR, `${id}-${now.toISOString().replace(/[:.]/g, "-")}.md`)
}

export const SummaryEditTool = Tool.define<typeof Parameters, Metadata, AppFileSystem.Service>(
  "summaryedit",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // Read anywhere, write only here. Another session's summary is
          // someone else's record of their own work: consulting it is research,
          // rewriting it is forging a record you were not present for. The
          // check is on the resolved target, before anything is read, so a
          // write can never reach a row the current session does not own.
          const target = (params.sessionId ?? ctx.sessionID) as typeof ctx.sessionID
          const foreign = target !== ctx.sessionID
          if (foreign && params.action === "write")
            return yield* Effect.fail(
              new Error(
                `Session \`${target}\` is not this session. Its summaries are readable; only this session's own record is yours to correct.`,
              ),
            )

          const found = IncrementalCheckpoint.listAll(target).find((s) => s.id === params.id)
          if (!found)
            return yield* Effect.fail(
              new Error(
                `No summary \`${params.id}\` in session \`${target}\`. Call checkstate for this session's open summary ids.`,
              ),
            )

          if (params.action === "read")
            return {
              title: `Summary ${params.id}`,
              metadata: { id: params.id, action: "read" } satisfies Metadata,
              output: [
                `checkpoint_id: \`${found.id}\``,
                `from_id: \`${found.fromMessageID}\`  to_id: \`${found.toMessageID}\``,
                `info_mark: links Exact (not editable) — body Inferred (editable)`,
                foreign
                  ? `session: \`${target}\` — another session's record. Readable, not yours to correct.`
                  : found.materializedMessageID
                    ? `ALREADY FOLDED into \`${found.materializedMessageID}\` — correcting it now contradicts m* rather than fixing it.`
                    : "status: open — this body folds into the next m*.",
                "",
                found.body,
              ].join("\n"),
            }

          if (params.body === undefined || params.body.trim() === "")
            return yield* Effect.fail(
              new Error("action='write' needs a body. An empty summary is a deletion, not a correction."),
            )

          yield* ctx.ask({
            permission: "summaryedit",
            patterns: [params.id],
            always: ["*"],
            metadata: { id: params.id, chars: params.body.length },
          })

          // Keep the replaced text BEFORE the row changes: a revision written
          // after a failed update would record a body that is still current.
          const revision = revisionPath(params.id, new Date())
          yield* fs.writeWithDirs(path.join(Instance.worktree, revision), found.body)

          const previous = IncrementalCheckpoint.reviseBody({
            // ctx.sessionID, not `target`: the foreign guard above already
            // refused, and naming the current session here means a future edit
            // to that guard cannot silently widen the write.
            sessionID: ctx.sessionID,
            id: params.id,
            body: params.body,
          })
          if (previous === undefined)
            return yield* Effect.fail(new Error(`Summary \`${params.id}\` vanished between read and write.`))

          return {
            title: `Summary ${params.id} revised`,
            metadata: { id: params.id, action: "write", revision } satisfies Metadata,
            output: [
              `Body replaced (${previous.length.toLocaleString("en-US")} → ${params.body.length.toLocaleString("en-US")} chars).`,
              `Replaced text kept at ${revision}.`,
              `Structure untouched: from_id \`${found.fromMessageID}\`, to_id \`${found.toMessageID}\`.`,
              "The body is still Inferred — editing it did not promote anything.",
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
