import path from "path"
import { Effect, Schema } from "effect"
import { EditTool } from "./edit"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./multiedit.txt"
import * as Tool from "./tool"

const Edit = Schema.Struct({
  oldString: Schema.String.annotate({ description: "The text to replace" }),
  newString: Schema.String.annotate({ description: "The text to replace it with (must be different from oldString)" }),
  replaceAll: Schema.optional(Schema.Boolean).annotate({
    description: "Replace all occurrences of oldString (default false)",
  }),
})

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file to modify" }),
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
              // Strip verbose patch headers, keep only the hunk showing +/- lines
              const hunk = r.metadata.diff.split("\n")
                .filter((l: string) =>
                  (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("---") && !l.startsWith("+++")
                  || (l.startsWith(" ") && !l.startsWith("  ")))
                .join("\n")
              return `Edit ${i + 1}${stats}:\n${hunk}`
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
