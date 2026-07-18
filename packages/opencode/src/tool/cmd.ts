import { Schema } from "effect"
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import DESCRIPTION from "./cmd.txt"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { readWasmAsset } from "@/util/wasm-path"
import { Language, type Node } from "web-tree-sitter"

import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { Flag } from "@opencode-ai/core/flag/flag"

import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { Effect } from "effect"
import { forkDrainStdoutStderr } from "./shell-output"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Jobs } from "@/jobs"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 60 * 1000
const CWD = new Set(["cd", "pushd", "popd"])

// Known-safe read-only cmd commands that never trigger permission scanning.
const SAFE = new Set([
  "cls",
  "color",
  "dir",
  "echo",
  "find",
  "findstr",
  "help",
  "more",
  "path",
  "prompt",
  "sort",
  "title",
  "tree",
  "type",
  "ver",
  "vol",
])

// Filesystem-affecting cmd commands that need path scanning.
const FILES = new Set([
  ...CWD,
  "attrib",
  "copy",
  "del",
  "erase",
  "expand",
  "icacls",
  "mkdir",
  "mklink",
  "move",
  "openfiles",
  "rd",
  "rename",
  "ren",
  "replace",
  "rmdir",
  "takeown",
  "xcopy",
  "robocopy",
])

const POWERSHELL_SAFE = new Set(["get-location", "write-host", "write-output"])
const POWERSHELL_FILES = new Set([
  "add-content",
  "copy-item",
  "get-content",
  "move-item",
  "new-item",
  "pop-location",
  "push-location",
  "remove-item",
  "rename-item",
  "set-content",
  "set-location",
])

interface Part {
  type: string
  text: string
}

interface Scan {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

interface Chunk {
  text: string
  size: number
}

export const log = Log.create({ service: "cmd-tool" })

// --- Batch grammar AST helpers ---

function parts(node: Node, ps: boolean): Part[] {
  const out: Part[] = []
  if (ps) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === "command_elements") {
        for (let j = 0; j < child.childCount; j++) {
          const item = child.child(j)
          if (!item || item.type === "redirection" || item.type === "command_argument_sep") continue
          out.push({ type: item.type, text: item.text })
        }
        continue
      }
      if (child.type === "command_name" || child.type === "command_name_expr") {
        out.push({ type: child.type, text: child.text })
      }
    }
    return out
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_name") {
      out.push({ type: child.type, text: child.text })
      continue
    }
    if (child.type !== "argument_list") continue
    for (let j = 0; j < child.childCount; j++) {
      const item = child.child(j)
      if (!item || item.type === "line_continuation") continue
      if (item.type === "command_option" || item.type === "argument_value" || item.type === "string") {
        out.push({ type: item.type, text: item.text })
        continue
      }
      out.push({ type: item.type, text: item.text })
    }
  }
  return out
}

function source(node: Node, ps: boolean): string {
  if (ps) {
    return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
  }
  return (node.parent?.type === "redirect_stmt" ? node.parent.text : node.text).trim()
}

function commands(node: Node, ps: boolean): Node[] {
  return node.descendantsOfType(ps ? "command" : "cmd").filter((child): child is Node => Boolean(child))
}

function hasRedirection(node: Node, ps: boolean): boolean {
  if (ps) return node.descendantsOfType("redirection").length > 0
  return node.descendantsOfType("redirection").length > 0 || node.descendantsOfType("redirect_stmt").length > 0
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return { text, cut: false }
  }
  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
        out.unshift(buf.subarray(start).toString("utf-8"))
      }
      break
    }
    out.unshift(lines[i])
    bytes += size
  }
  return { text: out.join("\n"), cut: true }
}

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "The command to execute" }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in milliseconds" }),
  workdir: Schema.optional(Schema.String).annotate({
    description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
  }),
  description: Schema.String.annotate({
    description: "Clear, concise description of what this command does in 5-10 words.",
  }),
  run_in_background: Schema.optional(Schema.Boolean).annotate({
    description: "Run the command in the background as a tracked job.",
  }),
})

function pathArgs(list: Part[]): string[] {
  return list
    .slice(1)
    .filter((item) => !item.text.startsWith("-") && !item.text.startsWith("/"))
    .map((item) => {
      const text = item.text
      if (text.length >= 2 && text[0] === text.at(-1) && (text[0] === '"' || text[0] === "'")) {
        return text.slice(1, -1)
      }
      return text
    })
}

// Detect if a cmd.exe command is actually a PowerShell invocation.
// When running through cmd.exe, `powershell -Command "..."` and `pwsh -Command "..."`
// should be parsed with the PowerShell grammar for correct AST traversal.
function isPowerShellCommand(command: string): boolean {
  const executable = command
    .trim()
    .match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/)
    ?.slice(1)
    .find(Boolean)
  if (!executable) return false
  return /^(powershell|pwsh)(\.exe)?$/i.test(path.win32.basename(executable))
}

function powerShellScript(command: string) {
  if (!isPowerShellCommand(command)) return
  const match = command.trim().match(/^(?:"[^"]+"|'[^']+'|\S+)[\s\S]*?\s-(?:command|c)\s+([\s\S]+)$/i)
  if (!match) return
  const script = match[1].trim()
  if (script.length >= 2 && script[0] === script.at(-1) && (script[0] === '"' || script[0] === "'")) {
    return script.slice(1, -1)
  }
  return script
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const treeWasm = await readWasmAsset("web-tree-sitter.wasm")
  if (!treeWasm.bytes) {
    throw new Error("tree-sitter runtime WASM unavailable; tried: " + JSON.stringify(treeWasm.tried))
  }
  await (Parser.init as any)({
    wasmBinary: treeWasm.bytes,
  })
  const [batchWasm, psWasm] = await Promise.all([
    readWasmAsset("grammars/tree-sitter-batch.wasm"),
    readWasmAsset("grammars/tree-sitter-powershell.wasm"),
  ])
  if (!batchWasm.bytes) throw new Error("batch grammar WASM unavailable; tried: " + JSON.stringify(batchWasm.tried))
  if (!psWasm.bytes) throw new Error("PowerShell grammar WASM unavailable; tried: " + JSON.stringify(psWasm.tried))
  const [batchLanguage, psLanguage] = await Promise.all([
    Language.load(new Uint8Array(batchWasm.bytes)),
    Language.load(new Uint8Array(psWasm.bytes)),
  ])
  const batch = new Parser()
  batch.setLanguage(batchLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { batch, ps }
})

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  // Use cmd /c directly (no shell mode) to avoid Node.js escaping inner
  // quotes with \" — cmd.exe does not understand \" escaping and breaks
  // on paths with spaces like "C:\Program Files\...".
  // CrossSpawnSpawner auto-detects cmd.exe and sets windowsVerbatimArguments.
  return ChildProcess.make(shell, ["/c", command], {
    cwd,
    env,
    stdin: "ignore",
    detached: false,
  })
}

export const CmdTool = Tool.define(
  "cmd",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const fs = yield* AppFileSystem.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service

    const resolvePath = Effect.fn("CmdTool.resolvePath")(function* (text: string, root: string) {
      const file = AppFileSystem.windowsPath(text)
      return AppFileSystem.normalizePath(path.resolve(root, /^[A-Za-z]:(?![\\/])/.test(file) ? file.slice(2) : file))
    })

    const argPath = Effect.fn("CmdTool.argPath")(function* (arg: string, cwd: string) {
      const text = home(arg)
      if (!text) return undefined
      return yield* resolvePath(text, cwd)
    })

    const validatePaths = Effect.fn("CmdTool.validatePaths")(function* (paths: string[], worktree: string) {
      const issues: string[] = []
      for (const p of paths) {
        if (/^[A-Za-z]:[\\\/][A-Za-z]:/.test(p)) {
          issues.push(`"${p}" — invalid: double drive letter`)
          continue
        }
        if (/^(C:\\Windows)(\\|\/|$)/i.test(p)) {
          issues.push(`"${p}" — blocked: system directory`)
          continue
        }
        if (/[\\/]\.git([\\/]|$)/.test(p)) {
          issues.push(`"${p}" — blocked: .git directory`)
          continue
        }
        if (!p.includes("*") && !p.includes("?")) {
          try {
            const resolved = path.isAbsolute(p) ? p : path.resolve(worktree, p)
            if (!require("fs").existsSync(resolved)) {
              issues.push(`"${p}" — path does not exist`)
            }
          } catch (error) {
            log.debug("failed to validate command path", { path: p, error })
          }
        }
      }
      if (issues.length === 0) return undefined
      return `⚠ Path issues detected:\n${issues.map((i, n) => `  ${n + 1}. ${i}`).join("\n")}`
    })

    const collect = Effect.fn("CmdTool.collect")(function* (root: Node, cwd: string, ps: boolean) {
      const scan: Scan = { dirs: new Set<string>(), patterns: new Set<string>(), always: new Set<string>() }
      for (const node of commands(root, ps)) {
        const command = parts(node, ps)
        const tokens = command.map((item) => item.text)
        const cmdName = tokens[0]?.toLowerCase()
        const safe = ps ? POWERSHELL_SAFE : SAFE
        const files = ps ? POWERSHELL_FILES : FILES
        if (cmdName && safe.has(cmdName) && !hasRedirection(node, ps)) continue
        if (cmdName && files.has(cmdName)) {
          for (const arg of pathArgs(command)) {
            const resolved = yield* argPath(arg, cwd)
            if (!resolved || Instance.containsPath(resolved)) continue
            if (!(yield* fs.existsSafe(resolved))) continue
            const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
            scan.dirs.add(dir)
          }
        }
        if (tokens.length && (!cmdName || !CWD.has(cmdName))) {
          scan.patterns.add(source(node, ps))
          scan.always.add(cmdName ? `${cmdName} *` : source(node, ps))
        }
      }
      return scan
    })

    const ask = Effect.fn("CmdTool.ask")(function* (ctx: Tool.Context, scan: Scan) {
      if (scan.dirs.size > 0) {
        const globs = Array.from(scan.dirs).map((dir) => path.join(dir, "*"))
        yield* ctx.ask({ permission: "external_directory", patterns: globs, always: globs, metadata: {} })
      }
      if (scan.patterns.size === 0) return
      // Dedicated "cmd" permission (not bash) so shell policies can be separated.
      yield* ctx.ask({
        permission: "cmd",
        patterns: Array.from(scan.patterns),
        always: Array.from(scan.always),
        metadata: { shell: "cmd", permission: "cmd" },
      })
    })

    const shellEnv = Effect.fn("CmdTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      return {
        ...process.env,
        ...extra.env,
      }
    })

    const run = Effect.fn("CmdTool.run")(function* (
      input: {
        shell: string
        command: string
        cwd: string
        env: NodeJS.ProcessEnv
        timeout: number
        description: string
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      const chunks: string[] = []
      let fullBytes = 0
      let last = ""
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false

      yield* ctx.metadata({ metadata: { output: "", description: input.description } })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env))

          // Drain stdout and stderr on separate fibers (TS/compilers write to stderr).
          // Always await both before leaving scope — see shell-output.ts.
          // Agents should still use `2>&1` when piping into parsers that only read stdin/stdout.
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
              return ctx.metadata({ metadata: { output: last, description: input.description } })
            }
            chunks.push(chunk)
            fullBytes += Buffer.byteLength(chunk, "utf-8")
            if (fullBytes > limits.maxBytes) {
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
                Effect.andThen(ctx.metadata({ metadata: { output: last, description: input.description } })),
              )
            }
            return ctx.metadata({ metadata: { output: last, description: input.description } })
          }
          const awaitDrain = yield* forkDrainStdoutStderr(handle, onChunk)

          const abort = Effect.callback<void>((resume) => {
            if (ctx.abort.aborted) return resume(Effect.void)
            const handler = () => resume(Effect.void)
            ctx.abort.addEventListener("abort", handler, { once: true })
            return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
          })

          const timeout = Effect.sleep(`${input.timeout + 100} millis`)

          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
            abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
            timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
          ])

          if (exit.kind === "abort") {
            aborted = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          if (exit.kind === "timeout") {
            expired = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          yield* awaitDrain
          return exit.kind === "exit" ? exit.code : null
        }),
      ).pipe(Effect.orDie)

      const meta: string[] = []
      if (expired)
        meta.push(
          `cmd tool terminated command after exceeding timeout ${input.timeout} ms. If this command is waiting for interactive keyboard input, run it through cmd_runner instead.`,
        )
      if (aborted) meta.push("User aborted the command")
      const raw = list.map((item) => item.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) file = yield* trunc.write(raw)
      let output = end.text
      if (!output) output = "(no output)"
      if (cut && file) output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      if (meta.length > 0) output += "\n\n<cmd_metadata>\n" + meta.join("\n") + "\n</cmd_metadata>"
      if (sink) {
        const stream = sink
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
              stream.end(() => done())
              stream.on("error", () => done())
            }),
        )
      }
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
      description: DESCRIPTION.replaceAll("${os}", process.platform)
        .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
        .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const cwd = params.workdir ? yield* resolvePath(params.workdir, Instance.directory) : Instance.directory
          if (params.timeout !== undefined && params.timeout < 0) {
            throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
          }
          const CMD_RUNNER_TIMEOUT = 10 * 60 * 1000
          const ADM_TIMEOUT = 3 * 60 * 1000
          const isCmdRunner = /\bcmd_runner(?:\.exe)?\b/i.test(params.command)
          const isAdm = /\badm(?:\.exe)?\b|python(?:3)?(?:\.exe)? -m adm\b/i.test(params.command)
          const timeout = params.timeout ?? (isCmdRunner ? CMD_RUNNER_TIMEOUT : isAdm ? ADM_TIMEOUT : DEFAULT_TIMEOUT)
          const shell = process.env.COMSPEC || "cmd.exe"

          const p = yield* Effect.promise(() => parser())
          const script = powerShellScript(params.command)
          const ps = script !== undefined
          const engine = ps ? p.ps : p.batch
          const tree = engine.parse(script ?? params.command)
          if (!tree) throw new Error("Failed to parse command")
          const root = tree.rootNode
          const scan = yield* collect(root, cwd, ps)
          if (!Instance.containsPath(cwd)) scan.dirs.add(cwd)

          const allPaths = Array.from(scan.dirs)
          const pathWarnings = yield* validatePaths(allPaths, Instance.worktree)
          yield* ask(ctx, scan)
          const env = yield* shellEnv(ctx, cwd)

          if (params.run_in_background) {
            const jobSvc = yield* Effect.serviceOption(Jobs.Service)
            if (jobSvc._tag === "None") {
              return yield* run(
                { shell, command: params.command, cwd, env, timeout, description: params.description },
                ctx,
              )
            }
            const jobID = yield* jobSvc.value.startEffect({
              sessionID: ctx.sessionID,
              kind: "bash" as any,
              label: params.description || params.command.slice(0, 80),
              run: Effect.gen(function* () {
                const result = yield* run(
                  { shell, command: params.command, cwd, env, timeout, description: params.description },
                  ctx,
                )
                return result.output
              }),
            })
            return {
              title: `Background cmd ${jobID}`,
              output: `Started background job ${jobID} (${params.description || params.command.slice(0, 80)}). Use job_output to read its output, or job_wait to wait for completion.`,
              metadata: {
                jobID,
                output: "",
                exit: null as number | null,
                description: params.description || params.command.slice(0, 80),
                truncated: false,
              },
            } as any
          }

          const result = yield* run(
            { shell, command: params.command, cwd, env, timeout, description: params.description },
            ctx,
          )
          if (pathWarnings) result.output = `${pathWarnings}\n\n${result.output}`
          return result
        }),
    }
  }),
)
