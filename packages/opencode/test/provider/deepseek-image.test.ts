import { describe, expect, test } from "bun:test"
import { generateText } from "ai"
import { createDeepSeek } from "@ai-sdk/deepseek"
import sharp from "sharp"

/**
 * Regression guard for the 2026-09-18 bug: `@ai-sdk/deepseek@3.0.26` had a
 * text-only message converter — every non-text part was pushed into `warnings`
 * and never serialized, so images silently vanished between the message
 * history and the wire (183 raw-wire requests contained no image part at all,
 * while the UI showed "Called the Read tool" for the same turn).
 *
 * 3.0.48 serializes image parts as `image_url` data URLs. This test pins that
 * behaviour against the installed SDK so a downgrade or a converter
 * regression fails loudly here instead of silently on the wire.
 */
describe("deepseek image delivery", () => {
  test("a webp image part reaches the wire as image_url", async () => {
    const bodies: Record<string, any>[] = []
    const deepseek = createDeepSeek({
      apiKey: "test",
      fetch: (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)))
        return Response.json({
          id: "test",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      }) as typeof fetch,
    })

    const webp = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 120, b: 220 } },
    })
      .webp({ quality: 80, effort: 6 })
      .toBuffer()

    await generateText({
      model: deepseek("deepseek-flash"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is on this image?" },
            { type: "file", mediaType: "image/webp", filename: "clipboard.webp", data: webp.toString("base64") },
          ],
        },
      ],
    })

    expect(bodies).toHaveLength(1)
    const user = bodies[0].messages.find((m: any) => m.role === "user")
    expect(Array.isArray(user.content)).toBe(true)
    const imagePart = user.content.find((p: any) => p.type === "image_url")
    expect(imagePart).toBeDefined()
    expect(imagePart.image_url.url.startsWith("data:image/webp;base64,")).toBe(true)
  })
})
