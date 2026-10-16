import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { execFileSync } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import path from "path"
import os from "os"

// t62 (plan 2026-10-15_local-ticket-write.md T1 RED): the cell ticket write fns on a
// fixture snapshot.fsl. Real fossil binary, real repo — no mocks, like cell.test.ts.

import { addTicket, setTicketFields } from "../../src/snapshot/cell"

function findFossil(): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "tools", "fossil.exe"),
    path.join(process.cwd(), "..", "..", "external", "fossil", "fossil.exe"),
  ]
  for (const c of candidates) {
    const resolved = path.resolve(c)
    if (existsSync(resolved)) return resolved
  }
  throw new Error("fossil not found")
}

const FOSSIL = findFossil()
const TMP = path.join(os.tmpdir(), `fossil_cell_ticket_${Date.now()}`)
const REPO = path.join(TMP, "snapshot.fsl")

function fossil(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(FOSSIL, args, { cwd: cwd ?? TMP, encoding: "utf-8", timeout: 15000 })
    return { code: 0, stdout, stderr: "" }
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" }
  }
}

/** The exact SELECT the fossilcell `tickets` read route runs — the write's read-back. */
function fossilcellTicketsReadback(): string {
  return fossil([
    "sql",
    "-R",
    REPO,
    "SELECT substr(tkt_uuid,1,10), status, title FROM ticket ORDER BY tkt_mtime DESC LIMIT 20",
  ]).stdout
}

function ticketRow(uuid10: string): string {
  return fossil([
    "sql",
    "-R",
    REPO,
    `SELECT status || '|' || title FROM ticket WHERE tkt_uuid LIKE '${uuid10}%'`,
  ]).stdout.trim()
}

beforeAll(() => {
  mkdirSync(TMP, { recursive: true })
  fossil(["init", REPO])
  fossil(["open", REPO, "--keep", "--nested"])
  writeFileSync(path.join(TMP, "a.txt"), "alpha\n")
  fossil(["add", "a.txt"])
  fossil(["commit", "-m", "auto-snapshot", "--no-warnings"])
})

afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch {}
})

describe("cell local tickets", () => {
  test("addTicket creates a ticket readable by the fossilcell tickets SELECT", async () => {
    const uuid = await addTicket(FOSSIL, REPO, TMP, { title: "t62 probe ticket", status: "Open" })
    expect(uuid).toMatch(/^[0-9a-f]{40}$/)
    const back = fossilcellTicketsReadback()
    expect(back).toContain(uuid!.slice(0, 10))
    expect(back).toContain("t62 probe ticket")
  })

  test("setTicketFields updates status/title, read back by uuid", async () => {
    const uuid = await addTicket(FOSSIL, REPO, TMP, { title: "t62 mutable ticket" })
    expect(uuid).toMatch(/^[0-9a-f]{40}$/)
    expect(await setTicketFields(FOSSIL, REPO, TMP, uuid!, { status: "Fixed", title: "t62 fixed ticket" })).toBe(
      true,
    )
    expect(ticketRow(uuid!.slice(0, 10))).toBe("Fixed|t62 fixed ticket")
  })

  test("setTicketFields on an unknown ticket is false, never a throw", async () => {
    await expect(setTicketFields(FOSSIL, REPO, TMP, "deadbeef", { status: "Fixed" })).resolves.toBe(false)
  })

  test("a repo that cannot be written is null/false, never a throw", async () => {
    const missing = path.join(TMP, "does-not-exist.fsl")
    await expect(addTicket(FOSSIL, missing, TMP, { title: "x" })).resolves.toBeNull()
    await expect(setTicketFields(FOSSIL, missing, TMP, "deadbeef", { status: "Fixed" })).resolves.toBe(false)
  })
})
