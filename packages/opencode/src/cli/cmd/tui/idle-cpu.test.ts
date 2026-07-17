import { describe, expect, test } from "bun:test"
import { BG_PULSE_TICK_MS } from "./component/bg-pulse"
import { WIN32_CONSOLE_MODE_POLL_MS } from "./win32"

/**
 * Idle-CPU policy tests — mirrors interval start/stop rules used by BgPulse,
 * Logo, and the Win32 console-mode guard. Production constants are imported
 * so regressions in poll rates fail CI.
 */

describe("Idle CPU interval policy", () => {
  test("BgPulse tick is ~10fps (not 60fps)", () => {
    expect(BG_PULSE_TICK_MS).toBeGreaterThanOrEqual(100)
    expect(BG_PULSE_TICK_MS).toBeLessThanOrEqual(200)
  })

  test("Win32 console-mode backstop poll is <= 1Hz", () => {
    expect(WIN32_CONSOLE_MODE_POLL_MS).toBeGreaterThanOrEqual(1000)
  })

  test("BgPulse-style focus gate fully stops the timer when unfocused", () => {
    let ticks = 0
    let timer: ReturnType<typeof setInterval> | undefined
    const start = () => {
      if (timer) return
      timer = setInterval(() => {
        ticks++
      }, 20)
    }
    const stop = () => {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
    }

    start()
    // Simulate blur → stop
    stop()
    const atBlur = ticks
    // Wait longer than a tick; should not advance
    const startWait = Date.now()
    while (Date.now() - startWait < 50) {
      /* spin */
    }
    expect(ticks).toBe(atBlur)
    expect(timer).toBeUndefined()

    // Focus → resume
    start()
    expect(timer).toBeDefined()
    stop()
  })

  test("Logo-style cadence: interactive 33ms, idle 100ms, drop back when idle", () => {
    const IDLE_MS = 100
    const INTERACTIVE_MS = 33
    let timerMs = 0
    let timer: ReturnType<typeof setInterval> | undefined

    const stop = () => {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
      timerMs = 0
    }
    const start = (ms: number) => {
      if (timer) {
        if (timerMs === ms) return
        stop()
      }
      timerMs = ms
      timer = setInterval(() => {}, ms)
    }

    // Idle mount
    start(IDLE_MS)
    expect(timerMs).toBe(IDLE_MS)

    // Mouse press upgrades cadence
    start(INTERACTIVE_MS)
    expect(timerMs).toBe(INTERACTIVE_MS)

    // Effects settle → fall back to idle
    const busy = false
    if (!busy && timerMs !== IDLE_MS) {
      stop()
      start(IDLE_MS)
    }
    expect(timerMs).toBe(IDLE_MS)
    stop()
  })

  test("non-idle logo stops timer when no animations remain", () => {
    let running = true
    const busy = (live: boolean, hold: boolean, release: boolean, glow: boolean) =>
      live || hold || release || glow

    // After burst settles
    if (!busy(false, false, false, false)) running = false
    expect(running).toBe(false)

    // While holding
    running = true
    if (!busy(false, true, false, false)) running = false
    expect(running).toBe(true)
  })
})
