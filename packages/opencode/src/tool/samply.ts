import { Effect, Schema } from "effect"
import path from "path"
import { spawn } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import { Global } from "@opencode-ai/core/global"
import * as Tool from "./tool"
import DESCRIPTION from "./samply.txt"
import { Instance } from "../project/instance"
import { resolveOwnTool } from "@/util/own-tool"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tool.samply" })

const BINARY = process.platform === "win32" ? "samply.exe" : "samply"

/** Beside the exe (`tools/`) first, then `{worktree}/bin/tools` → `Global.Path.bin` → PATH — see `resolveOwnTool`. */
export function resolveSamplyBinary(): string {
  return resolveOwnTool({ binary: BINARY, subdir: "tools", worktree: Instance.worktree })
}

export const Parameters = Schema.Struct({
  command: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Command to profile, as an argv array (`samply record -- <command...>`). Exactly one of `command`, `pid`, `all` must be given.",
  }),
  pid: Schema.optional(Schema.Number).annotate({
    description: "Attach to an existing process by PID instead of launching a command (record -p PID).",
  }),
  all: Schema.optional(Schema.Boolean).annotate({
    description: "Record all processes (record -a; Windows). Conflicts with `command` and `pid`.",
  }),
  output: Schema.optional(Schema.String).annotate({
    description: "Absolute profile file path; default {data}/samply/profile-<timestamp>.jslb.gz.",
  }),
  rate: Schema.optional(Schema.Number).annotate({
    description: "Sampling rate in Hz (samply default: 1000).",
  }),
  duration: Schema.optional(Schema.Number).annotate({
    description: "Limit the recording to this many seconds.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Milliseconds before the whole record call is killed; default: wait for the command to finish.",
  }),
})

/** Exported for tests: default profile path in the runtime data dir. */
export function defaultSamplyOutput(dataDir: string, now: number = Date.now()): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-")
  return path.join(dataDir, "samply", `profile-${stamp}.jslb.gz`)
}

/** Exported for tests: the `samply record` argv for one call (invariant: --save-only, never a server). */
export function buildSamplyArgs(input: {
  output: string
  command?: readonly string[]
  pid?: number
  all?: boolean
  rate?: number
  duration?: number
}): string[] {
  const args = ["record", "--save-only", "-o", input.output]
  if (input.rate !== undefined) args.push("--rate", String(input.rate))
  if (input.duration !== undefined) args.push("--duration", String(input.duration))
  if (input.pid !== undefined) args.push("-p", String(input.pid))
  else if (input.all === true) args.push("-a")
  else args.push("--", ...(input.command ?? []))
  return args
}

type SamplyRun = { code: number; out: string; err: string; killed: boolean }

function runSamply(bin: string, args: string[], cwd: string, timeout?: number): Effect.Effect<SamplyRun, Error> {
  return Effect.tryPromise({
    try: () =>
      new Promise<SamplyRun>((resolve, reject) => {
        const child = spawn(bin, args, { windowsHide: true, cwd })
        let out = ""
        let err = ""
        let killed = false
        const timer =
          timeout !== undefined && timeout > 0
            ? setTimeout(() => {
                killed = true
                child.kill()
              }, timeout)
            : undefined
        child.stdout.on("data", (d: Buffer) => (out += d.toString()))
        child.stderr.on("data", (d: Buffer) => (err += d.toString()))
        child.on("error", reject)
        child.on("close", (code) => {
          if (timer) clearTimeout(timer)
          resolve({ code: code ?? -1, out, err, killed })
        })
      }),
    catch: (e) => new Error(`samply spawn failed: ${String(e)}`),
  })
}

export const SamplyTool = Tool.define(
  "samply",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const modes = [
            params.command !== undefined && params.command.length > 0,
            params.pid !== undefined,
            params.all === true,
          ].filter(Boolean).length
          if (modes !== 1) throw new Error("samply: pass exactly one of `command`, `pid`, or `all`")

          const output = params.output ?? defaultSamplyOutput(Global.Path.data)
          if (!path.isAbsolute(output)) throw new Error(`samply: output must be an absolute path (got ${output})`)
          yield* Effect.promise(() => mkdir(path.dirname(output), { recursive: true }))

          const pattern = params.command?.length
            ? params.command.join(" ")
            : params.pid !== undefined
              ? `pid ${params.pid}`
              : "all processes"
          yield* ctx.ask({
            permission: "samply",
            patterns: [pattern.slice(0, 200)],
            always: [pattern.slice(0, 200)],
            metadata: {
              profile: output,
              mode: params.pid !== undefined ? "pid" : params.all === true ? "all" : "command",
              command: params.command?.slice(0, 20),
              pid: params.pid,
            },
          })

          const bin = resolveSamplyBinary()
          const args = buildSamplyArgs({
            output,
            command: params.command,
            pid: params.pid,
            all: params.all,
            rate: params.rate,
            duration: params.duration,
          })
          log.info("samply record", { bin, args: args.slice(0, 8) })

          const result = yield* runSamply(bin, args, Instance.directory, params.timeout)
          const bytes = yield* Effect.promise(() =>
            stat(output)
              .then((s) => s.size)
              .catch(() => undefined),
          )

          const lines = [
            `samply record exit=${result.code}${result.killed ? " (killed by timeout)" : ""}`,
            `profile: ${output}${bytes !== undefined ? ` (${bytes} bytes)` : " (not written)"}`,
            `inspect with: samply load ${output}`,
          ]
          const errTail = result.err.trim().split("\n").slice(-12).join("\n")
          if (errTail) lines.push("", "stderr:", errTail)
          const outTail = result.out.trim().split("\n").slice(-6).join("\n")
          if (outTail) lines.push("", "stdout:", outTail)

          return {
            title:
              params.pid !== undefined
                ? `samply record -p ${params.pid}`
                : params.all === true
                  ? "samply record -a"
                  : `samply record ${(params.command ?? []).join(" ")}`.slice(0, 90),
            metadata: {
              exit: result.code,
              killed: result.killed,
              profile: output,
              bytes: bytes ?? null,
            },
            output: lines.join("\n"),
          }
        }) as any,
    }
  }),
)
