import { Effect, Schema } from "effect"
import { execFile } from "child_process"
import path from "path"
import * as Tool from "./tool"
import { findFossil } from "./fossilgrep"
import { parseRepoList, projectNameOf } from "./fossilgrep"
import DESCRIPTION from "./fossilcell.txt"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
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
  action: Schema.Literals(["list", "wiki", "chat", "tickets", "ticketadd", "ticketset"]).annotate({
    description:
      "list = every registered project cell (fossil all list); wiki = the Project card; chat = recent chat technotes; tickets = the local ticket table; ticketadd/ticketset = write THIS project's own tickets (foreign writes refused)",
  }),
  project: Schema.optional(Schema.String).annotate({
    description: "Project name (worktree dir name, e.g. opencode). Omit = ALL registered projects.",
  }),
  title: Schema.optional(Schema.String).annotate({
    description: "ticketadd: the new ticket's title (required); ticketset: the new title.",
  }),
  comment: Schema.optional(Schema.String).annotate({
    description: "ticketadd/ticketset: the ticket comment field.",
  }),
  status: Schema.optional(Schema.String).annotate({
    description: "ticketadd/ticketset: the ticket status field (e.g. Open, Fixed).",
  }),
  uuid: Schema.optional(Schema.String).annotate({
    description: "ticketset: the ticket uuid (or its prefix) to update (required).",
  }),
})

/**
 * LOCAL TICKET WRITE (plan 2026-10-15_local-ticket-write.md): the write verbs target
 * the OWN repo only — the identical path the snapshot service builds
 * (`<worktree>/.opencode/data/fossil/<project.id>/snapshot.fsl`, fossil.ts). No new
 * discovery; a `project` param naming anything else is a foreign cell and refused.
 */
export function ownRepoPath(worktree: string, projectID: string): string {
  return path.join(worktree, ".opencode", "data", "fossil", projectID, "snapshot.fsl")
}

/** True when `requested` names a different project than the own cell — write refused. */
export function isForeignProject(requested: string | undefined, own: string): boolean {
  if (!requested) return false
  return requested.toLowerCase() !== own.toLowerCase()
}

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
execute: (
        params: {
          action: "list" | "wiki" | "chat" | "tickets" | "ticketadd" | "ticketset"
          project?: string
          title?: string
          comment?: string
          status?: string
          uuid?: string
        },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          if (params.action === "ticketadd" || params.action === "ticketset") {
            const ownRepo = ownRepoPath(Instance.worktree, Instance.project.id)
            const ownName = projectNameOf(ownRepo)
            if (isForeignProject(params.project, ownName)) {
              return {
                title: "fossilcell: foreign cell write refused",
                metadata: { projects: 0 },
                output: `Refused: writing another project's cell is not this tool's job (requested "${params.project}", this cell is "${ownName}"). Cross-project delegation lives in org.fossil.`,
              }
            }
            const snap = yield* Effect.serviceOption(Snapshot.Service)
            if (snap._tag === "None") {
              return {
                title: "fossilcell: snapshot service unavailable",
                metadata: { projects: 0 },
                output:
                  "Error: the Snapshot service is not in scope, so the write cannot run under the per-repo semaphore — refusing rather than writing unlocked.",
              }
            }
            if (params.action === "ticketadd") {
              if (!params.title?.trim()) {
                return {
                  title: "fossilcell: ticketadd needs a title",
                  metadata: { projects: 0 },
                  output: "Error: ticketadd requires a non-empty title.",
                }
              }
              const uuid = yield* snap.value.ticketAdd({
                title: params.title,
                comment: params.comment,
                status: params.status,
              })
              if (!uuid) {
                return {
                  title: "fossilcell: ticket add failed",
                  metadata: { projects: 0 },
                  output: `Error: the ticket was not created in ${ownName}'s cell (see the snapshot.cell log).`,
                }
              }
              return {
                title: `fossilcell: ticket ${uuid.slice(0, 10)} added`,
                metadata: { projects: 1, uuid } as Record<string, unknown>,
                output: `Ticket ${uuid} ("${params.title}") added to ${ownName}'s cell.`,
              }
            }
            if (!params.uuid?.trim()) {
              return {
                title: "fossilcell: ticketset needs a uuid",
                metadata: { projects: 0 },
                output: "Error: ticketset requires the ticket uuid (or its prefix).",
              }
            }
            if (params.title === undefined && params.status === undefined && params.comment === undefined) {
              return {
                title: "fossilcell: ticketset needs a field",
                metadata: { projects: 0 },
                output: "Error: ticketset requires at least one of title, status, comment.",
              }
            }
            const ok = yield* snap.value.ticketSet({
              uuid: params.uuid,
              title: params.title,
              comment: params.comment,
              status: params.status,
            })
            if (!ok) {
              return {
                title: "fossilcell: ticket set failed",
                metadata: { projects: 0 },
                output: `Error: ticket ${params.uuid} was not updated in ${ownName}'s cell (unknown ticket or repo failure — see the snapshot.cell log).`,
              }
            }
            return {
              title: `fossilcell: ticket ${params.uuid.slice(0, 10)} updated`,
              metadata: { projects: 1, uuid: params.uuid } as Record<string, unknown>,
              output: `Ticket ${params.uuid} updated in ${ownName}'s cell.`,
            }
          }
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
