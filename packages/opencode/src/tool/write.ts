import { Schema } from "effect"
import * as path from "path"
import { Effect } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import type { Diagnostic } from "@/lsp/client"
import { createPatch, diffStats } from "@/util/diff-wasm"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { trimDiff } from "./edit"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as TextCodec from "@/util/text-codec"
import { Constitution } from "@/session/constitution"
import { validateCodeSyntax } from "@/util/syntax-validator"
import { filePathDescription } from "./path-hint"

const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const Parameters = Schema.Struct({
  content: Schema.String.annotate({ description: "The content to write to the file" }),
  filePath: Schema.String.annotate({
    description: filePathDescription("Path to the file to write"),
  }),
})

/** Both reject and success paths must share this shape (Tool.define infers a single M). */
type WriteMetadata = {
  filepath: string
  exists: boolean
  diagnostics: Record<string, Diagnostic[]>
  filediffs: Snapshot.FileDiff[]
}

export const WriteTool = Tool.define(
  "write",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const format = yield* Format.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { content: string; filePath: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          Constitution.noteMutationRisk({ tool: "write", path: filepath, sessionID: ctx.sessionID })
          yield* assertExternalDirectoryEffect(ctx, filepath)

          const exists = yield* fs.existsSafe(filepath)
          // The SAME codec `read` and `edit` use (plan H9d). An overwrite takes the existing file's FORM — its
          // encoding and its majority ending — not the agent's: «анализ какие ендинги отправил агент, а какие у
          // файла и поправить … тоже самое с кодировкой» (owner, 2026-10-01). A binary or undecodable file has no
          // form to keep, so it is written as a new file would be.
          const source = exists ? TextCodec.decode(new Uint8Array(yield* fs.readFile(filepath)), filepath) : undefined
          const original = source?.kind === "text" ? source : undefined
          const form = TextCodec.fit(
            filepath,
            source,
            params.content,
            original ? TextCodec.lineEnding(original.text) : undefined,
          )
          const contentOld = original?.text ?? ""
          const contentNew = form.text

          const diff = trimDiff((yield* Effect.promise(() => createPatch(contentOld, contentNew))) ?? "")
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(Instance.worktree, filepath)],
            always: ["*"],
            metadata: {
              filepath,
              diff,
            },
          })

          // Pre-write syntax check for code files (.py, .ts, .js, .sh).
          // Catches hallucinated syntax before it hits disk — model can retry.
          const syntaxErr = yield* Effect.promise(() => validateCodeSyntax(filepath, contentNew))
          if (syntaxErr) {
            const metadata: WriteMetadata = {
              filepath,
              exists,
              diagnostics: {},
              filediffs: [{ file: filepath, patch: diff, additions: 0, deletions: 0 }],
            }
            return {
              title: path.relative(Instance.worktree, filepath),
              metadata,
              output: `REJECTED — ${syntaxErr.message}`,
            }
          }

          yield* fs.writeWithDirs(filepath, TextCodec.encode(contentNew, form.encoding))
          if (yield* format.file(filepath)) {
            yield* TextCodec.syncFile(fs, filepath, form.encoding, form.ending)
          }
          yield* bus.publish(File.Event.Edited, { file: filepath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: filepath,
            event: exists ? "change" : "add",
          })

          let output = "Wrote file successfully."
          // A conversion is never silent (owner: «агент получает уведомление»).
          if (form.notice) output += `\n\n${form.notice}`
          yield* lsp.touchFile(filepath, "document")
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilepath = AppFileSystem.normalizePath(filepath)
          let projectDiagnosticsCount = 0
          for (const [file, issues] of Object.entries(diagnostics)) {
            const current = file === normalizedFilepath
            if (!current && projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
            const block = LSP.Diagnostic.report(current ? filepath : file, issues)
            if (!block) continue
            if (current) {
              output += `\n\nLSP errors detected in this file, please fix:\n${block}`
              continue
            }
            projectDiagnosticsCount++
            output += `\n\nLSP errors detected in other files:\n${block}`
          }

          const stats = yield* Effect.promise(() => diffStats(contentOld, contentNew))
          const metadata: WriteMetadata = {
            filepath,
            exists,
            diagnostics,
            filediffs: [
              {
                file: filepath,
                patch: diff,
                additions: stats?.additions ?? 0,
                deletions: stats?.deletions ?? 0,
              },
            ],
          }

          return {
            title: path.relative(Instance.worktree, filepath),
            metadata,
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
