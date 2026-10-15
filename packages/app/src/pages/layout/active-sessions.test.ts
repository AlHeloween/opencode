import { describe, expect, test } from "bun:test"
import { activeSessionRows, elapsedLabel, stateMeta } from "./active-sessions"

const NOW = 1_000_000

function statusMap(entries: Record<string, { type: string; attempt?: number }>) {
  return (sessionID: string) => entries[sessionID]
}

describe("web active session rows", () => {
  test("lists a busy session with title, agent, model, state, elapsed and short id", () => {
    const rows = activeSessionRows({
      sessions: [{ id: "ses_robot1234abcd", title: "robot-wave:t52" }],
      statusOf: statusMap({ ses_robot1234abcd: { type: "busy" } }),
      metaOf: () => ({ agent: "build", model: "deepseek/deepseek-flash" }),
      busySince: new Map(),
      now: NOW,
    })
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.title).toBe("robot-wave:t52")
    expect(row.agent).toBe("build")
    expect(row.model).toBe("deepseek/deepseek-flash")
    expect(row.state).toBe("working")
    expect(row.shortID).toBe("ses_robo")
    expect(row.elapsedMs).toBe(0)
  })

  test("a retrying session carries its attempt", () => {
    const rows = activeSessionRows({
      sessions: [{ id: "ses_retry0000", title: "Main work" }],
      statusOf: statusMap({ ses_retry0000: { type: "retry", attempt: 3 } }),
      metaOf: () => undefined,
      busySince: new Map(),
      now: NOW,
    })
    expect(rows[0]!.state).toBe("retrying")
    expect(rows[0]!.attempt).toBe(3)
  })

  test("an unrecognized status type reads as unknown, never blank", () => {
    expect(stateMeta("warp").label).toBe("unknown")
    const rows = activeSessionRows({
      sessions: [{ id: "ses_weird0000", title: "Odd" }],
      statusOf: statusMap({ ses_weird0000: { type: "warp" } }),
      metaOf: () => undefined,
      busySince: new Map(),
      now: NOW,
    })
    expect(rows[0]!.state).toBe("unknown")
    expect(rows[0]!.state.length).toBeGreaterThan(0)
  })

  test("idle and missing statuses are not listed and clear their busy stamp", () => {
    const busySince = new Map<string, number>([["ses_done00000", NOW - 5_000]])
    const rows = activeSessionRows({
      sessions: [
        { id: "ses_done00000", title: "Finished" },
        { id: "ses_never0000", title: "Untouched" },
      ],
      statusOf: statusMap({ ses_done00000: { type: "idle" } }),
      metaOf: () => undefined,
      busySince,
      now: NOW,
    })
    expect(rows).toHaveLength(0)
    expect(busySince.has("ses_done00000")).toBe(false)
  })

  test("elapsed ticks with now and sorts longest-first", () => {
    const busySince = new Map<string, number>([
      ["ses_old0000000", NOW - 9_000],
      ["ses_new0000000", NOW - 1_000],
    ])
    const rows = activeSessionRows({
      sessions: [
        { id: "ses_new0000000", title: "New" },
        { id: "ses_old0000000", title: "Old" },
      ],
      statusOf: statusMap({ ses_new0000000: { type: "busy" }, ses_old0000000: { type: "busy" } }),
      metaOf: () => undefined,
      busySince,
      now: NOW,
    })
    expect(rows.map((r) => r.sessionID)).toEqual(["ses_old0000000", "ses_new0000000"])
    expect(rows[0]!.elapsedMs).toBe(9_000)
  })

  test("missing agent/model read as unknown, never blank", () => {
    const rows = activeSessionRows({
      sessions: [{ id: "ses_bare000000", title: "Bare" }],
      statusOf: statusMap({ ses_bare000000: { type: "compacting" } }),
      metaOf: () => undefined,
      busySince: new Map(),
      now: NOW,
    })
    expect(rows[0]!.agent).toBe("unknown")
    expect(rows[0]!.model).toBe("unknown")
    expect(rows[0]!.state).toBe("compacting")
  })
})

describe("elapsedLabel", () => {
  test("never blank: sub-second reads 0s", () => {
    expect(elapsedLabel(0)).toBe("0s")
    expect(elapsedLabel(400)).toBe("0s")
  })
  test("mirrors the TUI duration shape", () => {
    expect(elapsedLabel(5_000)).toBe("5s")
    expect(elapsedLabel(65_000)).toBe("1m 5s")
    expect(elapsedLabel(3_600_000)).toBe("1h")
  })
})
