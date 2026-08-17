/**
 * Agent-facing restore from edit .bak backups (no git / no Fossil).
 * Uses session backups under {worktree}/.opencode/data/backups/{sessionID}/.
 */
import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./restore.txt"
import { File } from "../file"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { filePathDescription } from "./path-hint"
import { findLatestBackup, listBackups, restoreBackup } from "./edit-backup"
import { assertExternalDirectoryEffect } from "./external-directory"
import { Constitution } from "@/session/constitution"

type RestoreMetadata = {
  count?: number
  filepath?: string
  filename?: string
  found?: boolean
  error?: string
}

export const Parameters = Schema.Struct({
  list: Schema.optional(Schema.Boolean).annotate({
    description: "If true, list session edit backups instead of restoring. Default false.",
  }),
  filePath: Schema.optional(Schema.String).annotate({
    description: filePathDescription(
      "File to restore to its latest pre-edit .bak (matches originalPath from edit backups)",
    ),
  }),
  filename: Schema.optional(Schema.String).annotate({
    description:
      "Exact backup filename from list (e.g. 20260806-120000_call_....bak). Use when multiple backups exist for a path.",
  }),
})

export const RestoreTool = Tool.define(
  "restore",
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      // Cast: listBackups/restoreBackup re-yield AppFileSystem; runtime provides it via tool layer.
      // Tool.Def requires Effect<..., never, never> for execute.
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<RestoreMetadata>> =>
        Effect.gen(function* () {
          const sessionID = ctx.sessionID

          if (params.list) {
            const entries = yield* listBackups(sessionID)
            if (entries.length === 0) {
              return {
                title: "edit backups",
                metadata: { count: 0 } as RestoreMetadata,
                output: "No edit backups for this session yet. Backups are created automatically when the edit tool modifies an existing file.",
              }
            }
            const sorted = entries.toSorted(
              (a, b) => b.timestamp.localeCompare(a.timestamp) || b.filename.localeCompare(a.filename),
            )
            const lines = sorted.map(
              (e) => `- ${e.filename}\n  time: ${e.timestamp}\n  path: ${e.originalPath ?? "(unknown)"}`,
            )
            return {
              title: "edit backups",
              metadata: { count: sorted.length } as RestoreMetadata,
              output: `Session edit backups (${sorted.length}, newest first):\n\n${lines.join("\n")}\n\nRestore with restore({ filename: "…" }) or restore({ filePath: "…" }) for latest match.`,
            }
          }

          if (params.filename) {
            const name = params.filename.endsWith(".bak") ? params.filename : `${params.filename}.bak`
            // Peek original path for permission
            const entries = yield* listBackups(sessionID)
            const hit = entries.find((e) => e.filename === name || e.filename === params.filename)
            if (!hit?.originalPath) {
              return yield* Effect.fail(
                new Error(`restore rejected: backup ${name} has no verified original path`),
              )
            }
            const target = hit.originalPath
            yield* assertExternalDirectoryEffect(ctx, target)
            Constitution.noteMutationRisk({ tool: "restore", path: target, sessionID })
            yield* ctx.ask({
              permission: "edit",
              patterns: [path.relative(Instance.worktree, target) || target],
              always: ["*"],
              metadata: { filepath: target, restore: name },
            })
            const restored = yield* restoreBackup(sessionID, hit.filename)
            yield* bus.publish(File.Event.Edited, { file: restored })
            return {
              title: path.basename(restored),
              metadata: { filepath: restored, filename: hit.filename } as RestoreMetadata,
              output: `Restored ${restored} from backup ${hit.filename} (pre-edit content). No git/Fossil required.`,
            }
          }

          if (params.filePath) {
            const raw = params.filePath
            const abs = path.isAbsolute(raw) ? raw : path.join(Instance.directory, raw)
            const entry = yield* findLatestBackup(sessionID, abs, (p) =>
              path.isAbsolute(p) ? p : path.join(Instance.directory, p),
            )
            if (!entry) {
              const entries = yield* listBackups(sessionID)
              const sample = entries
                .slice(0, 8)
                .map((e) => `  ${e.filename} → ${e.originalPath ?? "?"}`)
                .join("\n")
              return {
                title: "restore",
                metadata: { filepath: abs, found: false } as RestoreMetadata,
                output:
                  `No edit backup found for ${abs}.\n` +
                  `Backups exist only after the edit tool changes an existing file (not bare write create).\n` +
                  (sample
                    ? `Recent backups:\n${sample}\nUse restore({ list: true }) or restore({ filename: "…" }).`
                    : "No backups in this session. Use restore({ list: true }) after edits."),
              }
            }

            const target = entry.originalPath ?? abs
            yield* assertExternalDirectoryEffect(ctx, target)
            Constitution.noteMutationRisk({ tool: "restore", path: target, sessionID })
            yield* ctx.ask({
              permission: "edit",
              patterns: [path.relative(Instance.worktree, target) || target],
              always: ["*"],
              metadata: { filepath: target, restore: entry.filename },
            })
            const restored = yield* restoreBackup(sessionID, entry.filename)
            yield* bus.publish(File.Event.Edited, { file: restored })
            return {
              title: path.basename(restored),
              metadata: { filepath: restored, filename: entry.filename } as RestoreMetadata,
              output: `Restored ${restored} from latest backup ${entry.filename} (${entry.timestamp}). No git/Fossil required.`,
            }
          }

          // No args — list as help
          const entries = yield* listBackups(sessionID)
          if (entries.length === 0) {
            return {
              title: "restore",
              metadata: { count: 0 } as RestoreMetadata,
              output:
                "Usage: restore({ filePath: \"…\" }) | restore({ filename: \"….bak\" }) | restore({ list: true }).\nNo edit backups in this session yet.",
            }
          }
          const sorted = entries.toSorted(
            (a, b) => b.timestamp.localeCompare(a.timestamp) || b.filename.localeCompare(a.filename),
          )
          const lines = sorted
            .slice(0, 20)
            .map((e) => `- ${e.filename}  ${e.originalPath ?? "?"}`)
            .join("\n")
          return {
            title: "restore",
            metadata: { count: sorted.length } as RestoreMetadata,
            output: `Provide filePath or filename to restore. Recent backups:\n${lines}`,
          }
        }).pipe(Effect.orDie) as Effect.Effect<Tool.ExecuteResult<RestoreMetadata>>,
    }
  }),
)
