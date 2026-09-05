// NovitaAI H2 (HTTP/2) + OpenAI-compatible inference smoke test.
// Mirrors scripts/smoke-test-h2.cjs: ALPN probe, then real chat completions
// over an HTTP/2 session against api.novita.ai with zai-org/glm-5.3-flash.
//
// Key resolution: NOVITA_API_KEY env var, else bin/auth.json ("novita-ai" entry).
// The key is never printed.
//
// Usage: node scripts/smoke-test-novita-h2.cjs

const fs = require("node:fs")
const path = require("node:path")
const tls = require("node:tls")
const http2 = require("node:http2")

const HOST = "api.novita.ai"
const MODEL = "zai-org/glm-5.3-flash"
// models.dev registry ships api base https://api.novita.ai/openai; the live
// listing endpoint lives under /v3/openai — probe both chat paths.
const CHAT_PATHS = ["/v3/openai/chat/completions", "/openai/chat/completions"]
const AUTH_PATH = path.join(__dirname, "..", "bin", "auth.json")

function loadKey() {
  if (process.env.NOVITA_API_KEY) return process.env.NOVITA_API_KEY
  const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"))
  const entry = auth["novita-ai"]
  if (!entry || !entry.key) throw new Error(`no novita-ai key found (env NOVITA_API_KEY or ${AUTH_PATH})`)
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

// Single request over a fresh H2 session. Resolves {status, headers, body}.
function h2Request({ host, key, requestPath, body, timeoutMs = 30000 }) {
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
  console.log("=== NovitaAI H2 + OpenAI API Smoke Test ===")
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

  // 2. Non-stream H2 inference — first path that answers 200 wins
  console.log(`\n2. H2 POST ${MODEL} (non-stream)`)
  let winner = null
  for (const requestPath of CHAT_PATHS) {
    const started = Date.now()
    try {
      const res = await h2Request({ host: HOST, key, requestPath, body })
      console.log(`   ${requestPath} -> :status ${res.status} (${Date.now() - started}ms)`)
      if (res.status === 200) {
        winner = { requestPath, res }
        break
      }
      console.log(`   body: ${res.body.slice(0, 200)}`)
    } catch (e) {
      console.log(`   ${requestPath} -> transport error: ${e.message}`)
    }
  }

  if (!winner) {
    console.log("\n=== Verdict ===")
    console.log(`H2: ${alpn.alpn === "h2" ? "YES" : "NO"} | inference: FAIL (no path answered 200)`)
    process.exit(1)
  }

  let parsed = {}
  try {
    parsed = JSON.parse(winner.res.body)
  } catch {
    console.log(`   non-JSON body: ${winner.res.body.slice(0, 300)}`)
  }
  const message = parsed.choices?.[0]?.message || {}
  const usage = parsed.usage || {}
  const reasoning = message.reasoning_content ?? message.reasoning ?? null
  console.log(`   content: ${JSON.stringify(message.content)}`)
  console.log(`   reasoning_content: ${reasoning === null || reasoning === undefined ? "absent" : `present (${String(reasoning).length} chars)`}`)
  console.log(`   usage: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}`)

  // 3. Streaming H2 inference (opencode runs streaming: true)
  console.log(`\n3. H2 POST ${winner.requestPath} (stream)`)
  const streamBody = JSON.stringify({ ...JSON.parse(body), stream: true })
  let chunks = 0
  let sawDone = false
  let sawReasoningDelta = false
  let firstDeltaMs = null
  const streamStarted = Date.now()
  try {
    const client = http2.connect(`https://${HOST}`, { ALPNProtocols: ["h2"], servername: HOST })
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.log("   (stream timeout)")
        resolve()
      }, 30000)
      client.on("error", (e) => {
        console.log(`   H2 error: ${e.message}`)
        clearTimeout(timer)
        resolve()
      })
      client.on("connect", () => {
        const stream = client.request({
          ":method": "POST",
          ":path": winner.requestPath,
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
              if (delta.reasoning_content) sawReasoningDelta = true
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
  } catch (e) {
    console.log(`   stream failed: ${e.message}`)
  }

  console.log("\n=== Verdict ===")
  console.log(`H2 transport: ${alpn.alpn === "h2" ? "YES" : "NO (alpn=" + alpn.alpn + ")"}`)
  console.log(`Inference over H2: PASS via ${winner.requestPath}`)
  console.log(`Winning path matches registry api base (${"/openai"}): ${winner.requestPath.startsWith("/openai") ? "yes" : "NO — registry base likely needs /v3 prefix"}`)
  console.log(`reasoning_content: ${reasoning === null || reasoning === undefined ? "absent" : "present"}`)
  process.exit(alpn.alpn === "h2" ? 0 : 1)
}

void main()
