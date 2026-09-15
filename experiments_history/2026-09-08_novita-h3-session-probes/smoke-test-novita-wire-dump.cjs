// NovitaAI wire dump — show EVERYTHING the server returns on the wire:
// all response headers (not filtered) + full body top-level keys + full JSON.
// Goal: find whether Session ID (dashboard column) comes back to us in the
// response itself (header or body field) rather than being request-driven.
//
// Usage: node scripts/smoke-test-novita-wire-dump.cjs

const fs = require("node:fs")
const path = require("node:path")
const http2 = require("node:http2")

const HOST = "api.novita.ai"
const MODEL = "zai-org/glm-5.3-flash"
const AUTH_PATH = path.join(__dirname, "..", "bin", "auth.json")

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

// Streaming: collect raw SSE lines; return headers + first N events + last event.
function h2StreamRaw({ key, requestPath, headers, body, timeoutMs = 45000, maxEvents = 4 }) {
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
      let buffer = ""
      const events = []
      stream.on("response", (h) => {
        responseHeaders = h
      })
      stream.on("data", (chunk) => {
        buffer += chunk.toString()
        const parts = buffer.split("\n\n")
        buffer = parts.pop() || ""
        for (const p of parts) {
          const line = p.split("\n").find((l) => l.startsWith("data:"))
          if (line) events.push(line.slice(5).trim())
        }
      })
      stream.on("end", () => {
        clearTimeout(timer)
        client.close()
        resolve({
          status: Number(responseHeaders[":status"] || 0),
          headers: responseHeaders,
          firstEvents: events.slice(0, maxEvents),
          lastEvent: events[events.length - 1] || null,
          totalEvents: events.length,
        })
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

function dumpHeaders(tag, headers) {
  console.log(`   [${tag}] ALL response headers:`)
  for (const [k, v] of Object.entries(headers)) {
    console.log(`      ${k}: ${v}`)
  }
}

function dumpBody(tag, raw) {
  console.log(`   [${tag}] body (raw, first 800 chars):`)
  console.log(`      ${raw.slice(0, 800).replace(/\n/g, " ")}`)
  try {
    const parsed = JSON.parse(raw)
    console.log(`   [${tag}] body top-level keys: ${Object.keys(parsed).join(", ")}`)
    if (parsed.id !== undefined) console.log(`   [${tag}] body.id = ${parsed.id}`)
    for (const k of Object.keys(parsed)) {
      if (/session|trace|journey/i.test(k)) console.log(`   [${tag}] body["${k}"] = ${JSON.stringify(parsed[k])}`)
    }
  } catch (e) {
    console.log(`   [${tag}] body not JSON: ${e.message}`)
  }
}

async function main() {
  const key = loadKey()
  console.log("=== NovitaAI wire dump ===")
  console.log(`model: ${MODEL} (key loaded, not printed)\n`)

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 32,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  })
  const reqHeaders = {
    "x-request-id": "req_wiredump_1",
    "x-novita-session-id": "ses_wiredump_NOVITA",
    "x-session-id": "ses_wiredump_PLAIN",
  }

  // 1. Non-stream /v3/openai — full dump
  console.log("--- 1. POST /v3/openai/chat/completions (non-stream) ---")
  try {
    const res = await h2Request({ key, requestPath: "/v3/openai/chat/completions", headers: reqHeaders, body })
    console.log(`   :status ${res.status}`)
    dumpHeaders("nonstream-v3", res.headers)
    dumpBody("nonstream-v3", res.body)
  } catch (e) {
    console.log(`   transport error: ${e.message}`)
  }

  // 2. Streaming /v3/openai — headers + raw SSE events (first + last)
  console.log("\n--- 2. POST /v3/openai/chat/completions (stream) ---")
  try {
    const res = await h2StreamRaw({
      key,
      requestPath: "/v3/openai/chat/completions",
      headers: { ...reqHeaders, "x-request-id": "req_wiredump_2" },
      body: JSON.stringify({ ...JSON.parse(body), stream: true }),
    })
    console.log(`   :status ${res.status} | SSE events: ${res.totalEvents}`)
    dumpHeaders("stream-v3", res.headers)
    console.log(`   [stream-v3] first ${res.firstEvents.length} SSE data events:`)
    for (const ev of res.firstEvents) console.log(`      ${ev.slice(0, 300)}`)
    console.log(`   [stream-v3] LAST SSE data event:`)
    console.log(`      ${res.lastEvent ? res.lastEvent.slice(0, 400) : "(none)"}`)
    if (res.lastEvent && /session|trace/i.test(res.lastEvent)) {
      const m = res.lastEvent.match(/"(session[^"]*|trace[^"]*)"\s*:\s*"([^"]*)"/gi)
      if (m) console.log(`   [stream-v3] session/trace fields in last event: ${m.join(", ")}`)
    }
  } catch (e) {
    console.log(`   transport error: ${e.message}`)
  }

  // 3. Non-stream production path /openai — compare header sets
  console.log("\n--- 3. POST /openai/chat/completions (non-stream, prod path) ---")
  try {
    const res = await h2Request({
      key,
      requestPath: "/openai/chat/completions",
      headers: { ...reqHeaders, "x-request-id": "req_wiredump_3" },
      body,
    })
    console.log(`   :status ${res.status}`)
    dumpHeaders("nonstream-openai", res.headers)
    if (res.status === 200) dumpBody("nonstream-openai", res.body)
  } catch (e) {
    console.log(`   transport error: ${e.message}`)
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
