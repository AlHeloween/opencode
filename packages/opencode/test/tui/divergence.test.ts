import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectTranscript } from "../../src/cli/cmd/tui/util/divergence"
import { createDivergenceReporter } from "../../src/cli/cmd/tui/util/divergence-reporter"

const input = (overrides: Partial<Parameters<typeof inspectTranscript>[0]> = {}) => ({
  sessionID: "ses_1",
  status: "idle",
  arrived: [] as string[],
  held: [] as string[],
  listed: [] as string[],
  ...overrides,
})

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const file = () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-trace-"))
  dirs.push(dir)
  return join(dir, "nested", "trace.jsonl")
}
const records = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line))

describe("TUI transcript observation", () => {
  test("initial empty state is recorded as unknown, then a healthy arrival is recorded without a finding", () => {
    const path = file()
    const reporter = createDivergenceReporter(path, () => {})
    reporter.observe(input())
    reporter.observe(input({ status: "busy", arrived: ["m1"], held: ["m1"], listed: ["m1"] }))
    const rows = records(path)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: "snapshot", arrivedCount: 0, heldCount: 0, listedCount: 0, status: "idle" })
    expect(rows[1]).toMatchObject({ kind: "snapshot", arrivedCount: 1, heldCount: 1, listedCount: 1, status: "busy", hiddenCount: 0, missingStoreCount: 0 })
  })

  test("same state, including repeat observation of the first id, is written only once", () => {
    const path = file()
    const reporter = createDivergenceReporter(path, () => {})
    const state = input({ arrived: ["m1"], held: ["m1"], listed: ["m1"] })
    reporter.observe(state)
    reporter.observe(state)
    expect(records(path)).toHaveLength(1)
  })

  test("persisted evidence distinguishes hidden, missing-store and legitimate revert", () => {
    const path = file()
    const reporter = createDivergenceReporter(path, () => {})
    reporter.observe(input({ arrived: ["m1"], held: ["m1"], listed: [] }))
    reporter.observe(input({ arrived: ["m1", "m2"], held: ["m1"], listed: [] }))
    reporter.observe(input({ arrived: ["m1", "m2"], held: ["m1"], listed: [], revertID: "m1", exempt: (id) => id === "m1" ? "reverted run" : undefined }))
    const rows = records(path)
    expect(rows[0]).toMatchObject({ hiddenCount: 1, hidden: ["m1"], missingStoreCount: 0 })
    expect(rows[1]).toMatchObject({ hiddenCount: 1, missingStoreCount: 1, missingStore: ["m2"] })
    expect(rows[2]).toMatchObject({ hiddenCount: 0, missingStoreCount: 1, exempt: ["m1"], revertID: "m1" })
  })

  test("status and revert transitions are captured even without a new message", () => {
    const path = file()
    const reporter = createDivergenceReporter(path, () => {})
    reporter.observe(input())
    reporter.observe(input({ status: "busy", revertID: "m0" }))
    expect(records(path)).toHaveLength(2)
  })

  test("trace is bounded and contains IDs only, never message or part text", () => {
    const report = inspectTranscript(input({
      arrived: Array.from({ length: 100 }, (_, i) => `m${i}`),
      held: Array.from({ length: 100 }, (_, i) => `m${i}`),
      listed: [],
    }))
    expect(report.hiddenCount).toBe(100)
    expect(report.hidden.length).toBeLessThanOrEqual(40)
    expect(report.arrived.length).toBeLessThanOrEqual(40)
    expect(JSON.stringify(report)).not.toContain("messageText")
  })

  test("no observer call produces no file; write failure reports once without crashing TUI", () => {
    const path = file()
    createDivergenceReporter(path, () => {})
    expect(existsSync(path)).toBe(false)
    const failures: string[] = []
    const dir = mkdtempSync(join(tmpdir(), "tui-block-"))
    dirs.push(dir)
    const blocker = join(dir, "block")
    writeFileSync(blocker, "block")
    const unwritable = join(blocker, "child.jsonl")
    const reporter = createDivergenceReporter(unwritable, (error) => failures.push(String(error)))
    reporter.observe(input())
    reporter.observe(input({ status: "busy" }))
    expect(failures).toHaveLength(1)
    expect(existsSync(unwritable)).toBe(false)
  })
})
