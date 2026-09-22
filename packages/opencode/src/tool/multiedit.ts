import path from "path"
import { Effect, Schema } from "effect"
import { EditTool } from "./edit"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./multiedit.txt"
import * as Tool from "./tool"
import { Constitution } from "@/session/constitution"
import { Instance } from "../project/instance"
import { filePathDescription } from "./path-hint"

const Edit = Schema.Struct({
  oldString: Schema.String.annotate({ description: "The text to replace" }),
  newString: Schema.String.annotate({ description: "The text to replace it with (must be different from oldString)" }),
  replaceAll: Schema.optional(Schema.Boolean).annotate({
    description: "Replace all occurrences of oldString (default false)",
  }),
})

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: filePathDescription("Path to the file to modify"),
  }),
  edits: Schema.Array(Edit).annotate({
    description: "Array of edit operations to perform sequentially on the file",
  }),
})

export const MultiEditTool = Tool.define(
  "multiedit",
  Effect.gen(function* () {
    const editTool = yield* Tool.init(yield* EditTool)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { filePath: string; edits: { oldString: string; newString: string; replaceAll?: boolean }[] }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          Constitution.noteMutationRisk({
            tool: "multiedit",
            path: filePath,
            sessionID: ctx.sessionID,
          })
          const results = []

          for (const edit of params.edits) {
            const result = yield* editTool.execute(
              {
                filePath: params.filePath,
                oldString: edit.oldString,
                newString: edit.newString,
                replaceAll: edit.replaceAll,
              },
              ctx,
            )
            results.push(result)
          }

          const allDiffs = results
            .map((r, i) => {
              const fd = r.metadata.filediff as { additions?: number; deletions?: number } | undefined
              const stats = fd ? ` (+${fd.additions ?? 0} -${fd.deletions ?? 0})` : ""
              if (!r.metadata.diff) return `Edit ${i + 1}: no change`
              // The diff IS the report — verbatim, exactly what `edit` produced for this hunk.
              //
              // A filter used to sit here that kept only `+`/`-` lines and context lines with a SINGLE
              // leading space, which DROPPED every indented source line from the report. The change was
              // applied correctly, but the report showed an incomplete diff — so the agent could not
              // verify its own edit from its own tool result, and the missing line looked like a lost
              // change (owner, 2026-09-21: «а мы че tail там сами не задаем?» — we did, and it was the
              // defect). Filtering a diff is not this tool's job; `edit.ts` already emits a real unified
              // diff with its context and hunk headers.
              return `Edit ${i + 1}${stats}:\n${r.metadata.diff}`
            })
            .join("\n")

          return {
            title: path.relative(ins.worktree, params.filePath),
            metadata: {
              results: results.map((r) => r.metadata),
              allDiffs,
            },
            output: `Multiple edits applied successfully (${results.length} edits)\n\n${allDiffs}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
