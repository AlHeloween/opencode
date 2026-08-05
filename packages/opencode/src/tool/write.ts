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
import * as Bom from "@/util/bom"
import { Constitution } from "@/session/constitution"
import { validateCodeSyntax } from "@/util/syntax-validator"

const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const Parameters = Schema.Struct({
  content: Schema.String.annotate({ description: "The content to write to the file" }),
  filePath: Schema.String.annotate({
    description: "The absolute path to the file to write (must be absolute, not relative)",
  }),
})

/** Both reject and success paths must share this shape (Tool.define infers a single M). */
type WriteMetadata = {
  filepath: string
  exists: boolean
  diagnostics: Record<string, Diagnostic[]>
  filediff: Snapshot.FileDiff
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
          // Reject code fragments that accidentally became file paths
          // e.g. "i+1).join(String.fromCharCode(10)))" from malformed tool calls
          if (params.filePath.includes("(") && params.filePath.includes(")") && !params.filePath.includes(".")) {
            return yield* Effect.fail(new Error(`filePath does not look like a valid path: ${params.filePath}`))
          }
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          Constitution.noteMutationRisk({ tool: "write", path: filepath, sessionID: ctx.sessionID })
          yield* assertExternalDirectoryEffect(ctx, filepath)

          const exists = yield* fs.existsSafe(filepath)
          const source = exists ? yield* Bom.readFile(fs, filepath) : { bom: false, text: "" }
          const next = Bom.split(params.content)
          const desiredBom = source.bom || next.bom
          const contentOld = source.text
          const contentNew = next.text

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
              filediff: { file: filepath, patch: diff, additions: 0, deletions: 0 },
            }
            return {
              title: path.relative(Instance.worktree, filepath),
              metadata,
              output: `REJECTED — ${syntaxErr.message}`,
            }
          }

          yield* fs.writeWithDirs(filepath, Bom.join(contentNew, desiredBom))
          if (yield* format.file(filepath)) {
            yield* Bom.syncFile(fs, filepath, desiredBom)
          }
          yield* bus.publish(File.Event.Edited, { file: filepath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: filepath,
            event: exists ? "change" : "add",
          })

          let output = "Wrote file successfully."
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
            filediff: {
              file: filepath,
              patch: diff,
              additions: stats?.additions ?? 0,
              deletions: stats?.deletions ?? 0,
            },
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
