import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { setTimeout as sleep } from "node:timers/promises"

const log = Log.create({ service: "shell" })

const SIGKILL_TIMEOUT_MS = 200
const META: Record<string, { deny?: boolean; login?: boolean; posix?: boolean; ps?: boolean }> = {
  bash: { login: true, posix: true },
  dash: { login: true, posix: true },
  fish: { deny: true, login: true },
  ksh: { login: true, posix: true },
  nu: { deny: true },
  powershell: { ps: true },
  pwsh: { ps: true },
  sh: { login: true, posix: true },
  zsh: { login: true, posix: true },
}

export type Item = {
  path: string
  name: string
  acceptable: boolean
}

export async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
  const pid = proc.pid
  if (!pid || opts?.exited?.()) return

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("exit", () => resolve())
      killer.once("error", () => resolve())
    })
    return
  }

  try {
    process.kill(-pid, "SIGTERM")
    await sleep(SIGKILL_TIMEOUT_MS)
    if (!opts?.exited?.()) {
      process.kill(-pid, "SIGKILL")
    }
  } catch (_e) {
    log.debug("process.kill failed, falling back to proc.kill", { error: String(_e) })
    proc.kill("SIGTERM")
    await sleep(SIGKILL_TIMEOUT_MS)
    if (!opts?.exited?.()) {
      proc.kill("SIGKILL")
    }
  }
}

function full(file: string) {
  if (process.platform !== "win32") return file
  const shell = Filesystem.windowsPath(file)
  if (path.win32.dirname(shell) !== ".") {
    if (shell.startsWith("/") && name(shell) === "bash") return gitbash() || shell
    return shell
  }
  if (name(shell) === "bash") return gitbash() || which(shell) || shell
  return which(shell) || shell
}

function meta(file: string) {
  return META[name(file)]
}

function ok(file: string) {
  const n = name(file)
  // On Windows, deny bash shell — only cmd.exe and PowerShell are supported.
  // This prevents quoting issues with cmd.exe's /s /c wrapper and keeps
  // the shell environment predictable. If the user has Git Bash installed,
  // its commands can be run through cmd.exe.
  if (process.platform === "win32" && n === "bash") return false
  return meta(file)?.deny !== true
}

function rooted(file: string) {
  return path.isAbsolute(Filesystem.windowsPath(file))
}

function resolve(file: string) {
  const shell = full(file)
  if (rooted(shell)) {
    if (Filesystem.stat(shell)?.isFile()) return shell
    return
  }
  return which(shell) ?? undefined
}

function win() {
  // Git Bash is deliberately absent. `ok()` already refuses it for the agent's
  // shell — quoting through cmd.exe's /s /c wrapper and an unpredictable
  // environment — but it was still listed here, which is what `Shell.list()`
  // hands to the PTY route and therefore to the shell picker. One policy
  // answering two different ways is how it gets selected anyway. Anything that
  // genuinely needs Git Bash asks `gitbash()` for it by name.
  return Array.from(
    new Set(
      [process.env.COMSPEC || "cmd.exe", which("pwsh"), which("powershell")]
        .filter((item): item is string => Boolean(item))
        .map(full),
    ),
  )
}

async function unix() {
  const text = await Filesystem.readText("/etc/shells").catch(() => "")
  if (text) return Array.from(new Set(text.split("\n").filter((line) => line.trim() && !line.startsWith("#"))))
  return ["/bin/bash", "/bin/zsh", "/bin/sh"]
}

/**
 * THE LAST RESOLUTION, as STATE rather than as a log line — K4/C5 of
 * `plans/2026-09-29_bash-tool-single-execution-path.md`.
 *
 * `select()` used to fall back SILENTLY: a requested shell that was missing or unacceptable was replaced by
 * the platform default and nothing said so, so a reader of the output could not tell why their shell had been
 * ignored. Where the signal belongs was the open question, and AGENTS § Debugging Paradigm answers it: a log
 * may record only what state cannot show, and a fallback HAS a key — the resolved shell already rides the
 * tools' own metadata. So it is exposed beside the accessors that produce it, and any surface that renders
 * shell state can read it (`bash.ts` rides it on the permission ask).
 *
 * `fellBack` is true only when something was actually REFUSED: with no request the platform default IS the
 * answer, and calling that a fallback would make this state cry wolf on every start.
 */
export interface Resolution {
  /** The shell that will be used. */
  used: string
  /** What was ASKED for, when something was — absent means no request was made. */
  requested?: string
  /** True only when a request was refused and the answer is not it. */
  fellBack: boolean
}

let lastResolution: Resolution | undefined

/** The last resolution `select()` made. State, not a log — see {@link Resolution}. */
export function resolution(): Resolution | undefined {
  return lastResolution
}

function select(file: string | undefined, opts?: { acceptable?: boolean }) {
  if (file && (!opts?.acceptable || ok(file))) {
    const shell = resolve(file)
    if (shell) {
      lastResolution = { used: shell, requested: file, fellBack: false }
      return shell
    }
  }
  const shell = process.platform === "win32" ? win()[0]! : fallback()
  lastResolution = { used: shell, ...(file ? { requested: file } : {}), fellBack: Boolean(file) }
  return shell
}

export function gitbash() {
  if (process.platform !== "win32") return
  if (Flag.OPENCODE_GIT_BASH_PATH) return Flag.OPENCODE_GIT_BASH_PATH
  const git = which("git")
  if (!git) return
  const file = path.join(git, "..", "..", "bin", "bash.exe")
  if (Filesystem.stat(file)?.size) return file
}

function fallback() {
  if (process.platform === "darwin") return "/bin/zsh"
  const bash = which("bash")
  if (bash) return bash
  return "/bin/sh"
}

export function name(file: string) {
  if (process.platform === "win32") return path.win32.parse(Filesystem.windowsPath(file)).name.toLowerCase()
  return path.basename(file).toLowerCase()
}

export function login(file: string) {
  return meta(file)?.login === true
}

export function posix(file: string) {
  return meta(file)?.posix === true
}

export function ps(file: string) {
  return meta(file)?.ps === true
}

/**
 * Permission key for shell tool invocations.
 * Separates bash (posix), PowerShell, and cmd so config can allow/deny each independently.
 */
export function permissionKey(file: string): "bash" | "powershell" | "cmd" {
  if (ps(file)) return "powershell"
  const n = name(file)
  if (n === "cmd" || n === "command") return "cmd"
  // Windows non-posix, non-ps shells (e.g. COMSPEC) treat as cmd
  if (process.platform === "win32" && !posix(file)) return "cmd"
  return "bash"
}

function info(file: string): Item {
  const item = full(file)
  const n = name(item)
  return {
    path: item,
    name: resolve(n) ? n : item,
    acceptable: ok(item),
  }
}

export function args(file: string, command: string, cwd: string) {
  const n = name(file)
  if (n === "nu" || n === "fish") return ["-c", command]
  if (n === "zsh") {
    return [
      "-l",
      "-c",
      `
        [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
        [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
        cd -- "$1"
        eval ${JSON.stringify(command)}
      `,
      "opencode",
      cwd,
    ]
  }
  if (n === "bash") {
    return [
      "-l",
      "-c",
      `
        shopt -s expand_aliases
        [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
        cd -- "$1"
        eval ${JSON.stringify(command)}
      `,
      "opencode",
      cwd,
    ]
  }
  if (n === "cmd") return ["/c", command]
  if (ps(file)) return ["-NoProfile", "-Command", command]
  return ["-c", command]
}

const defaultPreferred = lazy(() => select(process.env.SHELL))
const defaultAcceptable = lazy(() => select(process.env.SHELL, { acceptable: true }))

export function preferred(configShell?: string) {
  if (configShell) return select(configShell)
  return defaultPreferred()
}
preferred.reset = () => defaultPreferred.reset()

export function acceptable(configShell?: string) {
  if (configShell) return select(configShell, { acceptable: true })
  return defaultAcceptable()
}
acceptable.reset = () => defaultAcceptable.reset()

export async function list(): Promise<Item[]> {
  const shells = process.platform === "win32" ? win() : await unix()
  // `ok()` is the single owner of "may this shell be used here". Listing
  // something the runtime would then refuse is an offer it cannot honour.
  return shells.filter((s) => ok(s) && resolve(s)).map(info)
}

export * as Shell from "./shell"
