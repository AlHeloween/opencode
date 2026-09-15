// NovitaAI "Session ID" dashboard column — differential smoke test.
//
// Problem: opencode sends x-request-id + x-session-id (+ x-session-affinity)
// on https://api.novita.ai/openai/chat/completions — Novita console shows the
// Request ID but the Session ID column stays "-".
//
// Hypothesis under test (user's consultant): the /openai path is a legacy stub
// that ignores x-session-id; /v3/openai honors session routing headers.
// Citations the consultant gave were LiteLLM docs — unrelated to Novita, so
// this is treated as an unverified claim; this test decides it.
//
// Differential design: each request carries 4 DISTINCT ids in 4 candidate
// headers. Whatever shows up in the Novita console "Session ID" column names
// the header the server actually reads; the request id maps the row to the
// endpoint that produced it.
//
//   x-request-id           req_smoke_<tag>          (row key, already works)
//   x-novita-session-id    ses_smoke_<tag>_NOVITAHDR   (user's candidate 1)
//   x-session-id           ses_smoke_<tag>_PLAINHDR    (user's candidate 2 / current prod)
//   x-session-affinity     ses_smoke_<tag>_AFFINITY    (current prod companion)
//
// Endpoints: /openai/chat/completions (tag Aopenai) and /v3/openai/chat/completions (tag Bv3).
//
// NOTE: HTTP/2 forbids uppercase header names — Node http2 requires lowercase;
// the console matches case-insensitively.
//
// Key resolution: NOVITA_API_KEY env var, else bin/auth.json ("novita-ai" entry).
// The key is never printed.
//
// Usage: node scripts/smoke-test-novita-session-id.cjs

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

// Single non-stream POST over a fresh H2 session.
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

async function main() {
  const key = loadKey()
  console.log("=== NovitaAI Session-ID differential smoke ===")
  console.log(`model: ${MODEL} (key loaded, not printed)\n`)

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 256,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  })

  const targets = [
    { tag: "Aopenai", requestPath: "/openai/chat/completions" },
    { tag: "Bv3", requestPath: "/v3/openai/chat/completions" },
  ]

  let any200 = false
  for (const { tag, requestPath } of targets) {
    const ids = {
      requestId: `req_smoke_${tag}`,
      novitaHdr: `ses_smoke_${tag}_NOVITAHDR`,
      plainHdr: `ses_smoke_${tag}_PLAINHDR`,
      affinity: `ses_smoke_${tag}_AFFINITY`,
    }
    const headers = {
      "x-request-id": ids.requestId,
      "x-novita-session-id": ids.novitaHdr,
      "x-session-id": ids.plainHdr,
      "x-session-affinity": ids.affinity,
    }
    console.log(`--- ${requestPath} (tag ${tag}) ---`)
    console.log(`   x-request-id         : ${ids.requestId}`)
    console.log(`   x-novita-session-id  : ${ids.novitaHdr}`)
    console.log(`   x-session-id         : ${ids.plainHdr}`)
    console.log(`   x-session-affinity   : ${ids.affinity}`)
    const started = Date.now()
    try {
      const res = await h2Request({ key, requestPath, headers, body })
      console.log(`   :status ${res.status} (${Date.now() - started}ms)`)
      const echo = Object.entries(res.headers)
        .filter(([k]) => k.includes("request") || k.includes("session") || k.includes("trace"))
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
      if (echo) console.log(`   response correlation headers: ${echo}`)
      if (res.status !== 200) {
        console.log(`   body: ${res.body.slice(0, 300)}`)
        continue
      }
      any200 = true
      let parsed = {}
      try {
        parsed = JSON.parse(res.body)
      } catch {
        console.log(`   non-JSON body: ${res.body.slice(0, 200)}`)
      }
      const usage = parsed.usage || {}
      const content = parsed.choices?.[0]?.message?.content
      console.log(`   content: ${JSON.stringify(content)} | usage: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}`)
    } catch (e) {
      console.log(`   transport error: ${e.message}`)
    }
    console.log("")
  }

  console.log("=== What to check in the Novita console ===")
  console.log("Open the request log and find rows by x-request-id:")
  for (const { tag, requestPath } of targets) {
    console.log(`   ${requestPath}  ->  req_smoke_${tag}`)
  }
  console.log("For each row look at the Session ID column. It will name EXACTLY the")
  console.log("value of the header the server reads (NOVITAHDR / PLAINHDR / AFFINITY),")
  console.log("or stay \"-\" if none is read on that endpoint.")
  console.log("\n=== Verdict ===")
  console.log(`transport/inference: ${any200 ? "PASS (at least one path 200)" : "FAIL"}`)
  process.exit(any200 ? 0 : 1)
}

void main()
