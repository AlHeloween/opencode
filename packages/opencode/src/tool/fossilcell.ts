import { Effect, Schema } from "effect"
import { execFile } from "child_process"
import * as Tool from "./tool"
import { findFossil } from "./fossilgrep"
import { parseRepoList, projectNameOf } from "./fossilgrep"
import DESCRIPTION from "./fossilcell.txt"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tool.fossilcell" })

const FOSSIL_BIN = findFossil()

function fossilAsync(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      FOSSIL_BIN,
      args,
      { encoding: "utf-8", timeout: 30000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout: stdout ?? "", stderr: stderr ?? "" }),
    )
  })
}

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "wiki", "chat", "tickets"]).annotate({
    description:
      "list = every registered project cell (fossil all list); wiki = the Project card; chat = recent chat technotes; tickets = the local ticket table",
  }),
  project: Schema.optional(Schema.String).annotate({
    description: "Project name (worktree dir name, e.g. opencode). Omit = ALL registered projects.",
  }),
})

/**
 * THE CELL READ ROUTE (plan 2026-10-15_project-fossil-cell.md Phase C): a robot in ANY project
 * grounds on its neighbours' state before inventing (REUSE.BEFORE across the syndicate). Read-only
 * over local files only — every call is `fossil -R <repo>`; nothing is fetched, nothing is written.
 * A repo that fails to open is NAMED in the result — an auditable zero, never a silent skip.
 */
export const FossilCellTool = Tool.define(
  "fossilcell",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { action: "list" | "wiki" | "chat" | "tickets"; project?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const all = yield* Effect.promise(() => fossilAsync(["all", "list"]))
          if (all.code !== 0 && !all.stdout.trim()) {
            return {
              title: "fossilcell: registry unavailable",
              metadata: { projects: 0 },
              output: `Error: fossil all list failed: ${all.stderr || "no output"}`,
            }
          }
          let repos = parseRepoList(all.stdout)
          if (params.project) {
            repos = repos.filter((r) => projectNameOf(r).toLowerCase() === params.project!.toLowerCase())
            if (repos.length === 0) {
              return {
                title: `fossilcell: no such project`,
                metadata: { projects: 0 },
                output: `No registered project named "${params.project}". Call action="list" to see the registry.`,
              }
            }
          }

          if (params.action === "list") {
            const lines = repos.map((r) => `${projectNameOf(r)}  →  ${r}`)
            return {
              title: `fossilcell: ${repos.length} project cell(s)`,
              metadata: { projects: repos.length },
              output: lines.length > 0 ? lines.join("\n") : "No registered snapshot repos.",
            }
          }

          const sections: string[] = []
          let ok = 0
          let failed = 0
          for (const repo of repos) {
            const project = projectNameOf(repo)
            const r =
              params.action === "wiki"
                ? yield* Effect.promise(() => fossilAsync(["wiki", "-R", repo, "export", "Project", "-"]))
                : params.action === "chat"
                  ? yield* Effect.promise(() =>
                      fossilAsync([
                        "sql",
                        "-R",
                        repo,
                        "SELECT datetime(e.mtime), e.comment FROM event e WHERE e.type='e' ORDER BY e.mtime DESC LIMIT 20",
                      ]),
                    )
                  : yield* Effect.promise(() =>
                      fossilAsync([
                        "sql",
                        "-R",
                        repo,
                        "SELECT substr(tkt_uuid,1,10), status, title FROM ticket ORDER BY tkt_mtime DESC LIMIT 20",
                      ]),
                    )
            if (r.code !== 0) {
              failed++
              sections.push(`## ${project} — FAILED to open\n  ${repo}\n  ${r.stderr || r.stdout}`)
              continue
            }
            ok++
            if (params.action === "wiki") {
              const body = r.stdout.trim()
              sections.push(
                `## ${project}\n${body.length > 0 ? body : "(no Project card — the cell has not posted yet)"}`,
              )
            } else if (params.action === "chat") {
              const rows = r.stdout
                .split("\n")
                .filter((l) => l.trim().length > 0)
                .map((l) => `  ${l}`)
              sections.push(`## ${project} — ${rows.length} chat entr(y|ies)\n${rows.length > 0 ? rows.join("\n") : "  (no chat posts yet)"}`)
            } else {
              const rows = r.stdout
                .split("\n")
                .filter((l) => l.trim().length > 0)
                .map((l) => `  ${l}`)
              sections.push(`## ${project} — ${rows.length} ticket(s)\n${rows.length > 0 ? rows.join("\n") : "  (no local tickets)"}`)
            }
          }
          const head = `fossilcell ${params.action}: ${ok} project(s)${failed > 0 ? `, ${failed} failed (named below)` : ""}`
          return {
            title: head,
            metadata: { projects: ok, failed } as Record<string, unknown>,
            output: `${head}\n\n${sections.join("\n\n")}`,
          }
        }),
    }
  }),
)
