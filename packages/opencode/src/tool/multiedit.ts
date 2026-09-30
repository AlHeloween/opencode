import path from "path"
import { Effect, Schema } from "effect"
import { EditTool, convertToLineEnding, detectLineEnding, normalizeLineEndings, replace, trimDiff } from "./edit"
import { createPatch, diffStats } from "@/util/diff-wasm"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./multiedit.txt"
import * as Tool from "./tool"
import { Constitution } from "@/session/constitution"
import { Instance } from "../project/instance"
import * as Bom from "@/util/bom"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
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
    const afs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { filePath: string; edits: { oldString: string; newString: string; replaceAll?: boolean }[] },
        ctx: Tool.Context,
      ) =>
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

          // ── Resolve every edit in memory; write nothing yet ────────────────────────
          //
          // This loop IS the contract. `edit` writes the file on every call, so the
          // previous shape — one `edit` call per entry — left every already-applied
          // edit on disk as soon as a later one failed, while this tool's own
          // description promised «If any edit fails … none are applied — the file is
          // rolled back to its original state». No rollback existed anywhere: the
          // promise was simply not implemented, and the failure report was silent
          // about the writes that had already landed, so an agent that trusted it and
          // retried would apply the landed edits a second time.
          //
          // Measured 2026-09-30 with three probes (valid→impossible left the first
          // write on disk; impossible→valid changed nothing; both-valid was the
          // control), first reported 2026-09-29 — see
          // experiments/2026-09-30_multiedit-partial-apply/. Resolving against a buffer
          // FIRST makes the promise structural instead of compensating: on failure
          // there is nothing to roll back, because nothing was written, and the report
          // can say that truthfully.
          //
          // `replace` and the line-ending pipeline are imported from `edit.ts` rather
          // than re-implemented — a second spelling of one rule is the defect, not the
          // fix.
          const existed = yield* afs.existsSafe(filePath)
          const source = existed ? yield* Bom.readFile(afs, filePath) : { bom: false, text: "" }
          const contentOld = source.text
          const createPath = params.edits.some((edit) => edit.oldString === "")
          let current = contentOld
          const steps: { before: string; after: string }[] = []

          for (const [index, edit] of params.edits.entries()) {
            const before = current
            if (edit.oldString === "") {
              // `edit`'s seed semantics: the given text becomes the content and later
              // entries refine it.
              current = Bom.split(edit.newString).text
              steps.push({ before, after: current })
              continue
            }
            const ending = detectLineEnding(current)
            const old = convertToLineEnding(normalizeLineEndings(edit.oldString), ending)
            const replacement = convertToLineEnding(normalizeLineEndings(edit.newString), ending)
            try {
              current = replace(current, old, replacement, edit.replaceAll)
            } catch (cause) {
              throw new Error(
                `multiedit: edit ${index + 1} of ${params.edits.length} did not apply. ` +
                  `NOTHING was written — ${filePath} is unchanged. ` +
                  `${cause instanceof Error ? cause.message : String(cause)}`,
              )
            }
            steps.push({ before, after: current })
          }

          if (!createPath && current === contentOld) {
            return {
              title: path.relative(ins.worktree, params.filePath),
              metadata: { results: [], allDiffs: "" },
              output:
                `Multiple edits resolved to no change — ${params.edits.length} edit(s) left ${filePath} ` +
                `exactly as it was, and nothing was written.`,
            }
          }

          // ── One write, through `edit`, only after every edit has matched ────────────
          //
          // Going through `edit` keeps everything this tool inherits from it — the file
          // lock, the backup, the permission prompt with the real diff, the formatter,
          // the bus events, the diff stats and the LSP diagnostics. Because the dry run
          // above already proved every entry matchable, this call cannot fail on a
          // non-matching anchor, which is what removes the partial-apply window
          // entirely rather than shrinking it.
          const outcome = yield* editTool.execute(
            createPath
              ? { filePath: params.filePath, oldString: "", newString: current }
              : { filePath: params.filePath, oldString: contentOld, newString: current },
            ctx,
          )

          const results: { diff: string; filediff: { file: string; patch: string; additions: number; deletions: number } }[] =
            []
          const labelled: string[] = []
          for (const [index, step] of steps.entries()) {
            const patch = trimDiff(
              (yield* Effect.promise(() =>
                createPatch(normalizeLineEndings(step.before), normalizeLineEndings(step.after)),
              )) ?? "",
            )
            const stats = yield* Effect.promise(() => diffStats(step.before, step.after))
            const additions = stats?.additions ?? 0
            const deletions = stats?.deletions ?? 0
            const stat = stats ? ` (+${additions} -${deletions})` : ""
            results.push({ diff: patch, filediff: { file: filePath, patch, additions, deletions } })
            labelled.push(`Edit ${index + 1}${stat}:\n${patch}`)
          }

          const allDiffs = labelled.join("\n")
          return {
            title: path.relative(ins.worktree, params.filePath),
            metadata: { results, allDiffs },
            output:
              `Multiple edits applied successfully (${params.edits.length} edits, written once)\n\n` +
              `${allDiffs}\n\n${outcome.output}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
