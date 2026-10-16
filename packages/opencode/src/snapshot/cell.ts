import { execFile } from "child_process"
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "snapshot.cell" })

/**
 * THE PROJECT CELL (plan 2026-10-15_project-fossil-cell.md, owner 2026-10-15: «сделать локальную
 * ячейку… в чате все роботы которые работали над проектом пишут краткий отчет»).
 *
 * The cell lives IN the project's own snapshot.fsl — B1 verdict: the snapshot lifecycle (commit /
 * checkout / revertTo) never touches wiki or ticket events, and the one destructive path
 * (corruption reinit) keeps a .bak backup, so cell data is exactly as fragile as the undo timeline
 * itself. No sibling repo.
 *
 * Two roles, one copy each:
 * - **wiki** — one `Project` page per project, POINTERS ONLY (one-copy rule): it names where the
 *   truth lives (AGENTS.md, README, docs, plans) and never restates it. Created when missing.
 * - **chat** — one TECHNOTE per turn (`--technote now --technote-tags chat`), the same mechanism
 *   org.py's `create_technote` uses in production. The comment carries agent + dominant + session,
 *   so the chat is searchable by meaning with the same regex machinery as the check-in comments.
 *
 * Plain async functions with explicit dependencies (fossil binary, repo path, worktree) — the
 * snapshot layer owns locking and gating; these functions own the fossil calls. Read-only on
 * nothing: they WRITE the cell, and only into the repo file — never the worktree.
 */

const CARD_PAGE = "Project"

function fossil(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      args[0]!,
      args.slice(1),
      { cwd, encoding: "utf-8", timeout: 30000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout: stdout ?? "", stderr: stderr ?? "" }),
    )
  })
}

/**
 * The card's markdown, from what actually exists on disk — a pointer to a file that is not there
 * would be a lie, so each bullet is included only when its target exists. The content is POINTERS,
 * never restatement (one-copy rule).
 */
export function cellCardMarkdown(worktree: string): string {
  const pointers: string[] = []
  const candidates: [string, string][] = [
    ["AGENTS.md", "rules, governance, conventions"],
    ["README.md", "what this project is"],
    ["docs/README.md", "the documentation index"],
    ["plans/MASTER_PLAN.md", "the direction"],
  ]
  for (const [file, what] of candidates) {
    if (existsSync(path.join(worktree, file))) pointers.push(`- \`${file}\` — ${what}`)
  }
  return [
    "# Project",
    "",
    "The local cell of this project's fossil snapshot repo. This card POINTS to the project's own",
    "documents — it never restates them (one-copy rule).",
    "",
    "## Where the truth lives",
    ...(pointers.length > 0 ? pointers : ["- (no standard project documents found on disk)"]),
    "",
    "## Chat",
    "Every robot session posts a short turn report here (technote tagged `chat`).",
    "Read: `fossil timeline -t e -R <repo>` · `fossil wiki -R <repo> list -t`",
    "",
    "## Tickets",
    "Local tickets live in this repo's ticket table; cross-project delegation stays in org.fossil.",
    "",
  ].join("\n")
}

/** True when the `Project` page already exists (fossil lists wiki pages case-insensitively). */
async function cardExists(fossilBin: string, repoPath: string, cwd: string): Promise<boolean> {
  const r = await fossil([fossilBin, "wiki", "-R", repoPath, "list"], cwd)
  if (r.code !== 0) return false
  return r.stdout
    .split("\n")
    .some((line) => line.trim().toLowerCase() === CARD_PAGE.toLowerCase())
}

/**
 * Create the card when missing. Returns whether the repo now carries it — false is a logged
 * finding, never an exception: a cell that cannot be written must not break the turn that tried.
 */
export async function ensureWikiCard(fossilBin: string, repoPath: string, worktree: string): Promise<boolean> {
  if (await cardExists(fossilBin, repoPath, worktree)) return true
  const dir = mkdtempSync(path.join(tmpdir(), "fossil-cell-"))
  try {
    const file = path.join(dir, "card.md")
    writeFileSync(file, cellCardMarkdown(worktree), "utf-8")
    const r = await fossil(
      [fossilBin, "wiki", "-R", repoPath, "create", CARD_PAGE, file, "--mimetype", "text/x-markdown"],
      worktree,
    )
    if (r.code !== 0) {
      log.warn("bug: cell wiki card create failed", { repoPath, stderr: r.stderr || r.stdout })
      return false
    }
    log.info("cell wiki card created", { repoPath })
    return true
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      log.debug("cell card temp cleanup failed", { error: String(e) })
    }
  }
}

export type CellReport = {
  sessionID: string
  agent?: string
  /** The turn's `vectorSign` — `sv:<md5> dominant=<…>`; absent when the reply declared no vector. */
  sign?: string
}

/** The dominant out of the sign, capped like `vectorSign` caps it. */
function dominantOf(sign: string | undefined): string {
  const raw = sign?.match(/\bdominant=([^\n]*)/)?.[1]?.trim()
  if (!raw) return "no vector declared"
  return raw.length > 80 ? raw.slice(0, 80) : raw
}

/**
 * One chat technote per call — the runtime calls this at the turn-end boundary, once per turn.
 * The comment is the searchable address (`chat <agent>: <dominant> (session <id8>)`); the body is
 * the short report. A name collision (same second, same text) retries once with the session id.
 */
export async function postChatReport(fossilBin: string, repoPath: string, worktree: string, input: CellReport): Promise<boolean> {
  const dominant = dominantOf(input.sign)
  const agent = input.agent && input.agent.length > 0 ? input.agent : "unknown"
  const session8 = input.sessionID.slice(0, 8)
  const md5 = input.sign?.match(/\bsv:([0-9a-f]{32})\b/)?.[1]
  // The comment is the searchable address, shaped like the check-in sign: the vector's md5 makes
  // the report addressable by the same 32-hex handle the snapshot carries.
  const name = `chat ${agent}${md5 ? ` sv:${md5}` : ""}: ${dominant} (session ${session8})`
  const body = [
    "# Turn report",
    "",
    `- agent: ${agent}`,
    `- session: ${input.sessionID}`,
    `- time: ${new Date().toISOString()}`,
    `- dominant: ${dominant}`,
    ...(md5 ? [`- sv md5: ${md5}`] : []),
    "",
  ].join("\n")

  const dir = mkdtempSync(path.join(tmpdir(), "fossil-cell-"))
  try {
    const file = path.join(dir, "report.md")
    writeFileSync(file, body, "utf-8")
    const args = (title: string) => [
      fossilBin,
      "wiki",
      "-R",
      repoPath,
      "create",
      title,
      file,
      "--technote",
      "now",
      "--technote-tags",
      "chat",
      "--mimetype",
      "text/x-markdown",
    ]
    let r = await fossil(args(name), worktree)
    if (r.code !== 0 && /exist/i.test(r.stderr + r.stdout)) {
      r = await fossil(args(`${name} [${session8}]`), worktree)
    }
    if (r.code !== 0) {
      log.warn("bug: cell chat post failed", { repoPath, stderr: r.stderr || r.stdout })
      return false
    }
    log.info("cell chat posted", { repoPath, agent, dominant })
    return true
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      log.debug("cell report temp cleanup failed", { error: String(e) })
    }
  }
}

/**
 * The whole cell post: the card once (create-if-missing — the self-healing upkeep), then the chat
 * report. The card failing does not stop the report; the report failing does not throw — the
 * caller logs and moves on.
 */
export async function cellPost(fossilBin: string, repoPath: string, worktree: string, input: CellReport): Promise<void> {
  await ensureWikiCard(fossilBin, repoPath, worktree)
  await postChatReport(fossilBin, repoPath, worktree, input)
}

export type TicketInput = {
  title: string
  comment?: string
  status?: string
}

export type TicketFields = {
  title?: string
  comment?: string
  status?: string
}

/**
 * LOCAL TICKETS (plan 2026-10-15_local-ticket-write.md, owner 2026-10-15:
 * «Локальные тикеты через fossil ticket add, делегирование в org»).
 *
 * The arg builders are the single home of the ticket CLI syntax
 * (`external/fossil/fossil-src-2.28/src/tkt.c`): `fossil ticket add FIELD VALUE …`
 * prints `ticket add succeeded for <uuid40>`; `fossil ticket set UUID FIELD VALUE …`
 * resolves the uuid by prefix GLOB. The `-R` placement mirrors the measured wiki
 * form (`wiki -R <repo> create …`). No `-U`: the repo default user applies, the same
 * as the snapshot commit path. Returned without the binary so the snapshot service
 * (spawner) and these plain fns (execFile) share one syntax.
 */
export function ticketAddArgs(repoPath: string, input: TicketInput): string[] {
  const args = ["ticket", "-R", repoPath, "add", "title", input.title]
  if (input.status) args.push("status", input.status)
  if (input.comment) args.push("comment", input.comment)
  return args
}

export function ticketSetArgs(repoPath: string, uuid: string, fields: TicketFields): string[] {
  const args = ["ticket", "-R", repoPath, "set", uuid]
  if (fields.title) args.push("title", fields.title)
  if (fields.status) args.push("status", fields.status)
  if (fields.comment) args.push("comment", fields.comment)
  return args
}

/** The new ticket's uuid out of `ticket add` stdout; null when fossil said otherwise. */
export function parseTicketAddUuid(stdout: string): string | null {
  const match = stdout.match(/ticket add succeeded for ([0-9a-f]{40})/)
  return match?.[1] ?? null
}

/**
 * One local ticket in THIS repo's ticket table. Returns the full uuid, or null —
 * a logged finding, never an exception, like every other cell writer.
 */
export async function addTicket(
  fossilBin: string,
  repoPath: string,
  worktree: string,
  input: TicketInput,
): Promise<string | null> {
  if (!input.title.trim()) {
    log.warn("bug: cell ticket add refused — empty title", { repoPath })
    return null
  }
  const r = await fossil([fossilBin, ...ticketAddArgs(repoPath, input)], worktree)
  if (r.code !== 0) {
    log.warn("bug: cell ticket add failed", { repoPath, stderr: r.stderr || r.stdout })
    return null
  }
  const uuid = parseTicketAddUuid(r.stdout)
  if (!uuid) {
    log.warn("bug: cell ticket add unparseable", { repoPath, stdout: r.stdout })
    return null
  }
  log.info("cell ticket added", { repoPath, uuid: uuid.slice(0, 10) })
  return uuid
}

/**
 * Set fields on a local ticket by uuid prefix. Unknown ticket or repo failure is
 * false — a logged finding, never a throw.
 */
export async function setTicketFields(
  fossilBin: string,
  repoPath: string,
  worktree: string,
  uuid: string,
  fields: TicketFields,
): Promise<boolean> {
  if (fields.title === undefined && fields.status === undefined && fields.comment === undefined) {
    log.warn("bug: cell ticket set refused — no fields", { repoPath, uuid: uuid.slice(0, 10) })
    return false
  }
  const r = await fossil([fossilBin, ...ticketSetArgs(repoPath, uuid, fields)], worktree)
  if (r.code !== 0) {
    log.warn("bug: cell ticket set failed", {
      repoPath,
      uuid: uuid.slice(0, 10),
      stderr: r.stderr || r.stdout,
    })
    return false
  }
  log.info("cell ticket set", { repoPath, uuid: uuid.slice(0, 10) })
  return true
}
