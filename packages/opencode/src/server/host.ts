import { existsSync } from "fs"
import { randomBytes, randomUUID } from "crypto"
import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ServerHostTable } from "@/storage/schema-project.sql"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"

/**
 * One server per worktree database. The process serving a worktree's DB records itself in that DB's
 * `server_host` row; every later process (headless `run`, a second TUI, the robot) finds it there and
 * attaches as a client instead of booting a second writer with a second, invisible event bus.
 *
 * The record lives in the worktree DB itself (SQLite plane: read once per process start, never on the
 * interactive path — AGENTS § Storage Paradigm), so "which server owns this DB" is answered by the DB.
 *
 * Liveness is a nonce echo, not a pid: `/global/health` answers this process's `nonce`, and a record is
 * live only when its url answers with the nonce it recorded. A pid is reused after a reboot; a bare 200
 * may come from another worktree's host that inherited the port — attaching there would open THIS
 * database in THAT process, a second writer again.
 */

const log = Log.create({ service: "server.host" })
// A dead url is refused at once; the timeout only bounds a BUSY host. Measured 2026-10-02: a `run` host
// booting its turn answered health ~1.6 s late, and a 1 s probe had already called it stale.
const LIVENESS_TIMEOUT_MS = 5_000
const HOST_ID = "host"

/** Identity of this process as a host; echoed by `/global/health`. */
export const nonce = randomUUID()
/** Per-start command credential (32 random bytes). Read by same-user clients from the record, never served. */
export const token = randomBytes(32).toString("hex")

export type Record = typeof ServerHostTable.$inferSelect
export type ClaimResult = { won: boolean; host: Record }

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])
/** Host name of the in-process transports (TUI worker RPC, `run`'s own sdk) — never reachable from a socket. */
const INTERNAL = "opencode.internal"

let held: { worktree: string; loopback: boolean } | undefined

/** The live host of `worktree`, or undefined. Never creates the database. */
export async function lookup(worktree: string) {
  const row = read(worktree)
  if (!row) return undefined
  if (await isLive(row)) return row
  log.info("host record is stale", { worktree, url: row.url, pid: row.pid })
  return undefined
}

/**
 * Record this process as the host of `worktree`, unless a live host already holds it. A stale record is
 * replaced only if it is still the SAME stale record inside the write transaction, so of N processes
 * racing over one stale record exactly one wins and every loser is handed the winner.
 */
export async function claim(
  worktree: string,
  url: string,
  /** The interface actually listened on; only a loopback listener gets the Host-header guard. */
  hostname = new URL(url).hostname,
): Promise<ClaimResult> {
  const db = Database.getWorktreeDb(worktree)
  const before = db.select().from(ServerHostTable).where(eq(ServerHostTable.id, HOST_ID)).get()
  const stale = before && before.nonce !== nonce && !(await isLive(before)) ? before.nonce : undefined
  const mine = { id: HOST_ID, url, pid: process.pid, nonce, token, time_started: Date.now() }
  const result = db.transaction(
    (tx): ClaimResult => {
      const now = tx.select().from(ServerHostTable).where(eq(ServerHostTable.id, HOST_ID)).get()
      if (now && now.nonce !== nonce && now.nonce !== stale) return { won: false, host: now }
      tx.insert(ServerHostTable).values(mine).onConflictDoUpdate({ target: ServerHostTable.id, set: mine }).run()
      return { won: true, host: mine }
    },
    { behavior: "immediate" },
  )
  if (result.won) held = { worktree, loopback: LOOPBACK.has(hostname) }
  log.info(result.won ? "claimed host" : "host already held", { worktree, url: result.host.url, pid: result.host.pid })
  return result
}

/** Drop this process's record (a crash skips this; the nonce check makes the leftover stale). */
export function release(worktree: string) {
  Database.getWorktreeDb(worktree)
    .delete(ServerHostTable)
    .where(eq(ServerHostTable.nonce, nonce))
    .run()
  if (held?.worktree === worktree) held = undefined
  log.info("released host", { worktree })
}

/** True while this process is the recorded host of a worktree. */
export function holding() {
  return held !== undefined
}

/**
 * The password command routes require: an explicitly configured `OPENCODE_SERVER_PASSWORD` wins; otherwise
 * the per-start token while this process is a recorded host; otherwise none (a private in-process server).
 */
export function credential() {
  return Flag.OPENCODE_SERVER_PASSWORD ?? (held ? token : undefined)
}

/** `Authorization` value for in-process callers of this process's own server, if it requires one. */
export function authorization() {
  const password = credential()
  if (!password) return undefined
  return `Basic ${btoa(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`)}`
}

/**
 * DNS-rebinding guard: a loopback host answers only requests addressed to a loopback name or to the
 * in-process transport. A page on `evil.example` re-pointed at 127.0.0.1 still carries `evil.example`.
 */
export function allowsHost(hostname: string) {
  if (!held?.loopback) return true
  return LOOPBACK.has(hostname) || hostname === INTERNAL
}

function read(worktree: string) {
  if (!existsSync(Database.getProjectDbPath(worktree))) return undefined
  return Database.getWorktreeDb(worktree).select().from(ServerHostTable).where(eq(ServerHostTable.id, HOST_ID)).get()
}

function isLive(row: Record) {
  return fetch(new URL("/global/health", row.url), { signal: AbortSignal.timeout(LIVENESS_TIMEOUT_MS) })
    .then((res) => (res.ok ? (res.json() as Promise<{ host?: string }>) : undefined))
    .then((body) => body?.host === row.nonce)
    .catch((error) => {
      log.debug("host liveness probe failed", { url: row.url, error: String(error) })
      return false
    })
}

export * as ServerHost from "./host"
