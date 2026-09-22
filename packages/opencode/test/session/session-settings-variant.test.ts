/**
 * The `"default"` sentinel — one predicate, every reader.
 *
 * `"default"` is WRITTEN, not declared: `setSessionAgentModel:136` pins it when an agent's model
 * is picked, and `local.tsx`/`setForModel` pin it when a step runs past the last variant. It means
 * «the user explicitly picked model defaults», so it must STOP the resolution chain and read as
 * `undefined` — never as a value.
 *
 * `resolveAgentVariant` has read it that way since the worktree step was added; the TUI's own
 * chain and `task.ts`'s fallback did not, and a sentinel left by a MODEL pick therefore won over
 * the owner's real variant choice — so every restart looked like a reset (owner, 2026-09-22:
 * «выставляешь правильный через ctrl+t и все работает. Но это не сохраняется. Выход, загрузка
 * сессии и все слетает»).
 */
import { describe, expect, test } from "bun:test"
import { chosenVariant } from "../../src/session/session-settings"

describe("chosenVariant — the sentinel is read as NO CHOICE", () => {
  test("the sentinel is absence, not a value", () => {
    expect(chosenVariant("default")).toBeUndefined()
  })

  test("a real variant passes through unchanged", () => {
    expect(chosenVariant("max")).toBe("max")
    expect(chosenVariant("low")).toBe("low")
    expect(chosenVariant("high")).toBe("high")
  })

  test("absence stays absence", () => {
    expect(chosenVariant(undefined)).toBeUndefined()
  })

  test("falsy-looking but real values are not swallowed", () => {
    // A defensive pin: only the exact sentinel string is treated as absence.
    expect(chosenVariant("off")).toBe("off")
    expect(chosenVariant("0")).toBe("0")
  })
})
