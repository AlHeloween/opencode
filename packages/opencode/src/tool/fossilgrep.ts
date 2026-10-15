import { Effect, Schema } from "effect"
import { execFile } from "child_process"
import path from "path"
import * as Tool from "./tool"
import { Global } from "@opencode-ai/core/global"
import DESCRIPTION from "./fossilgrep.txt"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tool.fossilgrep" })

export function findFossil(): string {
  const fs = require("fs") as typeof import("fs")
  const names = process.platform === "win32" ? ["fossil.exe", "fossil"] : ["fossil", "fossil.exe"]
  const dirs = [
    path.join(path.dirname(process.execPath), "tools"),
    path.join(Global.Path.home, "tools"),
    path.join(Global.Path.home, "external", "fossil"),
  ]
  for (const dir of dirs) {
    for (const name of names) {
      const c = path.join(dir, name)
      try {
        if (fs.existsSync(c)) return c
      } catch (error) {
        log.debug("fossil binary probe failed", { candidate: c, error })
      }
    }
  }
  return "fossil"
}

const FOSSIL_BIN = findFossil()

function fossilAsync(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      FOSSIL_BIN,
      args,
      { cwd, encoding: "utf-8", timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout: stdout ?? "", stderr: stderr ?? "" }),
    )
  })
}

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "POSIX extended regular expression to search for" }),
  mode: Schema.optional(Schema.Literals(["files", "comments"])).annotate({
    description: "files (default) searches file versions; comments searches check-in COMMENTS — the semantic-vector timeline (dominant, keywords, sv md5)",
  }),
  allProjects: Schema.optional(Schema.Boolean).annotate({
    description: "comments mode only: search EVERY registered project's snapshot repo (fossil all list), not just this one; a repo that fails to open is NAMED in the result",
  }),
  files: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "File paths to search. If omitted, searches all tracked files.",
  }),
  ignoreCase: Schema.optional(Schema.Boolean).annotate({
    description: "Case-insensitive search (default: false)",
  }),
  maxResults: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of version matches to return (default: 50)",
  }),
  once: Schema.optional(Schema.Boolean).annotate({
    description: "Stop after first match per file (default: false)",
  }),
})

/**
 * Search check-in COMMENTS across the whole timeline — the layer the semantic vectors live on.
 *
 * Every snapshot check-in's comment starts `auto-snapshot sv:<md5> dominant=<sentence> Keywords: …`
 * (docs/fossil-snapshot.md §2.0.1), so a regex over comments searches the timeline by MEANING:
 * «when did we work on X», «which turn changed Y and why». Read-only: `fossil sql -R <repo>` over
 * `event JOIN blob` — the documented read path — never a repo write.
 *
 * Fossil truncates the comment in `timeline` output (measured: ~120 chars in the default format),
 * so the search reads the `event.comment` column itself, which carries the full text (max 734
 * chars measured on this repo's 418 check-ins).
 */
export type CommentMatch = {
  checkin: string
  date: string
  comment: string
  dominant?: string
  sv?: string
  files: string[]
}

export function searchComments(
  repo: string,
  pattern: string,
  opts: { ignoreCase?: boolean; maxResults?: number } = {},
): CommentMatch[] {
  const maxResults = opts.maxResults ?? 50
  const re = new RegExp(pattern, opts.ignoreCase ? "i" : "")

  // Comments in reverse-chronological order, newest first.
  const sql =
    "SELECT substr(b.uuid,1,10), datetime(e.mtime), e.comment " +
    "FROM event e JOIN blob b ON b.rid=e.objid " +
    "WHERE e.type='ci' ORDER BY e.mtime DESC"

  // Changed files per check-in: mlink JOIN filename (fid=0 ⇒ the file was deleted in that check-in).
  const filesByCheckin = new Map<string, string[]>()
  const filesSql =
    "SELECT substr(b.uuid,1,10), f.name " +
    "FROM event e JOIN blob b ON b.rid=e.objid " +
    "JOIN mlink m ON m.mid=e.objid JOIN filename f ON f.fnid=m.fnid " +
    "WHERE e.type='ci' ORDER BY e.mtime DESC"

  let stdout = ""
  let filesOut = ""
  try {
    const { execFileSync } = require("child_process") as typeof import("child_process")
    stdout = execFileSync(FOSSIL_BIN, ["sql", "-R", repo, sql], {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    filesOut = execFileSync(FOSSIL_BIN, ["sql", "-R", repo, filesSql], {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (e: any) {
    // A repo that fails to open is NAMED — an auditable zero is never a silent skip.
    throw new Error(`fossilgrep: cannot open repo ${repo}: ${e.stderr ?? e.message ?? String(e)}`)
  }

  for (const line of filesOut.split("\n")) {
    const sep = line.indexOf("|")
    if (sep <= 0) continue
    const hash = line.slice(0, sep)
    const file = line.slice(sep + 1).replace(/\r$/, "")
    if (!hash || !file) continue
    const list = filesByCheckin.get(hash) ?? []
    list.push(file)
    filesByCheckin.set(hash, list)
  }

  const matches: CommentMatch[] = []
  for (const line of stdout.split("\n")) {
    const sep = line.indexOf("|")
    if (sep <= 0) continue
    const checkin = line.slice(0, sep)
    const rest = line.slice(sep + 1)
    const dateSep = rest.indexOf("|")
    if (dateSep <= 0) continue
    const date = rest.slice(0, dateSep).replace(/\r$/, "")
    const comment = rest.slice(dateSep + 1).replace(/\r$/, "")
    if (!re.test(comment)) continue
    const svMatch = comment.match(/\bsv:([0-9a-f]{32})\b/)
    const dominantMatch = comment.match(/\bdominant=([^\n]*)/)
    matches.push({
      checkin,
      date,
      comment,
      dominant: dominantMatch?.[1],
      sv: svMatch?.[1],
      files: filesByCheckin.get(checkin) ?? [],
    })
    if (matches.length >= maxResults) break
  }
  return matches
}

/** The snapshot.fsl repos out of a `fossil all list` output — one path per line. */
export function parseRepoList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.toLowerCase().endsWith("snapshot.fsl"))
}

/** The project name a snapshot repo belongs to: the worktree dir above its data/fossil layout. */
export function projectNameOf(repo: string): string {
  const norm = repo.replaceAll("\\", "/")
  const marker =
    norm.match(/^(.*)\/(?:\.opencode|\.smit)\/data\/fossil\//) ?? norm.match(/^(.*)\/data\/fossil\//)
  if (marker) {
    const parts = marker[1]!.split("/")
    return parts[parts.length - 1] || marker[1]
  }
  const parts = norm.split("/")
  return parts[parts.length - 3] || norm
}

/** Every registered snapshot repo on this host — the federation's registry (read-only). */
export async function registeredSnapshotRepos(): Promise<string[]> {
  const r = await fossilAsync(["all", "list"], process.cwd())
  if (r.code !== 0 && !r.stdout.trim()) throw new Error(`fossil all list failed: ${r.stderr || "no output"}`)
  return parseRepoList(r.stdout)
}

function formatCommentMatches(project: string, matches: CommentMatch[]): string {
  const lines = [`## ${project} — ${matches.length} match(es)`]
  for (const m of matches) {
    lines.push(`[${m.checkin} · ${m.date}${m.sv ? ` · sv:${m.sv}` : ""}]`)
    if (m.dominant) lines.push(`  dominant: ${m.dominant}`)
    else lines.push(`  comment: ${m.comment}`)
    if (m.files.length > 0) lines.push(`  files: ${m.files.join(", ")}`)
  }
  return lines.join("\n")
}

export const FossilGrepTool = Tool.define(
  "fossilgrep",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: {
          pattern: string
          mode?: "files" | "comments"
          allProjects?: boolean
          files?: string[]
          ignoreCase?: boolean
          maxResults?: number
          once?: boolean
        },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const worktree = Global.Path.worktree || Global.Path.home

          // ── COMMENT MODE — the semantic-vector timeline (plan 2026-10-15_project-fossil-cell.md) ──
          if (params.mode === "comments") {
            const maxResults = params.maxResults ?? 50
            const ownDir = path.join(worktree, ".opencode", "data", "fossil")
            let repos: string[]
            if (params.allProjects) {
              repos = yield* Effect.promise(() => registeredSnapshotRepos())
            } else {
              const fs = require("fs") as typeof import("fs")
              let found: string | undefined
              try {
                for (const entry of fs.readdirSync(ownDir)) {
                  const candidate = path.join(ownDir, entry, "snapshot.fsl")
                  if (fs.existsSync(candidate)) {
                    found = candidate
                    break
                  }
                }
              } catch {
                // no fossil dir — reported below as the honest zero
              }
              if (!found) {
                return {
                  title: "fossilgrep comments",
                  metadata: { matches: 0 },
                  output: `No snapshot repo under ${ownDir} — this project has no fossil cell yet.`,
                }
              }
              repos = [found]
            }

            const sections: string[] = []
            let total = 0
            let failed = 0
            for (const repo of repos) {
              const project = projectNameOf(repo)
              try {
                const matches = searchComments(repo, params.pattern, {
                  ignoreCase: params.ignoreCase,
                  maxResults,
                })
                total += matches.length
                if (matches.length > 0) sections.push(formatCommentMatches(project, matches))
              } catch (e) {
                // A repo that fails to open is NAMED — an auditable zero, never a silent skip.
                failed++
                sections.push(`## ${project} — FAILED to open\n  ${repo}\n  ${e instanceof Error ? e.message : String(e)}`)
              }
            }
            const head = `fossilgrep comments "${params.pattern}" — ${total} match(es) across ${repos.length} repo(s)${failed > 0 ? `, ${failed} failed (named below)` : ""}`
            return {
              title: head,
              metadata: { matches: total, repos: repos.length, failed } as Record<string, unknown>,
              output: sections.length > 0 ? `${head}\n\n${sections.join("\n\n")}` : `${head}\n\nNo matches.`,
            }
          }

          // Get file list
          let files = params.files ?? []
          if (files.length === 0) {
            const ls = yield* Effect.promise(() => fossilAsync(["ls"], worktree))
            if (ls.code !== 0) {
              return { title: "fossil grep", metadata: { matches: 0 }, output: `Error: fossil not available or no repo: ${ls.stderr}` }
            }
            files = ls.stdout.trim().split("\n").filter(Boolean)
          }

          if (files.length === 0) {
            return { title: "fossil grep", metadata: { matches: 0 }, output: "No files to search." }
          }

          // Build grep args
          const args = ["grep"]
          if (params.ignoreCase) args.push("-i")
          if (params.once) args.push("--once")
          args.push(params.pattern)
          args.push(...files)

          const result = yield* Effect.promise(() => fossilAsync(args, worktree))

          if (result.code !== 0 && !result.stdout) {
            return {
              title: "fossil grep",
              metadata: { matches: 0 },
              output: `No matches found for: ${params.pattern}\n${result.stderr ? `Error: ${result.stderr}` : ""}`,
            }
          }

          // Parse output: == DATE FILE HASH checkin FULL_HASH  /  LINE:CONTENT
          const lines = result.stdout.trim().split("\n").filter(Boolean)
          const maxResults = params.maxResults ?? 50
          const parsed: string[] = []
          let totalMatches = 0

          for (const line of lines) {
            if (parsed.length >= maxResults) {
              parsed.push(`... (${lines.length - parsed.length - totalMatches} more results)`)
              break
            }

            if (line.startsWith("== ")) {
              const parts = line.split(/\s+/)
              const file = parts[2] ?? ""
              const hash = parts[3] ?? ""
              const checkin = parts[5] ?? ""
              parsed.push(`\n[${file}] version ${hash} (${checkin})`)
              continue
            }

            if (line.match(/^\d+:/)) {
              totalMatches++
              parsed.push(`  ${line}`)
            }
          }

          const output = parsed.length > 0 ? parsed.join("\n") : `No matches for: ${params.pattern}`

          return {
            title: `fossil grep: ${params.pattern}`,
            metadata: { matches: totalMatches },
            output,
          }
        }),
    }
  }),
)
