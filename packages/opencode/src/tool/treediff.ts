import * as Tool from "./tool"
import DESCRIPTION from "./treediff.txt"
import { assertExternalDirectoryEffect } from "./external-directory"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Option, Schema } from "effect"
import path from "path"

const modes = ["names", "numstat", "patch"] as const
const log = Log.create({ service: "tool.treediff" })

export const Parameters = Schema.Struct({
  pathA: Schema.String.annotate({ description: "First directory tree" }),
  pathB: Schema.String.annotate({ description: "Second directory tree" }),
  mode: Schema.optional(Schema.Literals(modes)).annotate({
    description: "names: changed paths and statuses; numstat: added/deleted counts; patch: unified content diff. Default: names.",
  }),
  context: Schema.optional(Schema.Number).annotate({
    description: "Unified-diff context lines for patch mode (0-100). Default: 3.",
  }),
})

export type TreeDiffMode = (typeof modes)[number]

export function gitNoIndexArgs(input: { pathA: string; pathB: string; mode?: TreeDiffMode; context?: number }) {
  const mode = input.mode ?? "names"
  const context = Math.max(0, Math.min(100, Math.floor(input.context ?? 3)))
  const format = mode === "names" ? ["--name-status"] : mode === "numstat" ? ["--numstat"] : [`--unified=${context}`]
  return ["diff", "--no-index", "--no-ext-diff", "--no-textconv", ...format, "--", input.pathA, input.pathB]
}

export async function diffTrees(input: { pathA: string; pathB: string; mode?: TreeDiffMode; context?: number }) {
  const proc = Bun.spawn(["git", ...gitNoIndexArgs(input)], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`git diff --no-index failed (exit ${exitCode}): ${(stderr || stdout).trim()}`)
  }
  return { different: exitCode === 1, output: stdout.trim(), warning: stderr.trim() || undefined }
}

export const TreeDiffTool = Tool.define(
  "treediff",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const pathA = path.isAbsolute(params.pathA) ? params.pathA : path.resolve(ins.directory, params.pathA)
          const pathB = path.isAbsolute(params.pathB) ? params.pathB : path.resolve(ins.directory, params.pathB)
          const [statA, statB] = yield* Effect.all([
            fs.stat(pathA).pipe(Effect.option),
            fs.stat(pathB).pipe(Effect.option),
          ])
          const invalid = [
            Option.isNone(statA) ? `directory not found: ${pathA}` : statA.value.type !== "Directory" ? `not a directory: ${pathA}` : undefined,
            Option.isNone(statB) ? `directory not found: ${pathB}` : statB.value.type !== "Directory" ? `not a directory: ${pathB}` : undefined,
          ].filter((value): value is string => !!value)
          if (invalid.length > 0) {
            const detail = invalid.join("; ")
            yield* Effect.sync(() => log.debug("tree diff invalid input", { pathA, pathB, detail }))
            return {
              title: "tree diff failed",
              output: `tree diff failed: ${detail}`,
              metadata: { different: false, mode: params.mode ?? "names", error: detail },
            }
          }
          yield* assertExternalDirectoryEffect(ctx, pathA, { kind: "directory" })
          yield* assertExternalDirectoryEffect(ctx, pathB, { kind: "directory" })
          yield* ctx.ask({
            permission: "list",
            patterns: [pathA, pathB],
            always: ["*"],
            metadata: { pathA, pathB, mode: params.mode ?? "names" },
          })
          const result = yield* Effect.tryPromise({
            try: () => diffTrees({ pathA, pathB, mode: params.mode, context: params.context }),
            catch: (error) => new Error("tree diff failed", { cause: error }),
          }).pipe(
            Effect.map((value) => ({ ...value, error: undefined })),
            Effect.catch((error) =>
              Effect.sync(() => {
                const detail = error.message
                log.warn("tree diff failed", { pathA, pathB, error: detail })
                return { different: false, output: `tree diff failed: ${detail}`, warning: undefined, error: detail }
              }),
            ),
          )
          return {
            title: `tree diff: ${path.basename(pathA)} ↔ ${path.basename(pathB)}`,
            output: result.output || "No differences.",
            metadata: { different: result.different, mode: params.mode ?? "names", ...(result.warning && { warning: result.warning }), ...(result.error && { error: result.error }) },
          }
        }),
    }
  }),
  "treediff",
)
