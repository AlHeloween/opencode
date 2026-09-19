import { describe, expect, test } from "bun:test"
import { acquiredItem, release, tdaHeaderValue } from "@/session/acquired-item"
import { applyTemporaryDataAcquisition, isWithheld, parseTdaHeader, payloadDigest } from "@/provider/gateway/tda"

/**
 * T3 — the runtime's half of the set: its lifecycle, and the instruction the gateway acts on.
 *
 * The three behaviours the plan names as T3's oracle, each at the level where it is decided: a held
 * item SURVIVES a turn, an expired one is withheld, a released one is withheld AT ONCE. The last test
 * then closes the loop — the header this side writes is parsed by the gateway and withholds the very
 * payload it describes — because a lifecycle that agrees with itself and not with the wire is a
 * lifecycle that does nothing.
 */

/** Byte-exact opening of a real `image/webp` payload, as the gateway suites use. */
const WEBP =
  "UklGRqgqAABXRUJQVlA4IJwqAADwmwCdASqFAQsBPm00lkgkIqIhJFF7CIANiWdu/HyZUcADOxRlfv2b9L0UNjYR7+OyN6Cv7j6aPQV8xfm4f9T1Uf2vprfUg/cX2AP2q60z/B5Kh4e/pf41eZX83/sv5H+d/4z8p/b/7R+292P+0ft5/"
const IMAGE_URL = `data:image/webp;base64,${WEBP}`

const item = (turn: number, holdTurns = 10) =>
  acquiredItem({
    id: "prt_0b9bdc0b70011O6AWB9yu16rVD",
    kind: "image",
    reason: "screenshot under repair",
    url: IMAGE_URL,
    turn,
    holdTurns,
    reader: "image_actualizer",
  })

describe("the runtime's acquisition set", () => {
  test("a held item survives every turn of its span, and is withheld after it", () => {
    const acquired = item(5, 10) // expires at turn 15
    expect(acquired.digest).toBe(payloadDigest(IMAGE_URL))
    expect(acquired.expiresAtTurn).toBe(15)
    for (const turn of [5, 6, 10, 15]) expect(isWithheld(acquired, turn)).toBe(false)
    for (const turn of [16, 17, 999]) expect(isWithheld(acquired, turn)).toBe(true)
  })

  test("a RELEASE withholds at once, whatever the span says", () => {
    const acquired = item(5, 10)
    const released = release([acquired], acquired.id)[0]!
    // Released on the very turn it was acquired — no turn has passed, and it is still withheld.
    expect(isWithheld(released, 5)).toBe(true)
    // The span is NOT rewritten: a release and a spent span are two facts, and collapsing them would
    // destroy the record of which happened.
    expect(released.expiresAtTurn).toBe(15)
    expect(released.released).toBe(true)
    // Releasing a different id leaves this one held.
    expect(isWithheld(release([acquired], "prt_other")[0]!, 5)).toBe(false)
  })

  test("the instruction round-trips: what this side writes is what the gateway reads", () => {
    const parsed = parseTdaHeader(tdaHeaderValue([item(5, 10)], 16))
    expect(parsed?.turn).toBe(16)
    expect(parsed?.set.held).toHaveLength(1)
    expect(parsed?.set.held[0]!.digest).toBe(payloadDigest(IMAGE_URL))
    // `acquiredTurn` is the runtime's business and does not ride the header.
    expect(Object.keys(parsed?.set.held[0] ?? {})).not.toContain("acquiredTurn")
  })

  test("and the instruction withholds the very payload it describes", () => {
    // The whole loop, once: acquire → the span passes → the header goes out → the transform replaces
    // that payload and touches nothing else in the body.
    const body = JSON.stringify({
      model: "capture-model",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "[Image 1] from clipboard.png" },
            { type: "image_url", image_url: { url: IMAGE_URL } },
            { type: "text", text: "Called the Read tool with the following input: {}" },
          ],
        },
      ],
    })
    const parsed = parseTdaHeader(tdaHeaderValue([item(5, 10)], 16))!
    const out = applyTemporaryDataAcquisition(body, parsed.set, parsed.turn)
    expect(out).not.toContain("data:image")
    expect(out).toContain("released;")
    const content = (JSON.parse(out).messages as Array<Record<string, unknown>>)[0]!.content as Array<
      Record<string, unknown>
    >
    expect(content[0]).toEqual({ type: "text", text: "[Image 1] from clipboard.png" })
    expect(content[2]).toEqual({ type: "text", text: "Called the Read tool with the following input: {}" })
  })

  test("an empty set says NOTHING — that is the switch being off", () => {
    expect(tdaHeaderValue([], 16)).toBeUndefined()
    expect(parseTdaHeader(tdaHeaderValue([], 16))).toBeUndefined()
  })
})
