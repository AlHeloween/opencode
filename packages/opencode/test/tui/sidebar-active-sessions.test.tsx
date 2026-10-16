/** @jsxImportSource @opentui/solid */
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { testRender } from "@opentui/solid"
import {
  activeSessionRows,
  elapsedLabel,
  stateMeta,
} from "../../src/cli/cmd/tui/feature-plugins/sidebar/active-sessions"
import { SessionsView } from "../../src/cli/cmd/tui/feature-plugins/sidebar/sessions"
import { createTuiPluginApi } from "../fixture/tui-plugin"

setDefaultTimeout(20_000)

const NOW = 1_000_000

function statusMap(entries: Record<string, { type: string; attempt?: number }>) {
  return (sessionID: string) => entries[sessionID]
}

describe("active session rows", () => {
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
    expect(row.glyph).toBe("⏳")
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
    expect(stateMeta("warp").glyph).toBe("●")
    const rows = activeSessionRows({
      sessions: [{ id: "ses_weird0000", title: "Odd" }],
      statusOf: statusMap({ ses_weird0000: { type: "warp" } as any }),
      metaOf: () => undefined,
      busySince: new Map(),
      now: NOW,
    })
    expect(rows[0]!.state).toBe("unknown")
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

  test("elapsed grows with now — the 1 s tick contract", () => {
    const busySince = new Map<string, number>([["ses_busy00000", NOW]])
    const first = activeSessionRows({
      sessions: [{ id: "ses_busy00000", title: "Long run" }],
      statusOf: statusMap({ ses_busy00000: { type: "busy" } }),
      metaOf: () => undefined,
      busySince,
      now: NOW + 1_000,
    })
    const second = activeSessionRows({
      sessions: [{ id: "ses_busy00000", title: "Long run" }],
      statusOf: statusMap({ ses_busy00000: { type: "busy" } }),
      metaOf: () => undefined,
      busySince,
      now: NOW + 2_000,
    })
    expect(first[0]!.elapsedMs).toBe(1_000)
    expect(second[0]!.elapsedMs).toBe(2_000)
  })

  test("longest-running first", () => {
    const busySince = new Map<string, number>([
      ["ses_late000000", NOW - 1_000],
      ["ses_early00000", NOW - 60_000],
    ])
    const rows = activeSessionRows({
      sessions: [
        { id: "ses_late000000", title: "Late" },
        { id: "ses_early00000", title: "Early" },
      ],
      statusOf: statusMap({ ses_late000000: { type: "busy" }, ses_early00000: { type: "busy" } }),
      metaOf: () => undefined,
      busySince,
      now: NOW,
    })
    expect(rows.map((r) => r.sessionID)).toEqual(["ses_early00000", "ses_late000000"])
  })

  test("elapsed label never renders blank", () => {
    expect(elapsedLabel(0)).toBe("0s")
    expect(elapsedLabel(65_000)).toBe("1m 5s")
  })
})

describe("active sessions block", () => {
  function apiWith(status: (sessionID: string) => any) {
    return createTuiPluginApi({
      state: {
        session: {
          count: () => 1,
          list: () => [{ id: "ses_robot1234abcd", title: "robot-wave:t52" }] as any,
          status,
          messages: () =>
            [
              { id: "msg_1", role: "user", agent: "build", model: { providerID: "deepseek", modelID: "deepseek-flash" } },
            ] as any,
          diff: () => [],
          todo: () => [],
          permission: () => [],
          question: () => [],
          jobs: () => [],
        },
      },
    })
  }

  test("a busy session is listed in the rendered block", async () => {
    const api = apiWith((id) => (id === "ses_robot1234abcd" ? { type: "busy" } : undefined))
    const setup = await testRender(() => <SessionsView api={api} session_id="ses_main" />, {
      width: 44,
      height: 12,
      useThread: false,
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      await setup.renderOnce()
      await (setup.renderer as any).idle()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("robot-wave:t52")
      expect(frame).toContain("working")
      expect(frame.includes("none active")).toBe(false)
    } finally {
      ;(setup.renderer as any).destroy()
    }
  })

  test("an idle server shows «none active», never an empty block", async () => {
    const api = apiWith(() => undefined)
    const setup = await testRender(() => <SessionsView api={api} session_id="ses_main" />, {
      width: 44,
      height: 12,
      useThread: false,
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      await setup.renderOnce()
      await (setup.renderer as any).idle()
      expect(setup.captureCharFrame()).toContain("none active")
    } finally {
      ;(setup.renderer as any).destroy()
    }
  })
})
