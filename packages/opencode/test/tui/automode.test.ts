import { describe, expect, test } from "bun:test"
import { autoModeDecision, parseAutoModeArgs } from "../../src/cli/cmd/tui/context/automode-logic"

describe("parseAutoModeArgs", () => {
  test("no argument is the current-plan mode", () => {
    expect(parseAutoModeArgs("")).toEqual({ ok: true, kind: "current", limit: null })
    expect(parseAutoModeArgs("   ")).toEqual({ ok: true, kind: "current", limit: null })
  })

  test("`all` is the every-plan mode, case- and space-insensitive", () => {
    expect(parseAutoModeArgs("all")).toEqual({ ok: true, kind: "all", limit: null })
    expect(parseAutoModeArgs(" ALL ")).toEqual({ ok: true, kind: "all", limit: null })
  })

  test("a positive integer bounds the mode by iterations", () => {
    expect(parseAutoModeArgs("5")).toEqual({ ok: true, kind: "iterations", limit: 5 })
    expect(parseAutoModeArgs(" 7 ")).toEqual({ ok: true, kind: "iterations", limit: 7 })
  })

  test("0 and unknown words are refused, not silently reinterpreted", () => {
    expect(parseAutoModeArgs("0")).toEqual({
      ok: false,
      error: "0 iterations is a no-op; omit the number for unlimited",
    })
    expect(parseAutoModeArgs("abc")).toEqual({
      ok: false,
      error: 'expected no argument, "all", or a positive integer — got: abc',
    })
    expect(parseAutoModeArgs("-1")).toEqual({
      ok: false,
      error: 'expected no argument, "all", or a positive integer — got: -1',
    })
  })
})

describe("autoModeDecision", () => {
  test("current: keeps going while the plan set is unchanged", () => {
    expect(autoModeDecision({ kind: "current", iteration: 3, limit: null, plansAtStart: 20, plansNow: 20 })).toEqual({
      action: "continue",
    })
  })

  test("current: a plan LEAVING plans/ is the exit — a decrease, not «no open boxes»", () => {
    expect(autoModeDecision({ kind: "current", iteration: 3, limit: null, plansAtStart: 20, plansNow: 19 })).toEqual({
      action: "stop",
      reason: "plan-moved",
    })
  })

  test("all: keeps going until plans/ is empty", () => {
    expect(autoModeDecision({ kind: "all", iteration: 1, limit: null, plansAtStart: 20, plansNow: 1 })).toEqual({
      action: "continue",
    })
    expect(autoModeDecision({ kind: "all", iteration: 2, limit: null, plansAtStart: 20, plansNow: 0 })).toEqual({
      action: "stop",
      reason: "plans-complete",
    })
  })

  test("iterations: the counter alone decides — plan movement does not end it", () => {
    expect(autoModeDecision({ kind: "iterations", iteration: 4, limit: 5, plansAtStart: 20, plansNow: 19 })).toEqual({
      action: "continue",
    })
    expect(autoModeDecision({ kind: "iterations", iteration: 5, limit: 5, plansAtStart: 20, plansNow: 19 })).toEqual({
      action: "stop",
      reason: "limit-reached",
    })
  })
})
