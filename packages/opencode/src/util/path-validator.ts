/**
 * CLI path validation — agent feedback, not hard blocking.
 *
 * Prefer WASM (deterministic). Fall back to pure TypeScript when WASM is
 * unavailable. Used by bash tool before command execution.
 */
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { readWasmAsset } from "./wasm-path"

const log = Log.create({ service: "util.path-validator" })

export type PathIssueCode =
  | "double_drive"
  | "system"
  | "git"
  | "outside_worktree"
  | "blocked"
  | "missing"
  | "invalid"

export type PathIssue = {
  path: string
  code: PathIssueCode
  message: string
  suggestion?: string
}

export type SandboxRules = {
  /** When false, skip validation entirely. Default true. */
  enabled?: boolean
  /** Check OS system directories. Default true. */
  system?: boolean
  /** Check .git paths. Default true. */
  git?: boolean
  /** Warn when absolute path is outside worktree. Default true. */
  outside?: boolean
  /** Warn when path does not exist (non-glob). Default true. */
  missing?: boolean
  /** Extra blocked path prefixes (case-insensitive). */
  blocked?: string[]
}

export type ValidateOptions = {
  worktree: string
  rules?: SandboxRules
}

const CODE_FROM_WASM: Record<number, PathIssueCode> = {
  1: "double_drive",
  2: "system",
  3: "git",
  4: "outside_worktree",
  5: "blocked",
  6: "invalid",
}

// Must match packages/wasm/core/src/path_validator.c (non-zero to avoid NULL).
const PATH_OFFSET = 256
const WORKTREE_OFFSET = 4352
const BLOCKED_OFFSET = 8448
const MEMORY_PAGES = 2 // 128 KiB

type WasmExports = {
  memory: WebAssembly.Memory
  pv_validate: (pathLen: number, worktreeLen: number, blockedLen: number, flags: number) => number
  pv_version: () => number
}

let _module: WebAssembly.Module | null = null
let _initPromise: Promise<WebAssembly.Module | null> | null = null
const encoder = new TextEncoder()

function rulesFlags(rules?: SandboxRules): number {
  let flags = 0
  if (rules?.system !== false) flags |= 1
  if (rules?.git !== false) flags |= 2
  if (rules?.outside !== false) flags |= 4
  return flags
}

function normalizeSeps(p: string): string {
  return p.replace(/\\/g, "/")
}

function isAbsolutePath(p: string): boolean {
  if (p.startsWith("/") || p.startsWith("\\")) return true
  return /^[A-Za-z]:[\\/]/.test(p)
}

function fixDoubleDrive(p: string): string | undefined {
  const m = p.match(/^([A-Za-z]:)[\\/]\1(.*)$/i)
  if (!m) return undefined
  return m[1] + (p.includes("\\") ? "\\" : "/") + (m[2] || "").replace(/^[/\\]+/, "")
}

function issueForCode(p: string, code: PathIssueCode): PathIssue {
  switch (code) {
    case "double_drive": {
      const fix = fixDoubleDrive(p)
      return {
        path: p,
        code,
        message: `"${p}" — invalid: double drive letter`,
        suggestion: fix ? `use ${fix}` : undefined,
      }
    }
    case "system":
      return { path: p, code, message: `"${p}" — blocked: system directory` }
    case "git":
      return { path: p, code, message: `"${p}" — blocked: .git directory` }
    case "outside_worktree":
      return {
        path: p,
        code,
        message: `"${p}" — outside worktree (use external_directory permission or navigation.allow)`,
      }
    case "blocked":
      return { path: p, code, message: `"${p}" — blocked by sandbox.rules` }
    case "invalid":
      return { path: p, code, message: `"${p}" — invalid path` }
    case "missing":
      return { path: p, code, message: `"${p}" — path does not exist` }
  }
}

/** Pure TypeScript validation (fallback + parity with WASM). */
export function validatePathTs(p: string, opts: ValidateOptions): PathIssue | null {
  const rules = opts.rules
  if (rules?.enabled === false) return null
  if (!p) return issueForCode(p, "invalid")

  if (/^[A-Za-z]:[\\/][A-Za-z]:/.test(p)) return issueForCode(p, "double_drive")

  if (rules?.system !== false) {
    if (/^(C:\\Windows|C:\/Windows|\/etc|\/usr|\/bin|\/sbin|\/var|\/root|\/System|\/Library)([\\/]|$)/i.test(p)) {
      return issueForCode(p, "system")
    }
  }

  if (rules?.git !== false) {
    if (/(^|[\\/])\.git([\\/]|$)/.test(p)) return issueForCode(p, "git")
  }

  const blocked = rules?.blocked ?? []
  for (const prefix of blocked) {
    if (!prefix) continue
    const a = normalizeSeps(p).toLowerCase()
    const b = normalizeSeps(prefix).toLowerCase().replace(/\/+$/, "")
    if (a === b || a.startsWith(b + "/")) return issueForCode(p, "blocked")
  }

  if (rules?.outside !== false && isAbsolutePath(p) && opts.worktree) {
    const abs = path.normalize(p)
    const wt = path.normalize(opts.worktree)
    const rel = path.relative(wt, abs)
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return issueForCode(p, "outside_worktree")
    }
  }

  return null
}

async function loadModule(): Promise<WebAssembly.Module | null> {
  if (_module) return _module
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    try {
      const asset = await readWasmAsset("path_validator.wasm")
      if (!asset.bytes) {
        log.debug("path-validator: WASM not found, using TS fallback", { tried: asset.tried })
        return null
      }
      _module = await WebAssembly.compile(asset.bytes)
      log.info("path-validator: WASM loaded from " + asset.path)
      return _module
    } catch (err) {
      log.warn("path-validator: WASM load failed", { error: String(err) })
      return null
    }
  })()
  return _initPromise
}

export async function initPathValidator(): Promise<boolean> {
  return (await loadModule()) !== null
}

function writeUtf8(mem: WebAssembly.Memory, offset: number, text: string, max: number): number {
  const bytes = encoder.encode(text)
  const len = Math.min(bytes.length, max)
  new Uint8Array(mem.buffer, offset, len).set(bytes.subarray(0, len))
  return len
}

function writeBlocked(mem: WebAssembly.Memory, prefixes: string[]): number {
  const view = new Uint8Array(mem.buffer)
  let off = BLOCKED_OFFSET
  const end = BLOCKED_OFFSET + 4096 - 2
  for (const p of prefixes) {
    const b = encoder.encode(p)
    if (off + b.length + 2 > end) break
    view.set(b, off)
    off += b.length
    view[off++] = 0
  }
  view[off++] = 0
  return off - BLOCKED_OFFSET
}

async function validateOneWasm(p: string, opts: ValidateOptions): Promise<PathIssue | null | undefined> {
  const mod = await loadModule()
  if (!mod) return undefined

  try {
    const memory = new WebAssembly.Memory({ initial: MEMORY_PAGES, maximum: MEMORY_PAGES })
    const instance = await WebAssembly.instantiate(mod, {
      env: { memory },
    })
    const exp = instance.exports as unknown as WasmExports
    if (typeof exp.pv_validate !== "function") return undefined

    const pathLen = writeUtf8(memory, PATH_OFFSET, p, 4095)
    const wtLen = writeUtf8(memory, WORKTREE_OFFSET, opts.worktree ?? "", 4095)
    const blocked = opts.rules?.blocked ?? []
    const blockedLen = writeBlocked(memory, blocked)
    const code = exp.pv_validate(pathLen, wtLen, blockedLen, rulesFlags(opts.rules)) >>> 0
    if (code === 0) return null
    const mapped = CODE_FROM_WASM[code]
    if (!mapped) return null
    return issueForCode(p, mapped)
  } catch (err) {
    log.debug("path-validator: WASM validate failed", { error: String(err), path: p })
    return undefined
  }
}

/**
 * Validate paths. Uses WASM when available; otherwise TS.
 * Also appends existence checks in TS (needs host fs).
 */
export async function validatePaths(paths: string[], opts: ValidateOptions): Promise<PathIssue[]> {
  if (opts.rules?.enabled === false) return []
  const issues: PathIssue[] = []
  const seen = new Set<string>()

  for (const p of paths) {
    if (!p || seen.has(p)) continue
    seen.add(p)

    let issue = await validateOneWasm(p, opts)
    if (issue === undefined) {
      issue = validatePathTs(p, opts)
    }
    if (issue) {
      issues.push(issue)
      continue
    }

    // Existence is host-only (WASM has no FS).
    if (opts.rules?.missing !== false && !p.includes("*") && !p.includes("?")) {
      try {
        const { existsSync } = await import("fs")
        const resolved = path.isAbsolute(p) ? p : path.resolve(opts.worktree, p)
        if (!existsSync(resolved)) {
          issues.push(issueForCode(p, "missing"))
        }
      } catch (err) {
        log.debug("path-validator: existence check failed", { path: p, error: String(err) })
      }
    }
  }

  return issues
}

export function formatPathIssues(issues: PathIssue[]): string | undefined {
  if (issues.length === 0) return undefined
  const lines = issues.map((issue, i) => {
    const base = `  ${i + 1}. ${issue.message}`
    return issue.suggestion ? `${base}\n     Suggested fix: ${issue.suggestion}` : base
  })
  return `⚠ Path issues detected:\n${lines.join("\n")}\n\nThese are warnings — the command still ran. Fix paths if the command failed.`
}

export * as PathValidator from "./path-validator"
