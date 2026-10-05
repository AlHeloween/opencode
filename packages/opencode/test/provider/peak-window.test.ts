import { describe, expect, test } from "bun:test"
import { isPeakWindow, DEEPSEEK_PEAK_SCHEDULE } from "../../src/provider/tariff"

/** UTC instant, so a test can name an hour without depending on the runner's timezone. */
const at = (iso: string) => new Date(iso)

describe("peak window", () => {
  test("DeepSeek's published windows bill peak inside them and off-peak outside", () => {
    // 01:00-04:00 and 06:00-10:00 UTC, weekdays (footnote 2).
    expect(isPeakWindow(at("2026-10-05T01:30:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(true)
    expect(isPeakWindow(at("2026-10-05T03:59:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(true)
    expect(isPeakWindow(at("2026-10-05T06:00:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(true)
    expect(isPeakWindow(at("2026-10-05T09:59:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(true)
    expect(isPeakWindow(at("2026-10-05T00:59:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(false)
    expect(isPeakWindow(at("2026-10-05T04:00:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(false)
    expect(isPeakWindow(at("2026-10-05T05:59:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(false)
    expect(isPeakWindow(at("2026-10-05T10:00:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(false)
  })

  test("the same hour is off-peak at the weekend — this is the case that was measured", () => {
    // 2026-10-04 is a Sunday. Every one of our 2026-10-04 measurements sat in
    // a peak-eligible HOUR and still billed above the off-peak model, which is
    // why the weekday rule is the one under test here and not the window.
    expect(isPeakWindow(at("2026-10-04T03:00:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(false)
    expect(isPeakWindow(at("2026-10-03T07:00:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(false)
    expect(isPeakWindow(at("2026-10-05T03:00:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(true)
  })

  test("a holiday inside a peak hour bills off-peak", () => {
    const schedule = { ...DEEPSEEK_PEAK_SCHEDULE, holidays: ["2026-10-05"] }
    expect(isPeakWindow(at("2026-10-05T03:00:00Z"), schedule)).toBe(false)
    expect(isPeakWindow(at("2026-10-06T03:00:00Z"), schedule)).toBe(true)
  })

  test("an empty weekday list means every day is eligible", () => {
    const everyDay = { windows: [{ start: 6, end: 10 }] }
    expect(isPeakWindow(at("2026-10-04T07:00:00Z"), everyDay)).toBe(true)
    expect(isPeakWindow(at("2026-10-06T07:00:00Z"), everyDay)).toBe(true)
    expect(isPeakWindow(at("2026-10-04T11:00:00Z"), everyDay)).toBe(false)
  })

  test("no windows never bills peak, whatever the weekday", () => {
    const none = { windows: [] as Array<{ start: number; end: number }> }
    expect(isPeakWindow(at("2026-10-05T07:00:00Z"), none)).toBe(false)
  })

  test("the window end is exclusive — a window never spills into the next hour", () => {
    expect(isPeakWindow(at("2026-10-05T10:00:00Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(false)
    expect(isPeakWindow(at("2026-10-05T09:59:59.999Z"), DEEPSEEK_PEAK_SCHEDULE)).toBe(true)
  })
})