import { describe, expect, test } from "bun:test"
import { configureLogging, wrapFetch } from "@/provider/gateway/adaptive-client"
import { payloadDigest } from "@/provider/gateway/tda"

/**
 * T2 — the transform ON THE WIRE, through `wrapFetch`, with the set arriving in a header.
 *
 * The oracle the plan names for this task, in both directions:
 *  - set present  → the released payload is GONE and a pointer stands where it was;
 *  - set absent   → the body reaches the provider byte-identical to today.
 *
 * "Flag off" is not a config read at this layer: the gateway withholds only when the runtime hands it
 * a set (`x-opencode-tda`), so the absence of that header IS off. The switch stays where the
 * authority is — the runtime — which is also why the transform can short-circuit to zero cost.
 *
 * The body is deliberately NOT a deepseek body: a model matching `/z-ai\/|glm|deepseek/i` goes
 * through `rewriteReasoningContent` first, which re-serialises the JSON and would mask a real
 * difference. Isolating the variable is what makes the byte-identity claim mean something.
 */

/** Byte-exact opening of a real `image/webp` payload (`UklGR` = RIFF), as the sibling T1 suite uses. */
const WEBP =
  "UklGRqgqAABXRUJQVlA4IJwqAADwmwCdASqFAQsBPm00lkgkIqIhJFF7CIANiWdu/HyZUcADOxRlfv2b9L0UNjYR7+OyN6Cv7j6aPQV8xfm4f9T1Uf2vprfUg/cX2AP2q60z/B5Kh4e/pf41eZX83/sv5H+d/4z8p/b/7R+292P+0ft5/"
const IMAGE_URL = `data:image/webp;base64,${WEBP}`
const OTHER_URL = "data:image/webp;base64,UklGRiAAAABXRUJQVlA4IBQAAACwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA="

const body = (media: string[] = [IMAGE_URL]) =>
  JSON.stringify({
    model: "capture-model",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "[Image 1] from clipboard.png" },
          ...media.map((url) => ({ type: "image_url", image_url: { url } })),
          { type: "text", text: "Called the Read tool with the following input: {}" },
        ],
      },
    ],
  })

const tdaHeader = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    turn: 41,
    held: [
      {
        id: "prt_0b9bdc0b70011O6AWB9yu16rVD",
        kind: "image",
        reason: "screenshot under repair",
        expiresAtTurn: 40,
        digest: payloadDigest(IMAGE_URL),
        reader: "image_actualizer",
      },
    ],
    ...over,
  })

/** One real HTTP hop per call, like the sibling capture suite; returns what the provider saw. */
async function post(headers: Record<string, string>, payload: string) {
  let seenBody = ""
  let seenHeaders: Record<string, string> = {}
  using server = Bun.serve({
    port: 0,
    async fetch(request) {
      seenBody = await request.text()
      seenHeaders = Object.fromEntries(request.headers.entries())
      return Response.json({
        id: "t",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
    },
  })
  const response = await wrapFetch(globalThis.fetch)(server.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: payload,
    gatewayProvider: "capture-provider",
    gatewayModel: "capture-model",
    gatewayProtocol: "http/1.1",
  })
  await response.text()
  return { seenBody, seenHeaders }
}

describe("gateway temporary data acquisition on the wire", () => {
  configureLogging(false)

  test("with a set: the released payload is withheld and a pointer rides in its place", async () => {
    const { seenBody } = await post({ "x-opencode-tda": tdaHeader() }, body())
    expect(seenBody).not.toContain("data:image")
    const content = (JSON.parse(seenBody).messages as Array<Record<string, unknown>>)[0]!.content as Array<
      Record<string, unknown>
    >
    expect(content).toHaveLength(3)
    expect(content[1]!.type).toBe("text")
    expect(String(content[1]!.text)).toContain("released;")
    expect(String(content[1]!.text)).toContain("prt_0b9bdc0b70011O6AWB9yu16rVD")
    // Everything around the withheld payload is still exactly what it was.
    expect(content[0]).toEqual({ type: "text", text: "[Image 1] from clipboard.png" })
    expect(content[2]).toEqual({ type: "text", text: "Called the Read tool with the following input: {}" })
  })

  test("without a set the body reaches the provider byte-identical — the flag-off control", async () => {
    const payload = body()
    expect((await post({}, payload)).seenBody).toBe(payload)
  })

  test("a held item is untouched, and so is a body carrying something else", async () => {
    const payload = body()
    // Same set, but the item still holds at this turn.
    expect((await post({ "x-opencode-tda": tdaHeader({ turn: 40 }) }, payload)).seenBody).toBe(payload)
    // Released, but this body's payload is a different image.
    expect((await post({ "x-opencode-tda": tdaHeader() }, body([OTHER_URL]))).seenBody).toBe(body([OTHER_URL]))
  })

  test("a malformed header degrades to nothing held — it never breaks the request", async () => {
    const payload = body()
    for (const junk of ["", "not json", "{}", '{"turn":"x","held":[]}', '{"turn":41,"held":[{"id":1}]}']) {
      expect((await post({ "x-opencode-tda": junk }, payload)).seenBody).toBe(payload)
    }
  })

  test("the instruction is consumed, not forwarded upstream", async () => {
    const { seenHeaders } = await post({ "x-opencode-tda": tdaHeader() }, body())
    expect(seenHeaders["x-opencode-tda"]).toBeUndefined()
    // A control: a header the gateway genuinely forwards is still forwarded, so the assertion above
    // is about the instruction and not about the capture being empty.
    expect(seenHeaders["content-type"]).toContain("application/json")
  })
})
