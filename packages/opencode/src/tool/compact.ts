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
  reason: Schema.String.annotate({
    description:
      "The boundary that closed, in one line (e.g. 'plan X moved to plans_completed, docs updated'). REQUIRED, and it is echoed into this tool's own output — so the record of WHY the window folded survives the fold it describes (m* copies tool results; it does not copy a call's arguments).",
  }),
})

type Metadata = {
  armed: boolean
  reason: string
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
          CompactionRequest.request(ctx.sessionID, params.reason)
          // `Boundary:` rides the OUTPUT on purpose. m* copies a tool RESULT into
          // the next window; a call's arguments live only in the tool part, and
          // the argument is exactly what the reader of the fold needs. Measured
          // 2026-09-19 in m*: `[tool:compact] (completed)` present, its `reason`
          // absent — so the fold had no recorded motive anywhere in the window.
          return {
            title: "compact at turn boundary",
            metadata: { armed: !already, reason: params.reason } satisfies Metadata,
            output: already
              ? [
                  "Compaction was already requested for this turn; the fold runs once at turn end.",
                  `Boundary: ${params.reason}`,
                ].join("\n")
              : [
                  "Layer-2 fold armed. It runs when this turn ends, not now.",
                  "Nothing is asked of a model at the boundary: the head is READ — memory verbatim,",
                  "the plan's intention and the opening request as the goal, the window's topics, the",
                  "rows' own dominants and weighted terms as a table of contents, and the tail verbatim.",
                  "Exact handles survive in message*; recover detail with sessionread.",
                  "",
                  `Boundary: ${params.reason}`,
                  "",
                  "Finish persisting anything that must outlive the window before you stop.",
                ].join("\n"),
          }
        }),
    }
  }),
)
