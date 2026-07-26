import * as Tool from "./tool"
import DESCRIPTION from "./compare.txt"
import { Effect, Schema, Option } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import path from "path"

const SKIP_DIRS = new Set([
  "node_modules", "__pycache__", ".git", "dist", "build", "target",
  "vendor", "bin", "obj", ".idea", ".vscode", ".zig-cache", "zig-out",
  ".coverage", "coverage", "tmp", "temp", ".cache", "cache", "logs",
  ".venv", "venv", "env", ".opencode",
])

export const Parameters = Schema.Struct({
  pathA: Schema.String.annotate({ description: "First directory path (required)" }),
  pathB: Schema.String.annotate({ description: "Second directory path (required)" }),
  verbose: Schema.optional(Schema.Boolean).annotate({
    description: "Include identical files in output. Default: false.",
  }),
  ignore: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional glob patterns to ignore",
  }),
})

type FileEntry = { size: number; mtime: number }

export const CompareTool = Tool.define(
  "compare",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const walk = (dir: string, base: string): Effect.Effect<Map<string, FileEntry>> =>
      Effect.gen(function* () {
        const result = new Map<string, FileEntry>()
        const entries = yield* fs.readDirectoryEntries(dir).pipe(
          Effect.catch(() => Effect.succeed([] as AppFileSystem.DirEntry[])),
        )
        for (const entry of entries) {
          if (SKIP_DIRS.has(entry.name)) continue
          const full = path.join(dir, entry.name)
          const rel = path.relative(base, full).replace(/\\/g, "/")

          if (entry.type === "directory") {
            const sub = yield* walk(full, base)
            for (const [k, v] of sub) result.set(k, v)
          } else {
            const stat = yield* fs.stat(full).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (stat && stat.type === "File") {
              result.set(rel, {
                size: typeof stat.size === "bigint" ? Number(stat.size) : stat.size as number,
                mtime: Option.getOrElse(stat.mtime, () => new Date(0)).getTime(),
              })
            }
          }
        }
        return result
      })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const dirA = path.isAbsolute(params.pathA) ? params.pathA : path.resolve(ins.directory, params.pathA)
          const dirB = path.isAbsolute(params.pathB) ? params.pathB : path.resolve(ins.directory, params.pathB)

          yield* ctx.ask({
            permission: "list",
            patterns: [dirA, dirB],
            always: ["*"],
            metadata: { pathA: dirA, pathB: dirB },
          })

          const [filesA, filesB] = yield* Effect.all([walk(dirA, dirA), walk(dirB, dirB)])

          const onlyA: string[] = []
          const onlyB: string[] = []
          const changed: { file: string; sizeA: number; sizeB: number }[] = []
          const same: string[] = []

          const allFiles = new Set([...filesA.keys(), ...filesB.keys()])
          for (const rel of [...allFiles].sort()) {
            const a = filesA.get(rel)
            const b = filesB.get(rel)

            if (!a) { onlyB.push(rel); continue }
            if (!b) { onlyA.push(rel); continue }

            if (a.size !== b.size || a.mtime !== b.mtime) {
              changed.push({ file: rel, sizeA: a.size, sizeB: b.size })
            } else {
              same.push(rel)
            }
          }

          const lines: string[] = []
          const labelA = path.basename(dirA)
          const labelB = path.basename(dirB)

          lines.push(`${labelA}: ${filesA.size} files`)
          lines.push(`${labelB}: ${filesB.size} files`)
          lines.push("")

          if (onlyA.length > 0) {
            lines.push(`--- Only in ${labelA} (${onlyA.length}) ---`)
            for (const f of onlyA) lines.push(`  - ${f}`)
            lines.push("")
          }
          if (onlyB.length > 0) {
            lines.push(`--- Only in ${labelB} (${onlyB.length}) ---`)
            for (const f of onlyB) lines.push(`  + ${f}`)
            lines.push("")
          }
          if (changed.length > 0) {
            lines.push(`--- Changed (${changed.length}) ---`)
            for (const c of changed) {
              const delta = c.sizeB - c.sizeA
              const sign = delta >= 0 ? "+" : ""
              lines.push(`  ~ ${c.file}  (${c.sizeA}B → ${c.sizeB}B, ${sign}${delta}B)`)
            }
            lines.push("")
          }
          if (params.verbose && same.length > 0) {
            lines.push(`--- Identical (${same.length}) ---`)
            for (const f of same) lines.push(`  = ${f}`)
            lines.push("")
          }

          if (onlyA.length === 0 && onlyB.length === 0 && changed.length === 0) {
            lines.push("Directories are identical.")
          }

          return {
            title: `${labelA} ↔ ${labelB}`,
            metadata: {
              countA: filesA.size,
              countB: filesB.size,
              onlyA: onlyA.length,
              onlyB: onlyB.length,
              changed: changed.length,
              same: same.length,
            },
            output: lines.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
