// A local stand-in for the Zen endpoint, so the sandbox can observe the TRUE outgoing body.
//
// WHY THIS EXISTS. The sandbox must exercise a route whose provider id starts with `opencode` — that
// is the only route on which the runtime sends `x-opencode-tda`, and without the header the gateway has
// no set and withholds nothing (so the run would "pass" by doing nothing). Zen's own free tier refuses
// this build ("OpenCode's free tier can only be used from within OpenCode"), and widening the header
// contract to a third-party provider would be a governance change this experiment must not make.
//
// So the provider ID stays `opencode` and only its BASE URL is overridden, in the sandbox's own config,
// to this file. Nothing about the product changes, no third party ever receives `x-opencode-*`, and the
// request that arrives here is the post-transform body — which is exactly the thing under test.
//
// It records every request verbatim under ./captures/ and prints, per request: the byte count, whether
// the TDA header arrived, and how many image payloads the body carries. Those three numbers are the
// observation; nothing is inferred from the model's answer.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PORT = Number(process.env.MOCK_ZEN_PORT ?? 8791)
const DIR = join(import.meta.dir, "captures")
mkdirSync(DIR, { recursive: true })

// Two canned turns, chosen by what the request already contains so the conversation is deterministic:
// nothing read yet → ask for the image; a tool result present → answer with the colour.
const sse = (o) => `data: ${JSON.stringify(o)}\n\n`
const chunk = (delta, finish) => ({
  id: "chatcmpl-mock",
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model: "mimo-v2.5-free",
  choices: [{ index: 0, delta, finish_reason: finish ?? null }],
})

let n = 0

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const body = await req.text()
    const headers = Object.fromEntries(req.headers.entries())
    const seq = String(++n).padStart(3, "0")

    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = { unparsable: true, raw: body }
    }
    writeFileSync(join(DIR, `${seq}.json`), JSON.stringify({ path: url.pathname, headers, body: parsed }, null, 2))

    const messages = Array.isArray(parsed?.messages) ? parsed.messages : []
    const imageUrls = (body.match(/"image_url"/g) ?? []).length
    const sawToolResult = messages.some((m) => m.role === "tool")
    console.log(
      `[mock] #${seq} ${url.pathname} bytes=${body.length} tda=${headers["x-opencode-tda"] ? "YES" : "no"} ` +
        `image_url=${imageUrls} sawToolResult=${sawToolResult}`,
    )

    const parts = []
    if (!sawToolResult) {
      parts.push(sse(chunk({ role: "assistant", content: "Let me look at that file." }, null)))
      parts.push(
        sse(
          chunk(
            {
              tool_calls: [
                {
                  index: 0,
                  id: "call_mock_1",
                  type: "function",
                  function: { name: "read", arguments: JSON.stringify({ filePath: "red.png" }) },
                },
              ],
            },
            null,
          ),
        ),
      )
      parts.push(sse(chunk({}, "tool_calls")))
    } else {
      parts.push(sse(chunk({ role: "assistant", content: "The image is solid red." }, null)))
      parts.push(sse({ ...chunk({}, "stop"), usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } }))
    }
    parts.push("data: [DONE]\n\n")

    return new Response(parts.join(""), {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    })
  },
})

console.log(`[mock] listening on http://127.0.0.1:${PORT}/v1 — captures in ${DIR}`)
