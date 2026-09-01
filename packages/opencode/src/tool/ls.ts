import path from "path"
import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./ls.txt"
import * as Tool from "./tool"
import { directoryPathDescription } from "./path-hint"
const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
]

const LIMIT = 100

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: directoryPathDescription(
      "Optional path to the directory to list (default: project working directory)",
    ),
  }),
  ignore: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "List of glob patterns to ignore",
  }),
  directoriesOnly: Schema.optional(Schema.Boolean).annotate({
    description: "When true, show only directories (no files). Like `tree -d`. Default: false.",
  }),
  dates: Schema.optional(Schema.Boolean).annotate({
    description:
      "Show local mtime (YYYY-MM-DD HH:mm:ss) per entry — spots freshly changed files at a glance. Default: true.",
  }),
})

export const ListTool = Tool.define(
  "list",
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { path?: string; ignore?: string[]; directoriesOnly?: boolean; dates?: boolean },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const searchPath = path.resolve(ins.directory, params.path || ".")
          yield* assertExternalDirectoryEffect(ctx, searchPath, { kind: "directory" })

          yield* ctx.ask({
            permission: "list",
            patterns: [searchPath],
            always: ["*"],
            metadata: {
              path: searchPath,
            },
          })

          const ignoreGlobs = IGNORE_PATTERNS.map((p) => `!${p}*`).concat(
            (params.ignore ?? []).map((p) => `!${p}`),
          )

          const files = yield* rg
            .files({ cwd: searchPath, glob: ignoreGlobs, signal: ctx.abort })
            .pipe(
              Stream.take(LIMIT + 1),
              Stream.runCollect,
              Effect.map((chunk) => [...chunk]),
            )

          const truncated = files.length > LIMIT
          if (truncated) files.length = LIMIT

          const dirs = new Set<string>()
          const filesByDir = new Map<string, string[]>()

          for (const file of files) {
            const dir = path.dirname(file).replace(/\\/g, "/")
            const parts = dir === "." ? [] : dir.split("/")

            for (let i = 0; i <= parts.length; i++) {
              const dirPath = i === 0 ? "." : parts.slice(0, i).join("/")
              dirs.add(dirPath)
            }

            if (!filesByDir.has(dir)) filesByDir.set(dir, [])
            filesByDir.get(dir)!.push(path.basename(file))
          }

          // Local mtime per entry (2026-09-01, Alexander: "list не дает дат —
          // большое упущение"). Best-effort: stat failures render without a date.
          const showDates = params.dates !== false
          const mtimes = new Map<string, Date>()
          if (showDates) {
            // Effect platform Stat.mtime is an Option-wrapped date (not a plain
            // Date) — new Date(option) rendered NaN-NaN-NaN in the first live
            // test. Unwrap Date | number | string | Option uniformly.
            const toDate = (value: unknown): Date | undefined => {
              if (!value) return undefined
              if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value
              if (typeof value === "number" || typeof value === "string") {
                const d = new Date(value)
                return isNaN(d.getTime()) ? undefined : d
              }
              const tag = (value as any)?._tag
              if (tag === "Some") return toDate((value as any).value)
              return undefined
            }
            const targets = new Set<string>([
              ...files.map((f) => path.resolve(searchPath, f)),
              ...[...dirs].map((d) => (d === "." ? searchPath : path.resolve(searchPath, d))),
            ])
            yield* Effect.forEach(
              targets,
              (target) =>
                fs.stat(target).pipe(
                  Effect.map((info: any) => {
                    const d = toDate(info?.mtime)
                    if (d) mtimes.set(target, d)
                  }),
                  Effect.catch(() => Effect.void),
                ),
              { concurrency: 16, discard: true },
            )
          }

          function fmtDate(value: Date | undefined): string {
            if (!value) return ""
            const p = (n: number) => String(n).padStart(2, "0")
            return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())} ${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}`
          }

          function withDate(label: string, target: string): string {
            if (!showDates) return label
            const date = fmtDate(mtimes.get(target))
            return date ? `${label}  ${date}` : label
          }

          function renderDir(dirPath: string, depth: number): string {
            const indent = "  ".repeat(depth)
            let output = ""

            if (depth > 0) {
              output += `${indent}${withDate(`${path.basename(dirPath)}/`, path.resolve(searchPath, dirPath))}\n`
            }

            const childIndent = "  ".repeat(depth + 1)
            const children = Array.from(dirs)
              .filter((d) => d !== "." && path.dirname(d).replace(/\\/g, "/") === dirPath)
              .sort()

            for (const child of children) {
              output += renderDir(child, depth + 1)
            }

            if (!params.directoriesOnly) {
              const dirFiles = filesByDir.get(dirPath) || []
              for (const file of dirFiles.sort()) {
                output += `${childIndent}${withDate(file, path.resolve(searchPath, dirPath, file))}\n`
              }
            }

            return output
          }

          const output = `${searchPath}/\n` + renderDir(".", 0)

          return {
            title: path.relative(ins.worktree, searchPath),
            metadata: {
              count: files.length,
              truncated,
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
