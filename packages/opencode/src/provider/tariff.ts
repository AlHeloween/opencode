/**
 * Time-of-day tariff selection.
 *
 * A flat per-model cost cannot describe a tariff that changes with the clock.
 * DeepSeek's does: off-peak rates are half the peak price, and peak is a
 * wall-clock window — 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday,
 * public holidays excluded (api-docs.deepseek.com, pricing footnote 2).
 *
 * Measured 2026-10-04 on `d:/!!!`: the model predicted $1.074 against $2.390
 * billed, 2.22x. Fitting all four published tariffs put Flash PEAK ($2.149)
 * closest — and peak is exactly 2.0x off-peak. So the gap was never arithmetic
 * (recorded/computed was 1.000 to the last digit); the model simply had no
 * clock to read.
 *
 * The schedule is carried in config, never inferred here. A wrong window
 * silently over-charges, and a constant cannot be corrected by anyone but the
 * source.
 */

/** A peak window in whole UTC hours, `[start, end)` — 06:00 means 06:00:00.000Z. */
export interface PeakWindow {
  start: number
  end: number
}

/** Which moments bill at peak rates. */
export interface PeakSchedule {
  windows: PeakWindow[]
  /** UTC weekdays, `0 = Sunday`. Absent means every day bills at peak. */
  weekdays?: number[]
  /** `YYYY-MM-DD` in UTC, excluded from peak even when the weekday matches. */
  holidays?: string[]
}

/**
 * True when `at` bills at peak rates.
 *
 * A holiday wins over the weekday rule, and a weekday outside the list wins
 * over the window: both are exclusions, and an exclusion that could be
 * overridden by the next rule is not an exclusion.
 */
export function isPeakWindow(at: Date, schedule: PeakSchedule): boolean {
  if (schedule.holidays?.includes(at.toISOString().slice(0, 10))) return false
  if (schedule.weekdays && !schedule.weekdays.includes(at.getUTCDay())) return false
  const hour = at.getUTCHours()
  return schedule.windows.some((window) => hour >= window.start && hour < window.end)
}

/**
 * DeepSeek Flash's published peak schedule. Off-peak rates are half of peak,
 * so this block is what the peak rates must be doubled from.
 *
 * A DEFAULT, not a constant in the cost path: config overrides it per model,
 * and an account on a different plan declares its own.
 */
export const DEEPSEEK_PEAK_SCHEDULE: PeakSchedule = {
  windows: [
    { start: 1, end: 4 },
    { start: 6, end: 10 },
  ],
  weekdays: [1, 2, 3, 4, 5],
  holidays: [],
}