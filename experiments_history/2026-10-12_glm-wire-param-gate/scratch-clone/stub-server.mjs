/**
 * Local stand-in for zen/go's strict body check (instrument for
 * experiments/2026-10-12_glm-wire-param-gate/, gitignored).
 *
 * Behaviour, mirroring the measured 2026-10-12 failure byte-for-byte in spirit:
 *  - any body carrying `repetition_penalty` → 400
 *    `[unknown_parameter] invalid request body: json: unknown field "repetition_penalty"`;
 *  - any other body → SSE 200 answering "PONG".
 *
 * Every request is appended to stub-requests.jsonl with a flag, so the run's retry can be
 * read off the stub side as well as off the wire capture.
 */
import { appendFileSync } from "node:fs"
import path from "node:path"

const PORT = Number(process.env.STUB_PORT ?? 8791)
const LOG = path.join(import.meta.dir, "stub-requests.jsonl")

const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })

    const body = await req.text()
    const hasRepetitionPenalty = body.includes('"repetition_penalty"')
    appendFileSync(
      LOG,
      JSON.stringify({ t: new Date().toISOString(), path: url.pathname, hasRepetitionPenalty }) + "\n",
    )

    if (hasRepetitionPenalty) {
      return Response.json(
        {
          error: {
            message: '[unknown_parameter] invalid request body: json: unknown field "repetition_penalty"',
            type: "invalid_request_error",
            code: "unknown_parameter",
          },
        },
        { status: 400 },
      )
    }

    const base = { id: "chatcmpl-stub", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000) }
    const sse =
      chunk({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "PONG" }, finish_reason: null }] }) +
      chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
      chunk({ ...base, choices: [], usage: { prompt_tokens: 42, completion_tokens: 2, total_tokens: 44 } }) +
      "data: [DONE]\n\n"

    return new Response(sse, { headers: { "content-type": "text/event-stream; charset=utf-8" } })
  },
})

console.log(`stub listening on http://127.0.0.1:${PORT}`)
