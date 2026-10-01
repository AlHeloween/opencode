import path from "path"
import { Effect, Schema } from "effect"
import { EditTool, convertToLineEnding, detectLineEnding, normalizeLineEndings, replaceWithStage, trimDiff } from "./edit"
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
  exact: Schema.optional(Schema.Boolean).annotate({
    description:
      "Require a LITERAL match for oldString in this entry (default false). The matcher is fuzzy: a padded or drifted anchor still applies, and the report names the stage that matched. Set `exact: true` when the anchor must be found verbatim — a miss then fails the whole call instead of landing near it.",
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
        params: { filePath: string; edits: { oldString: string; newString: string; replaceAll?: boolean; exact?: boolean }[] },
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
          // `stage` rides with each step (plan F3) so the report can name the entries an approximate
          // stage matched. "seed" and "exact" and "address" are the ones with nothing to disclose.
          const steps: { before: string; after: string; stage: string }[] = []

          for (const [index, edit] of params.edits.entries()) {
            const before = current
            if (edit.oldString === "") {
              // `edit`'s seed semantics: the given text becomes the content and later
              // entries refine it.
              current = Bom.split(edit.newString).text
              steps.push({ before, after: current, stage: "seed" })
              continue
            }
            const ending = detectLineEnding(current)
            const old = convertToLineEnding(normalizeLineEndings(edit.oldString), ending)
            const replacement = convertToLineEnding(normalizeLineEndings(edit.newString), ending)
            let stage = "exact"
            try {
              const applied = replaceWithStage(current, old, replacement, edit.replaceAll, edit.exact)
              current = applied.content
              stage = applied.stage
            } catch (cause) {
              throw new Error(
                `multiedit: edit ${index + 1} of ${params.edits.length} did not apply. ` +
                  `NOTHING was written — ${filePath} is unchanged. ` +
                  `${cause instanceof Error ? cause.message : String(cause)}`,
              )
            }
            steps.push({ before, after: current, stage })
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
          // Plan F3: an approximated entry is NAMED here too. Same defect as `edit`'s silent success —
          // the caller inherits a file it did not describe — and this tool is where the cascade is
          // reached most often, because per-entry anchors are written in bulk.
          const approximated = steps
            .map((step, index) => ({ edit: index + 1, stage: step.stage }))
            .filter((entry) => entry.stage !== "exact" && entry.stage !== "seed" && entry.stage !== "address")
          const approximationNote = approximated.length
            ? `\n\n⚠ ${approximated.length} of ${params.edits.length} edit(s) matched by an APPROXIMATE stage, ` +
              `not literally: ${approximated.map((entry) => `edit ${entry.edit} → \`${entry.stage}\``).join(", ")}. ` +
              `Pass \`exact: true\` on an entry to require a literal match for it.`
            : ""
          return {
            title: path.relative(ins.worktree, params.filePath),
            metadata: { results, allDiffs },
            output:
              `Multiple edits applied successfully (${params.edits.length} edits, written once)\n\n` +
              `${allDiffs}\n\n${outcome.output}${approximationNote}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
