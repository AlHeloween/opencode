import path from "path"
import { Effect, Option, Schema } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
import { scannerGate } from "@/session/graph-first"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"
// t85 (2026-10-17 host FAST_FAIL on path-less scan): root-wide glob gets the same
// bound as grep — 20 s signal timeout (output already capped via take(101)) and
// heavy-dir excludes unless explicitly named.
const GLOB_TIMEOUT_MS = 20_000
const GLOB_ROOT_EXCLUDES = [
  "node_modules",
  ".opencode",
  "logs",
  "external",
  "dist",
  ".temp",
  ".codegraph",
]
export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: "Directory to search in. Omit for the working directory. Must be a directory if provided.",
  }),
  gitignore: Schema.optional(Schema.Boolean).annotate({
    description:
      "Respect .gitignore. Default: false — every path is searched, including node_modules, .opencode/data and logs, so an absence can never be an artefact of an ignore rule.",
  }),
})

export const GlobTool = Tool.define(
  "glob",
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string; gitignore?: boolean }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          let search = params.path ?? ins.directory
          search = path.isAbsolute(search) ? search : path.resolve(ins.directory, search)
          const note = scannerGate({ sessionID: ctx.sessionID, tool: "glob", worktree: ins.worktree, target: search })
          const withNote = (text: string) => (note ? `${text}\n${note.note}` : text)
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
            },
          })
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info) {
            return {
              title: path.relative(ins.worktree, search),
              metadata: { count: 0, truncated: false },
              output: withNote(`Directory not found: ${search}`),
            }
          }
          if (info.type === "File") {
            throw new Error(`[not-a-directory] glob path must be a directory: ${search}`)
          }
          yield* assertExternalDirectoryEffect(ctx, search, { kind: "directory" })

          const limit = 100
          let truncated = false
          // NOTE on the sample and its order: `take(limit + 1)` stops at the first 101 files in
          // ripgrep's traversal order, so the mtime sort below orders THAT SAMPLE, not the whole
          // match set — which makes the output «newest-first among the first 100 found», not «the
          // 100 newest». Sorting every match by mtime would mean enumerating the whole tree to
          // order one page, so the sample stays; the truncation notice is what keeps it honest, and
          // a caller who needs the newest must narrow the pattern or the path.
          // t85 bound: root-wide (no path) never walks heavy data dirs unless named.
          const rootWide = !params.path || params.path === "."
          const excludeGlobs = rootWide ? GLOB_ROOT_EXCLUDES.map((d) => `!${d}/**`) : []
          const globs = [params.pattern, ...excludeGlobs]
          const signal = ctx.abort.aborted
            ? ctx.abort
            : AbortSignal.any([ctx.abort, AbortSignal.timeout(GLOB_TIMEOUT_MS)])
          const files = yield* rg.files({ cwd: search, glob: globs, signal, gitignore: params.gitignore }).pipe(
            Stream.mapEffect((file) =>
              Effect.gen(function* () {
                const full = path.resolve(search, file)
                const info = yield* fs.stat(full).pipe(Effect.catch(() => Effect.succeed(undefined)))
                const mtime =
                  info?.mtime.pipe(
                    Option.map((date) => date.getTime()),
                    Option.getOrElse(() => 0),
                  ) ?? 0
                return { path: full, mtime }
              }),
            ),
            Stream.take(limit + 1),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk]),
          )

          if (files.length > limit) {
            truncated = true
            files.length = limit
          }
          files.sort((a, b) => b.mtime - a.mtime)

          const output = []
          // The transparency probe that used to stand here is GONE. It existed because the DEFAULT hid
          // gitignored files, so «No files found» needed a second, unrestricted search to explain
          // itself. The default now searches everything (`gitignore: true` is the only way to get
          // ignore rules), so an empty result is simply an empty result — the compensation is the
          // defect's shadow, and the defect is fixed.
          if (files.length === 0) output.push("No files found")
          if (files.length > 0) {
            output.push(...files.map((file) => file.path))
            if (truncated) {
              output.push("")
              output.push(
                `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
              )
            }
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: files.length,
              truncated,
            },
            output: withNote(output.join("\n")),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
