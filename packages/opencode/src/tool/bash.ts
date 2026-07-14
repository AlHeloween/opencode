import { Schema } from "effect"
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import POWERSHELL_DESCRIPTION from "./powershell.txt"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { readWasmAsset } from "@/util/wasm-path"
import { Language, type Node } from "web-tree-sitter"

import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Shell } from "@/shell/shell"
import { stripCommand } from "./strip-win"

import { BashArity } from "@/permission/arity"
import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { InstanceState } from "@/effect/instance-state"
import { Jobs } from "@/jobs"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 60 * 1000
const CWD = new Set(["cd", "popd", "pushd", "push-location", "set-location"])
const FILES = new Set([...CWD, "cat", "chmod", "chown", "cp", "ln", "mkdir", "mv", "rm", "touch"])

// cmd.exe-specific SAFE and FILES sets used when shell is cmd.exe on Windows.
const CMD_SAFE = new Set([
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

const CMD_FILES = new Set([
  "cd",
  "pushd",
  "popd",
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
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

// Known-safe search tools auto-approved when not using dangerous flags.
// Mirrors Codex safe-command logic: block code-exec flags, allow all others.
const UNSAFE_RG_FLAGS = new Set(["--pre", "--hostname-bin", "--search-zip", "-z"])
const UNSAFE_FD_FLAGS = new Set(["--exec", "-x", "--exec-batch", "-X"])

// Known-safe read-only commands that never trigger permission scanning.
// These are purely informational/display commands that don't modify filesystem state.
// When combined with shell redirections (> |), the redirection check catches them.
const SAFE = new Set([
  // bash/POSIX — info/utility only
  "basename",
  "dirname",
  "echo",
  "env",
  "false",
  "grep",
  "head",
  "ls",
  "printf",
  "pwd",
  "sort",
  "tail",
  "true",
  "uniq",
  "wc",
  "which",
  "whoami",
])

function hasRedirection(node: Node, isCmd?: boolean): boolean {
  if (isCmd) {
    return node.descendantsOfType("redirection").length > 0 || node.descendantsOfType("redirect_stmt").length > 0
  }
  return node.descendantsOfType("redirection").length > 0
}

function isKnownSafeCommand(parts: Part[]): boolean {
  const cmd = parts[0]?.text?.toLowerCase()
  const tokens = parts.map((p) => p.text.toLowerCase())
  if (cmd === "rg" || cmd === "rg.exe") {
    return !tokens.some((t) => UNSAFE_RG_FLAGS.has(t))
  }
  if (cmd === "fd" || cmd === "fd.exe") {
    return !tokens.some((t) => UNSAFE_FD_FLAGS.has(t))
  }
  return false
}

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "The command to execute" }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in milliseconds" }),
  workdir: Schema.optional(Schema.String).annotate({
    description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
  }),
  description: Schema.String.annotate({
    description:
      "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
  }),
  run_in_background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the command in the background as a tracked job. Returns immediately with a job ID. Use job_output to read output later.",
  }),
})

type Part = {
  type: string
  text: string
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

type Chunk = {
  text: string
  size: number
}

export const log = Log.create({ service: "bash-tool" })

function parts(node: Node, isCmd?: boolean): Part[] {
  if (isCmd) {
    const out: Part[] = []
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

  // Bash / PowerShell grammar AST traversal
  const out: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation" &&
      child.type !== "generic_token" &&
      child.type !== "array_literal_expression"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

function source(node: Node, isCmd?: boolean) {
  if (isCmd) {
    return (node.parent?.type === "redirect_stmt" ? node.parent.text : node.text).trim()
  }
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function commands(node: Node, isCmd?: boolean) {
  return node.descendantsOfType(isCmd ? "cmd" : "command").filter((child): child is Node => Boolean(child))
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
  return undefined
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return undefined
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return undefined
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return undefined
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean, shell: string, isCmd?: boolean) {
  if (isCmd) {
    // Batch grammar: filter out flags starting with / or -, keep positional args
    return list
      .slice(1)
      .filter((item) => !item.text.startsWith("-") && !item.text.startsWith("/"))
      .map((item) => item.text)
  }

  if (!ps) {
    const isCmdLike = !Shell.posix(shell)
    return list
      .slice(1)
      .filter(
        (item) =>
          !item.text.startsWith("-") &&
          !(isCmdLike && item.text.startsWith("/")) &&
          !(list[0]?.text === "chmod" && item.text.startsWith("+")),
      )
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return {
      text,
      cut: false,
    }
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
  return {
    text: out.join("\n"),
    cut: true,
  }
}

const parse = Effect.fn("BashTool.parse")(function* (command: string, ps: boolean, isCmd: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (isCmd ? p.cmd : ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree.rootNode
})

const ask = Effect.fn("BashTool.ask")(function* (ctx: Tool.Context, scan: Scan) {
  if (scan.dirs.size > 0) {
    const globs = Array.from(scan.dirs).map((dir) => path.join(dir, "*"))
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {},
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: "bash",
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {},
  })
})

export function normalizeCommandPaths(command: string): string {
  // Replace \ with / in Windows paths (D:\path → D:/path)
  // Only applied for POSIX shells (gated by Shell.posix() in cmd())
  return command.replace(/([A-Za-z]:)[\\/]/g, (_, drive) => drive + "/")
}

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const result = stripCommand(command, shell)
  const stripped = result.command
  const normalized = process.platform === "win32" && Shell.posix(shell) ? normalizeCommandPaths(stripped) : stripped

  // PowerShell on Windows: pass command via -Command flag (no shell wrapping)
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", normalized], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  // cmd.exe on Windows: pass via cmd /c (no shell mode) to avoid Node.js
  // wrapping the command with /d /s /c "...", which escapes inner quotes as
  // \" — cmd.exe does not understand \" escaping and splits paths with spaces
  // (e.g., "C:\Program Files\..." becomes \ + "C:\Program + rest).
  // The CrossSpawnSpawner auto-detects this and sets windowsVerbatimArguments.
  if (process.platform === "win32" && !Shell.posix(shell) && !Shell.ps(shell)) {
    return ChildProcess.make(shell, ["/c", normalized], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(normalized, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: false,
  })
}
const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const treeWasm = await readWasmAsset("tree-sitter.wasm")
  if (!treeWasm.bytes) {
    throw new Error("tree-sitter runtime WASM unavailable; tried: " + JSON.stringify(treeWasm.tried))
  }
  // web-tree-sitter types require full EmscriptenModule, but runtime accepts wasmBinary.
  await (Parser.init as any)({
    wasmBinary: treeWasm.bytes,
  })
  const [bashWasm, cmdWasm, psWasm] = await Promise.all([
    readWasmAsset("grammars/tree-sitter-bash.wasm"),
    readWasmAsset("grammars/tree-sitter-batch.wasm"),
    readWasmAsset("grammars/tree-sitter-powershell.wasm"),
  ])
  if (!bashWasm.bytes) throw new Error("bash grammar WASM unavailable; tried: " + JSON.stringify(bashWasm.tried))
  if (!cmdWasm.bytes) throw new Error("batch grammar WASM unavailable; tried: " + JSON.stringify(cmdWasm.tried))
  if (!psWasm.bytes) throw new Error("PowerShell grammar WASM unavailable; tried: " + JSON.stringify(psWasm.tried))
  const bashBytes: ArrayBuffer = bashWasm.bytes
  const cmdBytes: ArrayBuffer = cmdWasm.bytes
  const psBytes: ArrayBuffer = psWasm.bytes
  const [bashLanguage, cmdLanguage, psLanguage] = await Promise.all([
    Language.load(new Uint8Array(bashBytes)),
    Language.load(new Uint8Array(cmdBytes)),
    Language.load(new Uint8Array(psBytes)),
  ])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const cmd = new Parser()
  cmd.setLanguage(cmdLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, cmd, ps }
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define(
  "bash",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const fs = yield* AppFileSystem.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service

    const cygpath = Effect.fn("BashTool.cygpath")(function* (shell: string, text: string) {
      const lines = yield* spawner
        .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
        .pipe(Effect.catch((e) => {
          log.debug("cygpath failed, using original paths", { error: String(e) })
          return Effect.succeed([] as string[])
        }))
      const file = lines[0]?.trim()
      if (!file) return undefined
      return AppFileSystem.normalizePath(file)
    })

    const resolvePath = Effect.fn("BashTool.resolvePath")(function* (text: string, root: string, shell: string) {
      if (process.platform === "win32") {
        if (Shell.posix(shell) && text.startsWith("/") && AppFileSystem.windowsPath(text) === text) {
          const file = yield* cygpath(shell, text)
          if (file) return file
        }
        const file = AppFileSystem.windowsPath(text)
        return AppFileSystem.normalizePath(path.resolve(root, /^[A-Za-z]:(?![\\/])/.test(file) ? file.slice(2) : file))
      }
      return path.resolve(root, text)
    })

    const argPath = Effect.fn("BashTool.argPath")(function* (arg: string, cwd: string, ps: boolean, shell: string) {
      const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
      const file = text && prefix(text)
      if (!file || dynamic(file, ps)) return undefined
      const next = ps ? provider(file) : file
      if (!next) return undefined
      return yield* resolvePath(next, cwd, shell)
    })

    const validatePaths = Effect.fn("BashTool.validatePaths")(function* (paths: string[], worktree: string) {
      const issues: string[] = []
      for (const p of paths) {
        // Double drive letter: D:\D:\path
        if (/^[A-Za-z]:[\\\/][A-Za-z]:/.test(p)) {
          issues.push(`"${p}" — invalid: double drive letter`)
          continue
        }
        // System directories
        if (/^(C:\\Windows|\/etc|\/usr|\/bin|\/sbin|\/var|\/root)(\\|\/|$)/i.test(p)) {
          issues.push(`"${p}" — blocked: system directory`)
          continue
        }
        // .git directory mutations
        if (/[\\/]\.git([\\/]|$)/.test(p)) {
          issues.push(`"${p}" — blocked: .git directory`)
          continue
        }
        // Path doesn't exist (for non-glob paths)
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

    const collect = Effect.fn("BashTool.collect")(function* (
      root: Node,
      cwd: string,
      ps: boolean,
      shell: string,
      isCmd: boolean,
    ) {
      const scan: Scan = {
        dirs: new Set<string>(),
        patterns: new Set<string>(),
        always: new Set<string>(),
      }

      const cmdSafe = isCmd ? CMD_SAFE : ps ? POWERSHELL_SAFE : SAFE
      const cmdFiles = isCmd ? CMD_FILES : ps ? POWERSHELL_FILES : FILES

      for (const node of commands(root, isCmd)) {
        const command = parts(node, isCmd)
        const tokens = command.map((item) => item.text)
        const cmd = ps || isCmd ? tokens[0]?.toLowerCase() : tokens[0]

        // Auto-approve known-safe search tools (rg, fd) when not using dangerous flags
        if (cmd && isKnownSafeCommand(command)) {
          continue
        }

        // Skip known-safe read-only commands entirely (no path scanning, no pattern scanning).
        // But if the command has shell redirections (> |), it can write files — don't skip it.
        if (cmd && cmdSafe.has(cmd) && !hasRedirection(node, isCmd)) {
          continue
        }

        if (cmd && cmdFiles.has(cmd)) {
          for (const arg of pathArgs(command, ps, shell, isCmd)) {
            const resolved = yield* argPath(arg, cwd, ps, shell)
            log.info("resolved path", { arg, resolved })
            if (!resolved || Instance.containsPath(resolved)) continue

            // Only prompt for external directories that actually exist.
            // Non-existent/corrupted paths (e.g., from incorrect resolution)
            // should never trigger a permission prompt.
            if (!(yield* fs.existsSafe(resolved))) continue

            const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
            scan.dirs.add(dir)
          }
        }

        if (tokens.length && (!cmd || !CWD.has(cmd))) {
          scan.patterns.add(source(node, isCmd))
          scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
        }
      }

      return scan
    })

    const shellEnv = Effect.fn("BashTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
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

    const run = Effect.fn("BashTool.run")(function* (
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

      const isCmdRunner = /\bcmd_runner(?:\.exe)?\b/i.test(input.command)

      yield* ctx.metadata({
        metadata: {
          output: "",
          description: input.description,
        },
      })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env))

          // cmd_runner spawns its own terminal window and stays alive as a daemon.
          // Don't wait for exit — return immediately; user interacts via the terminal.
          if (isCmdRunner) return null

          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
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
              } else {
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
                    Effect.andThen(
                      ctx.metadata({
                        output: last,
                        metadata: {
                          output: last,
                          description: input.description,
                        },
                      }),
                    ),
                  )
                }
              }

              return ctx.metadata({
                metadata: {
                  output: last,
                  description: input.description,
                },
              })
            }),
          )

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
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.catchCause(() => Effect.sync(() => log.debug("bash abort kill failed"))))
          }
          if (exit.kind === "timeout") {
            expired = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.catchCause(() => Effect.sync(() => log.debug("bash timeout kill failed"))))
          }

          return exit.kind === "exit" ? exit.code : null
        }),
      ).pipe(Effect.orDie)

      const meta: string[] = []
      if (expired) {
        meta.push(
          `bash tool terminated command after exceeding timeout ${input.timeout} ms. If this command is waiting for interactive keyboard input, run it through cmd_runner instead. If it is a long-running non-interactive command, retry with a larger timeout value in milliseconds.`,
        )
      }
      if (aborted) meta.push("User aborted the command")
      const raw = list.map((item) => item.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) {
        file = yield* trunc.write(raw)
      }

      let output = end.text
      if (!output) output = "(no output)"

      if (cut && file) {
        output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      }

      if (meta.length > 0) {
        output += "\n\n<bash_metadata>\n" + meta.join("\n") + "\n</bash_metadata>"
      }
      if (sink) {
        const stream = sink
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              let settled = false
              const done = () => {
                if (settled) return
                settled = true
                resolve()
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

    return () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const shell = Shell.acceptable(cfg.shell)
        const name = Shell.name(shell)
        const chain =
          "If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead."
        log.info("bash tool using shell", { shell })

        const limits = yield* trunc.limits()
        const instance = yield* InstanceState.context

        return {
          description: (Shell.ps(shell) ? POWERSHELL_DESCRIPTION : DESCRIPTION)
            .replaceAll("${directory}", instance.directory)
            .replaceAll("${os}", process.platform)
            .replaceAll("${shell}", name)
            .replaceAll("${chaining}", chain)
            .replaceAll("${maxLines}", String(limits.maxLines))
            .replaceAll("${maxBytes}", String(limits.maxBytes)),
          parameters: Parameters,
          execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
            Effect.gen(function* () {
              const cwd = params.workdir
                ? yield* resolvePath(params.workdir, Instance.directory, shell)
                : Instance.directory
              if (params.timeout !== undefined && params.timeout < 0) {
                throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
              }
              const CMD_RUNNER_TIMEOUT = 10 * 60 * 1000 // 10 min — cmd_runner manages its own lifecycle
              const ADM_TIMEOUT = 3 * 60 * 1000 // 3 min — adm --query needs model cold-load (~20-30s)
              const isCmdRunner = /\bcmd_runner(?:\.exe)?\b/i.test(params.command)
              const isAdm = /\badm(?:\.exe)?\b|python(?:3)?(?:\.exe)? -m adm\b/i.test(params.command)
              const timeout =
                params.timeout ?? (isCmdRunner ? CMD_RUNNER_TIMEOUT : isAdm ? ADM_TIMEOUT : DEFAULT_TIMEOUT)
              const ps = Shell.ps(shell)
              // On Windows: detect cmd.exe shell to select batch grammar + cmd SAFE/FILES.
              // Shell.posix(shell) is false for cmd.exe; Shell.ps(shell) is false for cmd.exe.
              const isCmd = process.platform === "win32" && !Shell.posix(shell) && !Shell.ps(shell)
              const root = yield* parse(params.command, ps, isCmd)
              const scan = yield* collect(root, cwd, ps, shell, isCmd)
              if (!Instance.containsPath(cwd)) scan.dirs.add(cwd)

              // Validate paths before execution — inform agent of issues
              const allPaths = Array.from(scan.dirs)
              const pathWarnings = yield* validatePaths(allPaths, Instance.worktree)

              yield* ask(ctx, scan)

              // Background mode: fork into JobManager, return immediately
              if (params.run_in_background) {
                const jobSvc = yield* Effect.serviceOption(Jobs.Service)
                if (jobSvc._tag === "None") {
                  // Fallback to normal execution if Jobs not available
                  return yield* run(
                    {
                      shell,
                      command: params.command,
                      cwd,
                      env: yield* shellEnv(ctx, cwd),
                      timeout,
                      description: params.description,
                    },
                    ctx,
                  )
                }
                const jobID = yield* jobSvc.value.startEffect({
                  sessionID: ctx.sessionID,
                  kind: "bash",
                  label: params.description || params.command.slice(0, 80),
                  run: Effect.gen(function* () {
                    const result = yield* run(
                      {
                        shell,
                        command: params.command,
                        cwd,
                        env: yield* shellEnv(ctx, cwd),
                        timeout,
                        description: params.description,
                      },
                      ctx,
                    )
                    return result.output
                  }),
                })
                return {
                  title: `Background bash ${jobID}`,
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
                {
                  shell,
                  command: params.command,
                  cwd,
                  env: yield* shellEnv(ctx, cwd),
                  timeout,
                  description: params.description,
                },
                ctx,
              )

              // Prepend path validation warnings to output
              if (pathWarnings) {
                result.output = `${pathWarnings}\n\n${result.output}`
              }

              return result
            }),
        }
      })
  }),
)
