/**
 * Agent-facing boundary compaction. Arms a Layer-2 fold that the run loop
 * consumes at turn end — see session/compaction-request.ts for why it cannot
 * fold inline.
 */
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./compact.txt"
import * as CompactionRequest from "@/session/compaction-request"

export const Parameters = Schema.Struct({
  reason: Schema.optional(Schema.String).annotate({
    description:
      "The boundary that closed, in one line (e.g. 'plan X moved to plans_completed, docs updated'). Recorded with the request.",
  }),
})

type Metadata = {
  armed: boolean
  reason?: string
}

export const CompactTool = Tool.define<typeof Parameters, Metadata, never>(
  "compact",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          // Already armed this turn — say so rather than reporting a second
          // fold that will not happen. One boundary, one fold.
          const already = CompactionRequest.pendingFor(ctx.sessionID)
          CompactionRequest.request(ctx.sessionID)
          return {
            title: "compact at turn boundary",
            metadata: { armed: !already, reason: params.reason } satisfies Metadata,
            output: already
              ? "Compaction was already requested for this turn; the fold runs once at turn end."
              : [
                  "Layer-2 fold armed. It runs when this turn ends, not now:",
                  "a Layer-1 sidecar summary is captured first, then the visible window",
                  "folds to m* (summaries + recent tail). Exact handles survive in message*;",
                  "recover detail with sessionread.",
                  "",
                  "Finish persisting anything that must outlive the window before you stop.",
                ].join("\n"),
          }
        }),
    }
  }),
)
