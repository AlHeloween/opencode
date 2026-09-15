// NovitaAI "Session ID" dashboard column — differential smoke ROUND 2.
//
// Round 1 result: x-request-id IS read (echoed + console), but Session ID
// column stayed "-" on both /openai and /v3/openai rows even though we sent
// x-novita-session-id + x-session-id + x-session-affinity simultaneously.
//
// Round 2 hypotheses (isolated, one candidate per row):
//   H1 body field      — session_id as request-body field (OpenRouter does this)
//   H2 isolated header — x-novita-session-id alone (no interference)
//   H3 streaming       — same header on stream:true request (prod uses streaming)
//   H4 x-trace-id      — we send a session-shaped value in the trace header
//   H5 aggregation     — 3 requests sharing ONE session value: console may show
//                        "-" for singletons and fill only grouped rows
//   H6 path /openai/v1 — the path the API reference documents (undocumented
//                        relative to our registry; probe works + reads header?)
//   H7 /openai retry   — production path retest (round 1 hit transient 429)
//
// Usage: node scripts/smoke-test-novita-session-id-r2.cjs

const fs = require("node:fs")
const path = require("node:path")
const http2 = require("node:http2")

const HOST = "api.novita.ai"
const MODEL = "zai-org/glm-5.3-flash"
const AUTH_PATH = path.join(__dirname, "..", "bin", "auth.json")

const P1 = "/v3/openai/chat/completions"
const P2 = "/openai/v1/chat/completions"
const P3 = "/openai/chat/completions"

function loadKey() {
  if (process.env.NOVITA_API_KEY) return process.env.NOVITA_API_KEY
  const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"))
  const entry = auth["novita-ai"]
  if (!entry || !entry.key) throw new Error(`no novita-ai key found (env NOVITA_API_KEY or ${AUTH_PATH})`)
  return entry.key
}

function h2Request({ key, requestPath, headers, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${HOST}`, { ALPNProtocols: ["h2"], servername: HOST })
    const timer = setTimeout(() => {
      client.close()
      reject(new Error(`no response within ${timeoutMs}ms`))
    }, timeoutMs)
    let responseHeaders = {}
    client.on("error", (e) => {
      clearTimeout(timer)
      client.close()
      reject(e)
    })
    client.on("connect", () => {
      const stream = client.request({
        ":method": "POST",
        ":path": requestPath,
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "content-length": Buffer.byteLength(body),
        ...headers,
      })
      let data = ""
      stream.on("response", (h) => {
        responseHeaders = h
      })
      stream.on("data", (chunk) => {
        data += chunk.toString()
      })
      stream.on("end", () => {
        clearTimeout(timer)
        client.close()
        resolve({ status: Number(responseHeaders[":status"] || 0), headers: responseHeaders, body: data })
      })
      stream.on("error", (e) => {
        clearTimeout(timer)
        client.close()
        reject(e)
      })
      stream.end(body)
    })
  })
}

// Streaming request: just count SSE chunks until close.
function h2Stream({ key, requestPath, headers, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${HOST}`, { ALPNProtocols: ["h2"], servername: HOST })
    const timer = setTimeout(() => {
      client.close()
      resolve({ status: 0, headers: {}, chunks: -1, note: `timeout ${timeoutMs}ms` })
    }, timeoutMs)
    let responseHeaders = {}
    client.on("error", (e) => {
      clearTimeout(timer)
      client.close()
      resolve({ status: 0, headers: {}, chunks: -1, note: e.message })
    })
    client.on("connect", () => {
      const stream = client.request({
        ":method": "POST",
        ":path": requestPath,
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "content-length": Buffer.byteLength(body),
        ...headers,
      })
      let chunks = 0
      stream.on("response", (h) => {
        responseHeaders = h
      })
      stream.on("data", () => {
        chunks++
      })
      stream.on("end", () => {
        clearTimeout(timer)
        client.close()
        resolve({ status: Number(responseHeaders[":status"] || 0), headers: responseHeaders, chunks })
      })
      stream.on("error", (e) => {
        clearTimeout(timer)
        client.close()
        resolve({ status: 0, headers: responseHeaders, chunks, note: e.message })
      })
      stream.end(body)
    })
  })
}

const baseBody = {
  model: MODEL,
  max_tokens: 64,
  messages: [{ role: "user", content: "Reply with exactly: OK" }],
}

async function runRow({ label, requestPath, headers, body, stream = false }) {
  const started = Date.now()
  try {
    const res = stream
      ? await h2Stream({ key: global.__key, requestPath, headers, body })
      : await h2Request({ key: global.__key, requestPath, headers, body })
    const status = res.status
    const extra = stream ? ` SSE chunks: ${res.chunks}${res.note ? ` (${res.note})` : ""}` : ""
    console.log(`${label.padEnd(28)} ${requestPath.padEnd(34)} -> ${status} (${Date.now() - started}ms)${extra}`)
    if (!stream && status !== 200 && res.body) {
      console.log(`   body: ${res.body.slice(0, 160)}`)
    }
    return status
  } catch (e) {
    console.log(`${label.padEnd(28)} ${requestPath.padEnd(34)} -> transport error: ${e.message}`)
    return 0
  }
}

async function main() {
  global.__key = loadKey()
  console.log("=== NovitaAI Session-ID smoke ROUND 2 ===")
  console.log(`model: ${MODEL} (key loaded, not printed)\n`)

  // H1 — body session_id field
  await runRow({
    label: "H1 body session_id",
    requestPath: P1,
    headers: { "x-request-id": "req_r2_h1_body" },
    body: JSON.stringify({ ...baseBody, session_id: "ses_r2_H1_BODYFIELD" }),
  })

  // H2 — x-novita-session-id isolated
  await runRow({
    label: "H2 novita hdr isolated",
    requestPath: P1,
    headers: { "x-request-id": "req_r2_h2_nov", "x-novita-session-id": "ses_r2_H2_NOVITA" },
    body: JSON.stringify(baseBody),
  })

  // H3 — streaming + x-novita-session-id
  await runRow({
    label: "H3 stream + novita hdr",
    requestPath: P1,
    stream: true,
    headers: { "x-request-id": "req_r2_h3_str", "x-novita-session-id": "ses_r2_H3_STREAM" },
    body: JSON.stringify({ ...baseBody, stream: true }),
  })

  // H4 — x-trace-id carrying session value
  await runRow({
    label: "H4 x-trace-id",
    requestPath: P1,
    headers: { "x-request-id": "req_r2_h4_trace", "x-trace-id": "ses_r2_H4_TRACE" },
    body: JSON.stringify(baseBody),
  })

  // H5 — aggregation: 3 requests, SAME session value in both candidate headers
  for (let i = 1; i <= 3; i++) {
    await runRow({
      label: `H5 repeat ${i}/3 (grouped)`,
      requestPath: P1,
      headers: {
        "x-request-id": `req_r2_h5_rep${i}`,
        "x-novita-session-id": "ses_r2_H5_GROUP",
        "x-session-id": "ses_r2_H5_GROUP",
      },
      body: JSON.stringify(baseBody),
    })
  }

  // H6 — documented API-reference path /openai/v1/chat/completions
  await runRow({
    label: "H6 /openai/v1 path",
    requestPath: P2,
    headers: { "x-request-id": "req_r2_h6_v1", "x-novita-session-id": "ses_r2_H6_V1PATH" },
    body: JSON.stringify(baseBody),
  })

  // H7 — production path /openai/chat/completions retry (round 1: transient 429)
  await runRow({
    label: "H7 prod path retry",
    requestPath: P3,
    headers: { "x-request-id": "req_r2_h7_prod", "x-novita-session-id": "ses_r2_H7_PROD" },
    body: JSON.stringify(baseBody),
  })

  console.log("\n=== What to check in the Novita console (Session ID column) ===")
  console.log("req_r2_h1_body    -> ses_r2_H1_BODYFIELD   (if filled: BODY field mechanism)")
  console.log("req_r2_h2_nov     -> ses_r2_H2_NOVITA      (if filled: header read in isolation)")
  console.log("req_r2_h3_str     -> ses_r2_H3_STREAM      (if filled: streaming-gated)")
  console.log("req_r2_h4_trace   -> ses_r2_H4_TRACE       (if filled: trace header reused as session)")
  console.log("req_r2_h5_rep1..3 -> ses_r2_H5_GROUP       (if filled on grouped rows: aggregation)")
  console.log("req_r2_h6_v1      -> ses_r2_H6_V1PATH      (also: does /openai/v1 even 200?)")
  console.log("req_r2_h7_prod    -> ses_r2_H7_PROD        (also: does prod path 200 again?)")
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
