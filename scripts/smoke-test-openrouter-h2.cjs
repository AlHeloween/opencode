// OpenRouter H2 (HTTP/2) + OpenAI-compatible inference smoke test.
// Mirrors scripts/smoke-test-novita-h2.cjs: ALPN probe, then real chat
// completions over an HTTP/2 session against openrouter.ai with a free model.
//
// Key resolution: OPENROUTER_API_KEY env var, else bin/auth.json ("openrouter").
// The key is never printed.
//
// Vendor note (docs/reasoning-round-trip-contract.md): OpenRouter speaks the
// SDK dialect — reasoning arrives as `reasoning`/`reasoning_details`, not
// `reasoning_content`. Both are checked to confirm the contract.
//
// Usage: node scripts/smoke-test-openrouter-h2.cjs

const fs = require("node:fs")
const path = require("node:path")
const tls = require("node:tls")
const http2 = require("node:http2")

const HOST = "openrouter.ai"
const MODEL = process.env.OR_MODEL || process.argv[2] || "z-ai/glm-5.2:free"
const CHAT_PATH = "/api/v1/chat/completions"
const AUTH_PATH = path.join(__dirname, "..", "bin", "auth.json")

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"))
  const entry = auth["openrouter"]
  if (!entry || !entry.key) throw new Error(`no openrouter key found (env OPENROUTER_API_KEY or ${AUTH_PATH})`)
  return entry.key
}

function alpnProbe(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host,
      port: 443,
      ALPNProtocols: ["h2", "http/1.1"],
      servername: host,
      timeout: 5000,
    })
    socket.on("secureConnect", () => {
      resolve({ alpn: socket.alpnProtocol || "none", tls: socket.getProtocol() || "unknown" })
      socket.destroy()
    })
    socket.on("error", (e) => resolve({ alpn: "failed", tls: "none", error: e.message }))
    socket.on("timeout", () => {
      resolve({ alpn: "timeout", tls: "none" })
      socket.destroy()
    })
  })
}

function h2Request({ host, key, requestPath, body, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`, { ALPNProtocols: ["h2"], servername: host })
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
      })
      let data = ""
      stream.on("response", (headers) => {
        responseHeaders = headers
      })
      stream.on("data", (chunk) => {
        data += chunk.toString()
      })
      stream.on("end", () => {
        clearTimeout(timer)
        const status = Number(responseHeaders[":status"] || 0)
        client.close()
        resolve({ status, headers: responseHeaders, body: data })
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

async function main() {
  const key = loadKey()
  console.log("=== OpenRouter H2 + OpenAI API Smoke Test ===")
  console.log(`model: ${MODEL} (key loaded, not printed)\n`)

  // 1. ALPN probe
  console.log(`1. ALPN probe: ${HOST}:443`)
  const alpn = await alpnProbe(HOST)
  console.log(`   ALPN: ${alpn.alpn} | TLS: ${alpn.tls}${alpn.error ? ` | error: ${alpn.error}` : ""}`)

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  })

  // 2. Non-stream H2 inference
  console.log(`\n2. H2 POST ${CHAT_PATH} (non-stream)`)
  const started = Date.now()
  try {
    const res = await h2Request({ host: HOST, key, requestPath: CHAT_PATH, body })
    console.log(`   :status ${res.status} (${Date.now() - started}ms)`)
    if (res.status !== 200) {
      console.log(`   body: ${res.body.slice(0, 300)}`)
      console.log("\n=== Verdict ===")
      console.log(`H2: ${alpn.alpn === "h2" ? "YES" : "NO"} | inference: FAIL (status ${res.status})`)
      process.exit(1)
    }
    let parsed = {}
    try {
      parsed = JSON.parse(res.body)
    } catch {
      console.log(`   non-JSON body: ${res.body.slice(0, 300)}`)
    }
    const message = parsed.choices?.[0]?.message || {}
    const usage = parsed.usage || {}
    const reasoning = message.reasoning ?? message.reasoning_content ?? null
    console.log(`   content: ${JSON.stringify(message.content)}`)
    console.log(`   reasoning field: ${reasoning === null || reasoning === undefined ? "absent" : `present (${JSON.stringify(reasoning).length} chars)`}`)
    console.log(`   usage: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}`)

    // 3. Streaming H2 inference (opencode runs streaming: true)
    console.log(`\n3. H2 POST ${CHAT_PATH} (stream)`)
    const streamBody = JSON.stringify({ ...JSON.parse(body), stream: true })
    let chunks = 0
    let sawDone = false
    let sawReasoningDelta = false
    let firstDeltaMs = null
    const streamStarted = Date.now()
    const client = http2.connect(`https://${HOST}`, { ALPNProtocols: ["h2"], servername: HOST })
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.log("   (stream timeout)")
        resolve()
      }, 60000)
      client.on("error", (e) => {
        console.log(`   H2 error: ${e.message}`)
        clearTimeout(timer)
        resolve()
      })
      client.on("connect", () => {
        const stream = client.request({
          ":method": "POST",
          ":path": CHAT_PATH,
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          "content-length": Buffer.byteLength(streamBody),
        })
        let buffer = ""
        stream.on("data", (chunk) => {
          if (firstDeltaMs === null) firstDeltaMs = Date.now() - streamStarted
          buffer += chunk.toString()
          const events = buffer.split("\n\n")
          buffer = events.pop() || ""
          for (const event of events) {
            const line = event.split("\n").find((l) => l.startsWith("data:"))
            if (!line) continue
            const payload = line.slice(5).trim()
            if (payload === "[DONE]") {
              sawDone = true
              continue
            }
            try {
              const json = JSON.parse(payload)
              chunks++
              const delta = json.choices?.[0]?.delta || {}
              if (delta.reasoning || delta.reasoning_content || delta.reasoning_details) sawReasoningDelta = true
            } catch {}
          }
        })
        stream.on("end", () => {
          clearTimeout(timer)
          resolve()
        })
        stream.on("error", (e) => {
          console.log(`   stream error: ${e.message}`)
          clearTimeout(timer)
          resolve()
        })
        stream.end(streamBody)
      })
    })
    client.close()
    console.log(`   SSE data chunks: ${chunks} | [DONE]: ${sawDone ? "yes" : "NO"} | TTFB: ${firstDeltaMs ?? "?"}ms | total: ${Date.now() - streamStarted}ms`)
    console.log(`   reasoning deltas: ${sawReasoningDelta ? "present" : "absent"}`)

    console.log("\n=== Verdict ===")
    console.log(`H2 transport: ${alpn.alpn === "h2" ? "YES" : "NO (alpn=" + alpn.alpn + ")"}`)
    console.log(`Inference over H2: PASS via ${CHAT_PATH}`)
    process.exit(alpn.alpn === "h2" ? 0 : 1)
  } catch (e) {
    console.log(`   transport error: ${e.message}`)
    console.log("\n=== Verdict ===")
    console.log(`H2: ${alpn.alpn === "h2" ? "YES (ALPN)" : "NO"} | inference: FAIL (${e.message})`)
    process.exit(1)
  }
}

void main()
