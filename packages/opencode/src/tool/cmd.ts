import { Schema } from "effect"
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import DESCRIPTION from "./cmd.txt"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "../project/instance"
import { type Node } from "web-tree-sitter"

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
import {
  autoWrapCmdRunner,
  enforceBinaryViaCmdRunner,
  enforceBrutalDestructiveOnly,
  enforceDestructiveShellFromAst,
  splitCmdRunnerSend,
} from "./shell-constitution"
import { cmdRunnerTailBlock } from "./cmd-runner-tail"
import { getParser, parseShell } from "@/shell/tree-sitter"
import { CMD_FILES, CMD_SAFE, CWD, POWERSHELL_FILES, POWERSHELL_SAFE } from "./shell-sets"
import { formatPathIssues, validatePaths as validatePathsShared, type SandboxRules } from "@/util/path-validator"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 60 * 1000

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
  // In batch grammar, redirection is a sibling of the command inside redirect_stmt,
  // not a descendant. Check the parent node.
  return node.descendantsOfType("redirection").length > 0 || node.parent?.type === "redirect_stmt"
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
  run_in_background: Schema.Boolean.pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed(true)),
  ).annotate({
    description:
      "Run the command in the background as a tracked job. Returns immediately with a job ID. Use joboutput to read output, jobwait to wait for completion, or jobkill to stop. Default: true (non-blocking). Set to false for quick synchronous commands.",
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

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  // No shell mode: Node would escape inner quotes as \" and cmd.exe does not understand \"
  // (CrossSpawnSpawner sets windowsVerbatimArguments for cmd.exe). `/s` + one outer pair of
  // quotes: with more than two quotes on the line a bare `/c` strips the FIRST and the LAST one,
  // pushing the payload out of its quoting so `>` became a redirect into the cwd (2026-09-29).
  return ChildProcess.make(shell, ["/d", "/s", "/c", `"${command}"`], {
    cwd,
    env,
    stdin: "ignore",
    detached: false,
  })
}

/** The same declared shape as `bash`: one type for both branches, so the background handle's `jobID`
 *  reaches its callers TYPED instead of through the `as any` that used to hide it (C6). */
type Metadata = {
  output: string
  exit?: number | null
  description?: string
  truncated?: boolean
  outputPath?: string
  /** Background branch only: the job that was started. */
  jobID?: string
}

export const CmdTool = Tool.define<
  typeof Parameters,
  Metadata,
  Config.Service | ChildProcessSpawner | AppFileSystem.Service | Truncate.Service | Plugin.Service
>(
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

    // The shared validator, as in bash.ts. A private copy used to stand here — a second answer to
    // the same question that ignored the configured sandbox rules (2026-09-29).
    const validatePaths = Effect.fn("CmdTool.validatePaths")(function* (paths: string[], worktree: string) {
      const sandbox = ((yield* config.get()).sandbox ?? undefined) as SandboxRules | undefined
      const issues = yield* Effect.promise(() => validatePathsShared(paths, { worktree, rules: sandbox }))
      return formatPathIssues(issues)
    })

    const collect = Effect.fn("CmdTool.collect")(function* (root: Node, cwd: string, ps: boolean) {
      const scan: Scan = { dirs: new Set<string>(), patterns: new Set<string>(), always: new Set<string>() }
      for (const node of commands(root, ps)) {
        const command = parts(node, ps)
        const tokens = command.map((item) => item.text)
        const cmdName = tokens[0]?.toLowerCase()
        const safe = ps ? POWERSHELL_SAFE : CMD_SAFE
        const files = ps ? POWERSHELL_FILES : CMD_FILES
        if (cmdName && safe.has(cmdName) && !hasRedirection(node, ps)) continue
        if (cmdName && files.has(cmdName)) {
          for (const arg of pathArgs(command)) {
            const resolved = yield* argPath(arg, cwd)
            if (!resolved || Instance.containsPath(resolved)) continue
            // The target OR its directory — a write that creates a file outside the project names a
            // target that does not exist yet (same rule as bash.ts, 2026-09-29).
            const exists = yield* fs.existsSafe(resolved)
            if (!exists && !(yield* fs.existsSafe(path.dirname(resolved)))) continue
            const dir = exists && (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
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
        /** Milliseconds before the tree is killed; undefined only for cmd_runner (owner, 2026-09-29). */
        timeout: number | undefined
        description: string
        /** Background mode: live job writer. Called per chunk so the job's
         *  lastOutputAt tracks real output — the stall heartbeat measures
         *  silence, not a buffered pipe (2026-09-18). */
        onOutput?: (chunk: string) => void
        /** Background mode: pid of the spawned root, attached to the job so
         *  the stall warning can read CPU and the kill can taskkill /T the
         *  tree (2026-09-18). */
        onSpawn?: (pid: number) => void
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

      yield* ctx.metadata({ metadata: { output: "", description: input.description } })

      const scoped = Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env))
          input.onSpawn?.(Number(handle.pid))

          // Drain stdout and stderr on separate fibers (TS/compilers write to stderr).
          // Always await both before leaving scope — see shell-output.ts.
          // Agents should still use `2>&1` when piping into parsers that only read stdin/stdout.
          const onChunk = (chunk: string) => {
            input.onOutput?.(chunk)
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

          // Exit vs deadline — the same contract as bash.ts (owner, 2026-09-29): no abort race,
          // fiber interruption kills the tree through the scope; cmd_runner alone has no deadline.
          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code): number | null => code)),
            ...(input.timeout === undefined
              ? []
              : [Effect.sleep(`${input.timeout} millis`).pipe(Effect.as("expired" as const))]),
          ])
          if (exit === "expired") {
            expired = true
            // Kill BEFORE draining: a dead tree closes its pipes, so the drain returns.
            yield* handle.kill().pipe(
              Effect.catchCause((cause) => Effect.sync(() => log.debug("cmd timeout kill failed", { cause: String(cause) }))),
            )
          }
          yield* awaitDrain
          return exit === "expired" ? null : exit
        }),
      ).pipe(Effect.orDie)
      // Safety net: if kill + drain still hang, the call resolves anyway, 5 s past the deadline.
      const code: number | null =
        input.timeout === undefined
          ? yield* scoped
          : yield* scoped.pipe(
              Effect.timeoutOrElse({
                duration: `${input.timeout + 5000} millis`,
                orElse: () =>
                  Effect.sync(() => {
                    expired = true
                    return null
                  }),
              }),
            )

      const meta: string[] = []
      if (expired) {
        meta.push(
          `cmd tool terminated command after exceeding timeout ${input.timeout} ms. If this command is waiting for interactive keyboard input, run it through cmd_runner instead. If it is a long-running non-interactive command, retry with a larger timeout value in milliseconds.`,
        )
      }
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
          // cmd_runner send … -- <payload>: live session (SSH or interactive TUI debug).
          // Wrapper AST only; payload = brutal DESTRUCTIVE ask (not enumeration hard-blocks).
          // Auto-route crash-prone binaries through cmd_runner BEFORE parsing.
          const autoWrap = autoWrapCmdRunner(params.command)
          const effectiveCommand = autoWrap.command
          const { shellScan: scanCommand, payload: cmdRunnerPayload } = splitCmdRunnerSend(effectiveCommand)
          // Fast regex check: crash-prone binaries must go through cmd_runner.
          enforceBinaryViaCmdRunner(scanCommand)

          const cwd = params.workdir ? yield* resolvePath(params.workdir, Instance.directory) : Instance.directory
          if (params.timeout !== undefined && params.timeout < 0) {
            throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
          }
          const ADM_TIMEOUT = 3 * 60 * 1000
          // cmd_runner owns its own lifecycle: the one command with no deadline (owner, 2026-09-29).
          const isCmdRunner = /\bcmd_runner(?:\.exe)?\b/i.test(effectiveCommand)
          const isAdm = /\badm(?:\.exe)?\b|python(?:3)?(?:\.exe)? -m adm\b/i.test(params.command)
          const timeout = isCmdRunner ? undefined : (params.timeout ?? (isAdm ? ADM_TIMEOUT : DEFAULT_TIMEOUT))
          const shell = process.env.COMSPEC || "cmd.exe"

          const p = yield* Effect.promise(() => getParser())
          const script = powerShellScript(scanCommand)
          const ps = script !== undefined
          // Shared parser: p.cmd = batch grammar, p.ps = PowerShell grammar
          const tree = parseShell(ps ? p.ps : p.cmd, script ?? scanCommand, !ps)
          if (!tree) throw new Error("Failed to parse command")
          const root = tree.rootNode

          // AST-based constitution check (parse first, then classify on AST nodes).
          // Eliminates regex false positives from commit messages, quoted strings, etc.
          // isCmd=true for cmd.exe batch grammar, isCmd=false for PowerShell grammar.
          yield* enforceDestructiveShellFromAst(root, !ps, ctx, params.description)
          if (cmdRunnerPayload) {
            yield* enforceBrutalDestructiveOnly(cmdRunnerPayload, ctx, params.description)
          }
          const scan = yield* collect(root, cwd, ps)
          if (!Instance.containsPath(cwd)) scan.dirs.add(cwd)

          const allPaths = Array.from(scan.dirs)
          const pathWarnings = yield* validatePaths(allPaths, Instance.worktree)
          yield* ask(ctx, scan)
          const env = yield* shellEnv(ctx, cwd)

          // ONE input for every path — same contract and same defect history as bash.ts: sync and
          // fallback used to run `params.command` and only sync printed path warnings (2026-09-29).
          const input = { shell, command: effectiveCommand, cwd, env, timeout, description: params.description }
          const execute = (live?: { onOutput: (chunk: string) => void; onSpawn: (pid: number) => void }) =>
            run({ ...input, ...live }, ctx).pipe(
              Effect.flatMap((result) =>
                // Append the cmd_runner session tail so the result carries the real output.
                Effect.promise(() => cmdRunnerTailBlock(result.output)).pipe(
                  Effect.map((tail) => ({
                    ...result,
                    output:
                      [
                        pathWarnings,
                        autoWrap.wrapped ? "constitution: auto-wrapped via cmd_runner start --" : undefined,
                        result.output,
                      ]
                        .filter(Boolean)
                        .join("\n\n") + tail,
                  })),
                ),
              ),
            )

          // Background is the default: the agent gets a job ID and polls joboutput / jobwait /
          // jobkill. Synchronous execution is opt-in via run_in_background: false.
          const jobSvc = params.run_in_background === false ? undefined : yield* Effect.serviceOption(Jobs.Service)
          if (jobSvc?._tag !== "Some") return yield* execute()
          const label = params.description || params.command.slice(0, 80)
          const jobID = yield* jobSvc.value.startEffect({
            sessionID: ctx.sessionID,
            kind: "cmd",
            label,
            // Stream chunks into the job: `joboutput` shows progress while running and the stall
            // heartbeat sees liveness (2026-09-18 — without it every silent >2min job was killed).
            run: (writeOutput, self) =>
              execute({ onOutput: writeOutput, onSpawn: (pid) => self.setPid(pid) }).pipe(
                Effect.map((result) => result.output),
              ),
          })
          return {
            title: `Background cmd ${jobID}`,
            output: `Started background job ${jobID} (${label}). Use joboutput to read its output, or jobwait to wait for completion.`,
            metadata: {
              jobID,
              output: "",
              exit: null as number | null,
              description: label,
              truncated: false,
            },
          }
        }),
    }
  }),
)
