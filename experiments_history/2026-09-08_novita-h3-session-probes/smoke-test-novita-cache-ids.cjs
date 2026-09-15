// NovitaAI prompt-cache probe — does the cache depend on correlation ids?
//
// User hypothesis chain: Session ID column empty -> maybe cache falls because
// affinity is missing. This probe measures usage.cached_tokens (GLM dialect:
// usage.prompt_tokens_details.cached_tokens / prompt_cache_hit_tokens) across
// three id regimes with an IDENTICAL padded prompt:
//
//   R1: 3x UNIQUE ids (request-id, session headers all different per request)
//   R2: 3x SAME session ids, unique request ids      (prod-like per-session)
//   R3: 3x SAME request id, unique session ids       (affinity-via-request-id)
//
// Decisive readout:
//   R1 #2/#3 cached_tokens > 0  -> cache is prompt-prefix-global (ids irrelevant)
//   R1 all cold, R2 #2/#3 hot   -> cache keyed per session id
//   only R3 hot                 -> cache keyed per request id
//   all cold                    -> threshold not reached or per-upstream roulette
//
// Padding ~4000 tokens to clear the cache threshold deterministically.
// Usage: node scripts/smoke-test-novita-cache-ids.cjs

const fs = require("node:fs")
const path = require("node:path")
const http2 = require("node:http2")

const HOST = "api.novita.ai"
const MODEL = "zai-org/glm-5.3-flash"
const AUTH_PATH = path.join(__dirname, "..", "bin", "auth.json")
const CHAT_PATH = "/openai/chat/completions" // production path

function loadKey() {
  if (process.env.NOVITA_API_KEY) return process.env.NOVITA_API_KEY
  const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"))
  const entry = auth["novita-ai"]
  if (!entry || !entry.key) throw new Error(`no novita-ai key found (env NOVITA_API_KEY or ${AUTH_PATH})`)
  return entry.key
}

function h2Request({ key, headers, body, timeoutMs = 45000 }) {
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
        ":path": CHAT_PATH,
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
        resolve({ status: Number(responseHeaders[":status"] || 0), body: data })
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

// Deterministic padding ~4.2K tokens (≈17KB English text).
const CHUNK = "The transport layer negotiates TLS 1.3 with ALPN, then opens a bidirectional stream. " +
  "Each request carries a content-length frame, a bearer token, and a correlation identifier. " +
  "The scheduler dispatches work to the nearest replica, honoring affinity when the pool allows it. "
const PADDING = CHUNK.repeat(52) // ≈ 3.6K tokens; message adds more
const message = `Context dump for cache experiment:\n${PADDING}\nEnd of context. Reply with exactly: OK`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function send({ label, requestId, sessionIds }) {
  const headers = {
    "x-request-id": requestId,
    ...(sessionIds
      ? {
          "x-novita-session-id": sessionIds.novita,
          "x-session-id": sessionIds.plain,
          "x-session-affinity": sessionIds.affinity,
        }
      : {}),
  }
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 8,
    messages: [{ role: "user", content: message }],
  })
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now()
    try {
      const res = await h2Request({ key: global.__key, headers, body })
      if (res.status === 429) {
        console.log(`${label}: 429 overload, retry ${attempt}/3 in 4s`)
        await sleep(4000)
        continue
      }
      if (res.status !== 200) {
        console.log(`${label}: HTTP ${res.status} — ${res.body.slice(0, 140)}`)
        return
      }
      const parsed = JSON.parse(res.body)
      const usage = parsed.usage || {}
      const cached =
        usage.prompt_cache_hit_tokens ??
        usage.prompt_tokens_details?.cached_tokens ??
        usage.prompt_tokens_details?.cachedTokens
      console.log(
        `${label}: 200 (${Date.now() - started}ms) prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} cached=${cached ?? "absent"}`,
      )
      if (attempt === 1 && cached === undefined) {
        console.log(`   usage dump: ${JSON.stringify(usage)}`)
      }
      return
    } catch (e) {
      console.log(`${label}: transport error (${e.message}), retry ${attempt}/3`)
      await sleep(2000)
    }
  }
  console.log(`${label}: FAILED after retries`)
}

async function main() {
  global.__key = loadKey()
  console.log("=== NovitaAI cache-vs-ids probe ===")
  console.log(`model: ${MODEL} | path: ${CHAT_PATH} | padding ≈ 4.2K tokens | identical prompt every request\n`)

  console.log("--- R1: unique ids everywhere (x3) ---")
  for (let i = 1; i <= 3; i++) {
    await send({
      label: `R1 req${i}`,
      requestId: `req_cache_r1_${i}`,
      sessionIds: { novita: `ses_r1_${i}_n`, plain: `ses_r1_${i}_p`, affinity: `ses_r1_${i}_a` },
    })
    await sleep(1200)
  }

  console.log("\n--- R2: same session ids, unique request ids (x3) ---")
  for (let i = 1; i <= 3; i++) {
    await send({
      label: `R2 req${i}`,
      requestId: `req_cache_r2_${i}`,
      sessionIds: { novita: "ses_r2_group", plain: "ses_r2_group", affinity: "ses_r2_group" },
    })
    await sleep(1200)
  }

  console.log("\n--- R3: same request id, unique session ids (x3) ---")
  for (let i = 1; i <= 3; i++) {
    await send({
      label: `R3 req${i}`,
      requestId: "req_cache_r3_group",
      sessionIds: { novita: `ses_r3_${i}_n`, plain: `ses_r3_${i}_p`, affinity: `ses_r3_${i}_a` },
    })
    await sleep(1200)
  }

  console.log("\n=== Readout guide ===")
  console.log("R1 #2/#3 cached>0  -> cache global by prompt prefix (ids irrelevant)")
  console.log("R1 cold, R2 #2/#3 hot -> cache keyed per session id")
  console.log("only R3 hot        -> cache keyed per request id")
  console.log("all cold           -> threshold/unreached or upstream-pool roulette (affinity broken at fusion)")
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
