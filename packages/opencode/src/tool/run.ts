import { Effect, Schema, Stream } from "effect"
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
import { Shell } from "@/shell/shell"
import { Config } from "@/config/config"
import { which } from "@/util/which"

const DEFAULT_TIMEOUT = 60_000

const Parameters = Schema.Struct({
  binary: Schema.String,
  args: Schema.Array(Schema.String),
  workdir: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  description: Schema.String,
  run_in_background: Schema.optional(Schema.Boolean),
})

interface Chunk { text: string; size: number }

function preview(text: string) {
  const limit = 1200
  return text.length > limit ? "..." + text.slice(-(limit - 3)) : text
}

function tail(raw: string, maxLines: number, maxBytes: number) {
  const lines = raw.split("\n")
  let cut = false
  if (lines.length > maxLines) { lines.splice(0, lines.length - maxLines); cut = true }
  let text = lines.join("\n")
  if (Buffer.byteLength(text, "utf-8") > maxBytes) { text = text.slice(-maxBytes); cut = true }
  return { text, cut }
}

function resolveBinary(name: string): string {
  if (name.includes("/") || name.includes("\\")) return name
  if (process.platform === "win32" && !name.endsWith(".exe")) {
    const exe = which(name + ".exe"); if (exe) return exe
  }
  return which(name) ?? name
}

export const RunTool = Tool.define("run",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const trunc = yield* Truncate.Service
    const config = yield* Config.Service
    const cfg = yield* config.get()

    const resolvePath = Effect.fn("RunTool.resolvePath")(function* (text: string, root: string, _shell: string) {
      if (process.platform === "win32") return AppFileSystem.normalizePath(path.resolve(root, AppFileSystem.windowsPath(text)))
      return path.resolve(root, text)
    })

    const run = Effect.fn("RunTool.run")(function* (
      input: { binary: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeout: number; description: string },
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
      const chunks: string[] = []
      let fullBytes = 0

      yield* ctx.metadata({ metadata: { output: "", description: input.description } })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          const resolved = resolveBinary(input.binary)
          const handle = yield* spawner.spawn(
            ChildProcess.make(resolved, input.args, { cwd: input.cwd, env: input.env, stdin: "ignore" }),
          )
          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
              const size = Buffer.byteLength(chunk, "utf-8")
              list.push({ text: chunk, size }); used += size
              while (used > keep && list.length > 1) { const item = list.shift(); if (!item) break; used -= item.size; cut = true }
              last = preview(last + chunk)
              if (file) sink?.write(chunk)
              else {
                chunks.push(chunk); fullBytes += Buffer.byteLength(chunk, "utf-8")
                if (fullBytes > limits.maxBytes)
                  return trunc.write(chunks.join("")).pipe(
                    Effect.andThen((next) => Effect.sync(() => { file = next; cut = true; sink = createWriteStream(next, { flags: "a" }); chunks.length = 0; fullBytes = 0 })),
                    Effect.andThen(ctx.metadata({ metadata: { output: last, description: input.description } })),
                  )
              }
              return Effect.void
            }),
          )
          return (yield* handle.exitCode) as number | null
        }),
      )
      if (file)
        yield* Effect.promise(() => new Promise<void>((resolve) => {
          let settled = false; const done = () => { if (!settled) { settled = true; resolve() } }
          sink?.end(() => done()); sink?.on("error", () => done())
        }))

      const raw = list.map((i) => i.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) file = yield* trunc.write(raw)

      let output = end.text; if (!output) output = "(no output)"
      if (cut && file) output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      return { title: input.description, metadata: { output: last || preview(output), exit: code, description: input.description, truncated: cut, ...(cut && file ? { outputPath: file } : {}) }, output }
    })

    const limits = yield* trunc.limits()
    const shell = Shell.acceptable(cfg.shell)

    return {
      description: DESCRIPTION.replaceAll("${maxLines}", String(limits.maxLines)).replaceAll("${maxBytes}", String(limits.maxBytes)),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const cwd = params.workdir ? yield* resolvePath(params.workdir, Instance.directory, shell) : Instance.directory
          if (params.timeout !== undefined && params.timeout < 0) throw new Error(`Invalid timeout: ${params.timeout}`)
          const timeout = params.timeout ?? DEFAULT_TIMEOUT
          if (params.run_in_background) {
            const jobs = yield* Effect.serviceOption(Jobs.Service)
            if (jobs._tag === "Some") {
              const jobID = yield* (jobs.value as any).startEffect({
                sessionID: ctx.sessionID, kind: "run", label: params.description || params.binary,
                run: Effect.gen(function* () { return (yield* run({ binary: params.binary, args: [...params.args], cwd, env: process.env, timeout, description: params.description }, ctx)).output }),
              })
              return { title: `Background run ${jobID}`, output: `Started background job ${jobID}. Use job_output to read.`, metadata: { jobID, output: "", exit: null, description: params.description, truncated: false } } as any
            }
          }
          return yield* run({ binary: params.binary, args: [...params.args], cwd, env: process.env, timeout, description: params.description }, ctx) as any
        }) as any,
    }
  }),
)
