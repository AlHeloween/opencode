import { Effect, Schema } from "effect"
import { forkDrainStdoutStderr } from "./shell-output"
import { createWriteStream } from "node:fs"
import path from "path"
import * as Tool from "./tool"
import DESCRIPTION from "./run.txt"
import { Instance } from "../project/instance"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ChildProcess } from "effect/unstable/process"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Truncate from "./truncate"
import { Jobs } from "@/jobs"
import { which } from "@/util/which"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "run-tool" })

const DEFAULT_TIMEOUT = 60_000

const Parameters = Schema.Struct({
  binary: Schema.String,
  args: Schema.Array(Schema.String),
  workdir: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  description: Schema.String,
  run_in_background: Schema.optional(Schema.Boolean),
})

interface Chunk {
  text: string
  size: number
}

function preview(text: string) {
  const limit = 1200
  return text.length > limit ? "..." + text.slice(-(limit - 3)) : text
}

function tail(raw: string, maxLines: number, maxBytes: number) {
  const lines = raw.split("\n")
  let cut = false
  if (lines.length > maxLines) {
    lines.splice(0, lines.length - maxLines)
    cut = true
  }
  let text = lines.join("\n")
  if (Buffer.byteLength(text, "utf-8") > maxBytes) {
    text = text.slice(-maxBytes)
    cut = true
  }
  return { text, cut }
}

function resolveBinary(name: string): string {
  if (name.includes("/") || name.includes("\\")) return name
  if (process.platform === "win32" && !name.endsWith(".exe")) {
    const exe = which(name + ".exe")
    if (exe) return exe
  }
  return which(name) ?? name
}

export const RunTool = Tool.define(
  "run",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const trunc = yield* Truncate.Service

    const resolvePath = Effect.fn("RunTool.resolvePath")(function* (text: string, root: string) {
      const platform = process.platform

      // Normalize a candidate path for comparison: project-relative → absolute + symlink-resolved
      const normalize = (t: string) => {
        if (platform === "win32")
          return AppFileSystem.normalizePath(path.resolve(root, AppFileSystem.windowsPath(t)))
        return path.resolve(root, t)
      }

      const pathExists = (p: string) =>
        Effect.service(AppFileSystem.Service).pipe(
          Effect.flatMap((fs) => fs.existsSafe(p)),
          Effect.orElseSucceed(() => false),
        )

      // --- Stage 1: Direct resolution (current behavior) ---
      const resolved = normalize(text)
      if (yield* pathExists(resolved)) return resolved

      // --- Stage 2: Windows drive-letter shorthand ---
      // "D" when root is D:\... should resolve to root itself, not root\D
      if (platform === "win32" && /^[A-Za-z]$/.test(text)) {
        const driveRoot = path.resolve(text + ":\\")
        if (driveRoot.slice(0, 2).toLowerCase() === root.slice(0, 2).toLowerCase()) {
          Log.Default.debug("resolvePath: drive-letter shorthand matched", { text, root })
          return root
        }
      }

      // --- Stage 3: Basename / substring match against root ---
      // "opencode" or "zPython" → D:\zPython\opencode
      const rootLower = root.toLowerCase()
      const textLower = text.toLowerCase()
      const rootBasename = path.basename(root)
      if (
        rootBasename.toLowerCase() === textLower ||
        rootLower.endsWith(textLower) ||
        textLower.endsWith(rootLower)
      ) {
        Log.Default.debug("resolvePath: basename/substring match", { text, root })
        return root
      }

      // --- Stage 4: Try as an absolute path ---
      // User may have passed a partial absolute path (e.g. "D:\zPy")
      if (platform === "win32") {
        const winNormalized = AppFileSystem.normalizePath(AppFileSystem.windowsPath(text))
        if (winNormalized !== resolved && (yield* pathExists(winNormalized))) {
          Log.Default.debug("resolvePath: Windows absolute match", { text, winNormalized })
          return winNormalized
        }
      }

      // --- Stage 5: Fallback ---
      // Use resolved path even if it doesn't exist — caller may be creating a new directory
      Log.Default.debug("resolvePath: fallback — path does not exist", { text, resolved })
      return resolved
    })

    const run = Effect.fn("RunTool.run")(function* (
      input: {
        binary: string
        args: string[]
        cwd: string
        env: NodeJS.ProcessEnv
        timeout: number
        description: string
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      let last = ""
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let interrupted = false
      const chunks: string[] = []
      let fullBytes = 0

      yield* ctx.metadata({ output: "", metadata: { output: "", description: input.description } })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          const resolved = resolveBinary(input.binary)
          const handle = yield* spawner.spawn(
            ChildProcess.make(resolved, input.args, { cwd: input.cwd, env: input.env, stdin: "ignore" }),
          )
          const onChunk = (chunk: string) => {
            const size = Buffer.byteLength(chunk, "utf-8")
            list.push({ text: chunk, size })
            used += size
            while (used > keep && list.length > 1) {
              const item = list.shift()
              if (!item) break
              used -= item.size
              cut = true
            }
            last = preview(last + chunk)
            if (file) {
              sink?.write(chunk)
              return ctx.metadata({
                metadata: { output: last, description: input.description },
              })
            }
            chunks.push(chunk)
            fullBytes += Buffer.byteLength(chunk, "utf-8")
            if (fullBytes > limits.maxBytes)
              return trunc.write(chunks.join("")).pipe(
                Effect.andThen((next) =>
                  Effect.sync(() => {
                    file = next
                    cut = true
                    sink = createWriteStream(next, { flags: "a" })
                    chunks.length = 0
                    fullBytes = 0
                  }),
                ),
                Effect.andThen(
                  ctx.metadata({
                    output: last,
                    metadata: { output: last, description: input.description },
                  }),
                ),
              )
            return ctx.metadata({
              metadata: { output: last, description: input.description },
            })
          }
          const awaitDrain = yield* forkDrainStdoutStderr(handle, onChunk)
          const abort = Effect.callback<void>((resume) => {
            // Only react to abort events that fire DURING execution.
            // A pre-aborted signal (stale from a previous tool call or
            // LLM completion) must NOT cancel the current command — let
            // the process exit (or timeout) win the race naturally.
            if (ctx.abort.aborted) return Effect.void
            const handler = () => resume(Effect.void)
            ctx.abort.addEventListener("abort", handler, { once: true })
            return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
          })

          // Race: process exit vs user abort only — NO hard timeout.

          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
            abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
          ])

          if (exit.kind === "abort") {
            interrupted = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }

          yield* awaitDrain
          return exit.kind === "exit" ? exit.code : null
        }),
      )
      if (file)
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              let settled = false
              const done = () => {
                if (!settled) {
                  settled = true
                  resolve()
                }
              }
              sink?.end(() => done())
              sink?.on("error", (e) => {
                log.debug("run output sink error", { error: String(e) })
                done()
              })
            }),
        )

      const raw = list.map((i) => i.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) file = yield* trunc.write(raw)

      let output = end.text
      if (interrupted) output = `Command interrupted (abort signal received)\n` + output
      if (!output) output = "(no output)"
      if (cut && file) output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      return {
        title: input.description,
        metadata: {
          output: last || preview(output),
          exit: code,
          description: input.description,
          truncated: cut,
          ...(cut && file ? { outputPath: file } : {}),
        },
        output,
      }
    })

    return {
      description: DESCRIPTION.replaceAll("${maxLines}", String(Truncate.MAX_LINES)).replaceAll(
        "${maxBytes}",
        String(Truncate.MAX_BYTES),
      ),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const cwd = params.workdir ? yield* resolvePath(params.workdir, Instance.directory) : Instance.directory
          if (params.timeout !== undefined && params.timeout < 0) throw new Error(`Invalid timeout: ${params.timeout}`)
          const timeout = params.timeout ?? DEFAULT_TIMEOUT

          // Permission: dedicated "run" key (binary exec, not a shell).
          if (!Instance.containsPath(cwd)) {
            const globs = [path.join(cwd, "*")]
            yield* ctx.ask({
              permission: "external_directory",
              patterns: globs,
              always: globs,
              metadata: {},
            })
          }
          const binary = params.binary
          const pattern = [binary, ...params.args].join(" ").slice(0, 200)
          yield* ctx.ask({
            permission: "run",
            patterns: [pattern, binary, `${binary} *`],
            always: [binary, `${binary} *`],
            metadata: {
              binary,
              args: params.args.slice(0, 20),
              description: params.description,
            },
          })

          if (params.run_in_background) {
            const jobs = yield* Effect.serviceOption(Jobs.Service)
            if (jobs._tag === "Some") {
              const jobID = yield* (jobs.value as any).startEffect({
                sessionID: ctx.sessionID,
                kind: "run",
                label: params.description || params.binary,
                run: Effect.gen(function* () {
                  return (yield* run(
                    {
                      binary: params.binary,
                      args: [...params.args],
                      cwd,
                      env: process.env,
                      timeout,
                      description: params.description,
                    },
                    ctx,
                  )).output
                }),
              })
              return {
                title: `Background run ${jobID}`,
                output: `Started background job ${jobID}. Use job_output to read.`,
                metadata: { jobID, output: "", exit: null, description: params.description, truncated: false },
              } as any
            }
          }
          return yield* run(
            {
              binary: params.binary,
              args: [...params.args],
              cwd,
              env: process.env,
              timeout,
              description: params.description,
            },
            ctx,
          ) as any
        }) as any,
    }
  }),
)
