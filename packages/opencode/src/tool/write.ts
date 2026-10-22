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
import { addressReport, terminated, trimDiff } from "./edit"
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

          // The file is read back AFTER EVERY WRITE — t139's shape, applied to `write` (ticket ca760c924e). The result
          // must describe the file that is REALLY on disk, not the tool's model of the write: a formatter that ran is
          // ONE reason the file differs, and anything else is a DIVERGENCE — which is NAMED, because a silent
          // corruption reported as success is worse than any refusal (owner, t139).
          const bytesWritten = TextCodec.encode(contentNew, form.encoding)
          yield* fs.writeWithDirs(filepath, bytesWritten)
          const formatted = yield* format.file(filepath)
          const present = yield* fs.existsSafe(filepath)
          let contentFinal = contentNew
          let diverged = false
          let divergence = ""
          if (!present) {
            // The write did not land: there is NO file at this path (a sandbox that redirected it —
            // `anthropics/claude-code#35230`). Named, never reported as a success.
            diverged = true
            divergence = "there is no file at this path — the write did not land here"
          } else if (formatted) {
            // A formatter ran: it may have stripped the BOM or the endings. `syncFile` puts the file back into the
            // form the write chose and returns the text it now holds — the file as it is REALLY there.
            contentFinal = yield* TextCodec.syncFile(fs, filepath, form.encoding, form.ending)
          } else {
            // No formatter ran: nothing but the write touched the file, so what is on disk must be exactly what was
            // written. The BYTES are read back and compared — the artefact, not the tool's opinion of it. Bytes, not
            // text: a file that is not text is legal here (a binary write), and `syncFile` fails on one.
            const bytesOnDisk = new Uint8Array(yield* fs.readFile(filepath))
            const onDisk = TextCodec.decode(bytesOnDisk, filepath)
            contentFinal = onDisk.kind === "text" ? onDisk.text : contentNew
            diverged = !Buffer.from(bytesOnDisk).equals(bytesWritten)
            divergence =
              onDisk.kind === "text"
                ? `the write wrote ${terminated(contentNew).length} lines, the file has ${terminated(onDisk.text).length}`
                : `the write wrote ${bytesWritten.length} bytes, the file has ${bytesOnDisk.length} bytes`
          }
          const formatTouched = contentFinal !== contentNew
          yield* bus.publish(File.Event.Edited, { file: filepath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: filepath,
            event: exists ? "change" : "add",
          })

          let output = diverged
            ? "Wrote file, but the file on disk is not what was written — read it back before addressing it."
            : "Wrote file successfully."
          // A conversion is never silent (owner: «агент получает уведомление»).
          if (form.notice) output += `\n\n${form.notice}`
          // A divergence is never silent either (owner, t139): the model must know that its next address is a guess.
          if (diverged) {
            output += `\n\n${path.relative(Instance.worktree, filepath)}: the file on disk is not what was written — ${divergence}. Read it back before addressing it.`
          }
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

          const report = addressReport({
            path: path.relative(Instance.worktree, filepath),
            oldText: contentOld,
            finalText: contentFinal,
            spans: [],
            created: !exists,
            formatTouched,
          })
          if (report) output += `\n\n${report}`

          const stats = yield* Effect.promise(() => diffStats(contentOld, contentFinal))
          // The patch describes the file that is REALLY there: when the formatter or a third party changed it, the
          // diff of the model's write would be a diff of something that is not on disk (t139).
          const patch =
            contentFinal === contentNew
              ? diff
              : trimDiff((yield* Effect.promise(() => createPatch(contentOld, contentFinal))) ?? "")
          const metadata: WriteMetadata = {
            filepath,
            exists,
            diagnostics,
            filediffs: [
              {
                file: filepath,
                patch,
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
