import { describe, expect, test } from "bun:test"
import { REPLAY_DELIVERED_MARKER, isReplayReduced } from "@/session/message-v2"
import { PartID } from "@/session/schema"
import {
  applyTemporaryDataAcquisition,
  payloadDigest,
  withheldPointer,
  type TdaHeld,
  type TdaSet,
} from "@/provider/gateway/tda"

/**
 * T1 — the pure transform, pinned.
 *
 * ## Provenance of the fixture, stated rather than implied
 *
 * The plan requires the fixture to be a REAL body, and the media shape is settleable without
 * guessing: `test/provider/deepseek-image.test.ts` captures a real request body from the INSTALLED
 * SDK and asserts exactly what this file reproduces — `user.content` is an ARRAY holding an entry
 * `{type: "image_url", image_url: {url}}` whose url is a `data:image/webp;base64,…` URL.
 *
 * A correction worth keeping, because the wrong explanation was the tempting one: no capture in this
 * worktree's `raw-wire/` carries a media entry, and I first attributed that to AGE (the session's 25
 * image parts are ~5.3 h older than the earliest capture). The record refuted it — `_progress_log.md`:
 * `@ai-sdk/deepseek@3.0.26`'s converter was TEXT-ONLY, so every non-text part went to `warnings` and
 * was never serialized — "183 raw-wire bodies scanned: zero image parts". The absence is the
 * CONVERTER, fixed by the 3.0.48 bump, and a capture taken after it can carry media.
 *
 * So the base64 payload below is a byte-exact PREFIX of a real webp (`UklGR` = RIFF), shortened only
 * because the transform treats the payload as opaque; the shape is the SDK-asserted one.
 */

/** Byte-exact opening of a real `image/webp` payload seen in a captured body (`UklGR` = RIFF). */
const WEBP_PREFIX =
  "UklGRqgqAABXRUJQVlA4IJwqAADwmwCdASqFAQsBPm00lkgkIqIhJFF7CIANiWdu/HyZUcADOxRlfv2b9L0UNjYR7+OyN6Cv7j6aPQV8xfm4f9T1Uf2vprfUg/cX2AP2q60z/B5Kh4e/pf41eZX83/sv5H+d/4z8p/b/7R+292P+0ft5/"

const IMAGE_URL = `data:image/webp;base64,${WEBP_PREFIX}`
const OTHER_URL = `data:image/webp;base64,UklGRiAAAABXRUJQVlA4IBQAAACwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=`

/** A user message shaped exactly as the capture shows it: text, media, text. */
const body = (media: string[] = [IMAGE_URL]) =>
  JSON.stringify({
    model: "deepseek-flash",
    messages: [
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "[Image 1] from clipboard.png" },
          ...media.map((url) => ({ type: "image_url", image_url: { url } })),
          { type: "text", text: "Called the Read tool with the following input: {}" },
        ],
      },
      { role: "assistant", content: "ok" },
    ],
  })

const held = (over: Partial<TdaHeld> = {}): TdaHeld => ({
  id: PartID.make("prt_0b9bdc0b70011O6AWB9yu16rVD"),
  kind: "image",
  reason: "screenshot under repair",
  expiresAtTurn: 40,
  digest: payloadDigest(IMAGE_URL),
  reader: "image_actualizer",
  ...over,
})

const set = (...items: TdaHeld[]): TdaSet => ({ held: items })

const contentOf = (out: string) =>
  (JSON.parse(out).messages as Array<Record<string, unknown>>)[1]!.content as Array<Record<string, unknown>>

describe("gateway temporary data acquisition", () => {
  test("an expired item's payload is withheld and replaced by a pointer", () => {
    const out = applyTemporaryDataAcquisition(body(), set(held()), 41)
    const content = contentOf(out)
    expect(content).toHaveLength(3)
    expect(content[0]).toEqual({ type: "text", text: "[Image 1] from clipboard.png" })
    // The payload is GONE and a pointer stands in its place, in the same position.
    expect(JSON.stringify(content[1])).not.toContain("data:image")
    expect(content[1]!.type).toBe("text")
    expect(String(content[1]!.text)).toContain(REPLAY_DELIVERED_MARKER)
    expect(String(content[1]!.text)).toContain("prt_0b9bdc0b70011O6AWB9yu16rVD")
    expect(String(content[1]!.text)).toContain("image_actualizer(id=prt_0b9bdc0b70011O6AWB9yu16rVD)")
    // The surrounding transcript is untouched.
    expect(content[2]).toEqual({ type: "text", text: "Called the Read tool with the following input: {}" })
  })

  test("a RELEASED item is withheld even though its span has not passed", () => {
    // Release and expiry are TWO facts (the plan's words: "a released or expired item"). Here the span
    // still runs to turn 99 — the item is held by time — and the explicit release withholds it anyway.
    const out = applyTemporaryDataAcquisition(body(), set(held({ expiresAtTurn: 99, released: true })), 41)
    expect(JSON.stringify(contentOf(out)[1])).toContain("released;")
  })

  test("the pointer is recognised by the same marker the dropped-result placeholder uses", () => {
    expect(isReplayReduced(withheldPointer(held(), IMAGE_URL.length))).toBe(true)
  })

  test("a HELD item is untouched", () => {
    const before = body()
    // expiresAtTurn 40, turn 40 — the span includes the current turn; the item is still held.
    expect(applyTemporaryDataAcquisition(before, set(held()), 40)).toBe(before)
    expect(applyTemporaryDataAcquisition(before, set(held({ expiresAtTurn: 99 })), 41)).toBe(before)
  })

  test("NEVER BLANK: an item with no address leaves its payload alone", () => {
    const before = body()
    // Rule 3. A released, expired item whose id is empty cannot be pointed at, so it is not
    // withheld at all — the payload stays. A reduction that cannot name what it removed is a loss.
    //
    // Note WHERE this case can still arise: the runtime cannot build an item without an address
    // (`AcquiredItemTable.id` is a primary key and `acquiredItem` brands it), so an empty id reaches
    // the transform only off the WIRE — which is precisely why the guard belongs on this side.
    expect(applyTemporaryDataAcquisition(before, set(held({ id: PartID.make("") })), 41)).toBe(before)
  })

  test("an unparsable body comes back as the SAME STRING", () => {
    for (const junk of ["", "not json", "{oops", "<html></html>"]) {
      expect(applyTemporaryDataAcquisition(junk, set(held()), 41)).toBe(junk)
    }
    // A body that is JSON but carries no messages array is equally untouched.
    const noMessages = '{"model":"deepseek-flash"}'
    expect(applyTemporaryDataAcquisition(noMessages, set(held()), 41)).toBe(noMessages)
  })

  test("an empty set and a set that matches nothing both return the input BYTE-IDENTICAL", () => {
    const before = body()
    expect(applyTemporaryDataAcquisition(before, { held: [] }, 41)).toBe(before)
    // Same shape, different payload — nothing in this body belongs to the set.
    expect(applyTemporaryDataAcquisition(before, set(held({ digest: payloadDigest(OTHER_URL) })), 41)).toBe(before)
  })

  test("only the matching payload is withheld when a body carries several", () => {
    const out = applyTemporaryDataAcquisition(body([IMAGE_URL, OTHER_URL]), set(held()), 41)
    const content = contentOf(out)
    expect(content).toHaveLength(4)
    expect(String(JSON.stringify(content[1]))).toContain("released;")
    expect(String(JSON.stringify(content[2]))).toContain("data:image/webp")
  })

  test("the digest is of the PAYLOAD, so the wrapper does not orphan an item", () => {
    // Same bytes under a different mime wrapper and with parameters — still the same item.
    expect(payloadDigest(IMAGE_URL)).toBe(payloadDigest(`data:image/webp;charset=binary;base64,${WEBP_PREFIX}`))
    expect(payloadDigest(IMAGE_URL)).not.toBe(payloadDigest(OTHER_URL))
    // It is a stable 64-hex sha256, computed from the payload and not the wrapper.
    expect(payloadDigest(IMAGE_URL)).toMatch(/^[0-9a-f]{64}$/)
  })
})
