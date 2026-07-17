import { describe, expect, test } from "bun:test"
import {
  computeScrollPosition,
  countMessagesAbove,
  formatScrollChip,
  isAtLiveEdge,
  LIVE_EDGE_TOLERANCE,
  scrollMax,
} from "../../../src/cli/cmd/tui/util/scroll-position"
import { Keybind } from "../../../src/util/keybind"

describe("scrollMax / isAtLiveEdge", () => {
  test("no overflow is always live", () => {
    const m = { scrollTop: 0, scrollHeight: 20, viewportHeight: 30 }
    expect(scrollMax(m)).toBe(0)
    expect(isAtLiveEdge(m)).toBe(true)
    expect(computeScrollPosition(m).atLive).toBe(true)
    expect(computeScrollPosition(m).percent).toBe(100)
  })

  test("top of long chat is not live", () => {
    const m = { scrollTop: 0, scrollHeight: 200, viewportHeight: 40 }
    expect(scrollMax(m)).toBe(160)
    expect(isAtLiveEdge(m)).toBe(false)
    const info = computeScrollPosition(m)
    expect(info.atLive).toBe(false)
    expect(info.percent).toBe(0)
    expect(info.rowsAbove).toBe(0)
    expect(info.rowsBelow).toBe(160)
  })

  test("bottom within tolerance is live", () => {
    const m = { scrollTop: 160, scrollHeight: 200, viewportHeight: 40 }
    expect(isAtLiveEdge(m)).toBe(true)
    expect(computeScrollPosition(m).percent).toBe(100)

    const almost = { scrollTop: 160 - LIVE_EDGE_TOLERANCE, scrollHeight: 200, viewportHeight: 40 }
    expect(isAtLiveEdge(almost)).toBe(true)
  })

  test("mid scroll percent and rows", () => {
    const m = { scrollTop: 80, scrollHeight: 200, viewportHeight: 40 }
    const info = computeScrollPosition(m)
    expect(info.atLive).toBe(false)
    expect(info.percent).toBe(50)
    expect(info.rowsAbove).toBe(80)
    expect(info.rowsBelow).toBe(80)
  })
})

describe("formatScrollChip", () => {
  test("live edge is short", () => {
    expect(formatScrollChip(computeScrollPosition({ scrollTop: 100, scrollHeight: 100, viewportHeight: 50 }))).toBe(
      "↓ Live",
    )
  })

  test("includes percent and rows above", () => {
    const chip = formatScrollChip(
      computeScrollPosition({ scrollTop: 40, scrollHeight: 200, viewportHeight: 40 }),
    )
    expect(chip).toBe("↓ Live · 25% · 40 above")
  })

  test("abbreviates large row counts", () => {
    const chip = formatScrollChip(
      computeScrollPosition({ scrollTop: 2500, scrollHeight: 5000, viewportHeight: 40 }),
    )
    expect(chip).toContain("2.5k above")
    expect(chip).toContain("%")
  })
})

describe("countMessagesAbove", () => {
  test("counts nodes above viewport top", () => {
    expect(countMessagesAbove([10, 20, 50, 80], 45)).toBe(2)
    expect(countMessagesAbove([10, 20, 50], 45, 5)).toBe(2)
    expect(countMessagesAbove([], 0)).toBe(0)
  })
})

describe("session scroll keybinds", () => {
  test("scrollbar toggle defaults to leader+v", () => {
    const parsed = Keybind.parse("<leader>v")
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ leader: true, name: "v" })
  })

  test("agi toggle does not collide with timeline (g)", () => {
    const agi = Keybind.parse("<leader>o")
    const timeline = Keybind.parse("<leader>g")
    expect(agi[0]?.name).toBe("o")
    expect(timeline[0]?.name).toBe("g")
    expect(agi[0]?.name).not.toBe(timeline[0]?.name)
  })
})
