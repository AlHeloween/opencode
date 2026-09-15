// Zen (opencode.ai/zen/v1) h2 streaming smoke — SSE over pinned http2.
// Prints key TYPE and length only, never the key material.
//
// Usage: bun experiments/2026-09-11_openrouter-zen-h3/smoke-zen-h2.mjs

import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"

const authPath = join(dirname(import.meta.dir), "..", "bin", "auth.json")
const auth = JSON.parse(readFileSync(authPath, "utf8"))

function keyOf(entry) {
  if (!entry) return undefined
  if (entry.type === "api" && entry.key) return entry.key
  if (entry.type === "oauth" && (entry.access ?? entry.access_token)) return entry.access ?? entry.access_token
  if (entry.key) return entry.key
  return undefined
}

const entry = auth["opencode"] ?? auth["opencode-go"]
const KEY = keyOf(entry)
console.log(`auth entry: ${entry ? `type=${entry.type ?? "unknown"} keylen=${KEY ? KEY.length : 0}` : "MISSING"}`)
if (!KEY) process.exit(1)

const URL = "https://opencode.ai/zen/v1/chat/completions"
const MODEL = process.argv[2] ?? "nemotron-3-ultra-free"

async function run(protocol) {
  const t0 = performance.now()
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      // Zen free tier requires OpenCode identity headers (llm.ts Layer-3
      // contract, providerID.startsWith("opencode")). Without them the
      // console answers 400 MissingSessionID.
      "x-opencode-session": `ses_smoke_${Date.now()}`,
      "x-opencode-request": `req_smoke_${protocol}_${Date.now()}`,
      "x-opencode-project": "smoke",
      "x-opencode-client": "cli",
      "user-agent": "opencode/smoke",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      stream: true,
    }),
    ...(protocol ? { protocol } : {}),
  })
  console.log(`[${protocol ?? "default"}] status=${res.status} (${Math.round(performance.now() - t0)}ms)`)
  if (res.status !== 200) {
    console.log(`[${protocol ?? "default"}] body: ${(await res.text().catch(() => "")).slice(0, 200)}`)
    return
  }
  let chunks = 0
  let first = null
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (first === null) first = Math.round(performance.now() - t0)
    chunks++
    if (chunks <= 2) console.log(`[${protocol ?? "default"}] chunk: ${dec.decode(value).slice(0, 100).replace(/\n/g, "\\n")}`)
  }
  console.log(`[${protocol ?? "default"}] SSE ok: chunks=${chunks} firstByte=${first}ms total=${Math.round(performance.now() - t0)}ms`)
}

await run("http2")
