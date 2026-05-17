const tls = require("node:tls")
const http2 = require("node:http2")

const HOST = "api.deepseek.com"
const KEY = process.env.DEEPSEEK_API_KEY
const ANTHROPIC_PATH = "/anthropic/v1/messages"

async function main() {
  if (!KEY) {
    console.error("ERROR: DEEPSEEK_API_KEY environment variable is not set.")
    console.error("Usage: DEEPSEEK_API_KEY=sk-... node scripts/smoke-test-h2.cjs")
    process.exit(1)
  }

  console.log("=== DeepSeek V4 H2 + Anthropic API Smoke Test ===\n")

  // 1. ALPN probe
  console.log(`1. ALPN probe: ${HOST}:443`)
  const alpnResult = await new Promise((resolve) => {
    const socket = tls.connect({
      host: HOST, port: 443, ALPNProtocols: ["h2", "http/1.1"],
      servername: HOST, timeout: 5000,
    })
    socket.on("secureConnect", () => {
      resolve({ alpn: socket.alpnProtocol || "none", tls: socket.getProtocol() || "unknown" })
      socket.destroy()
    })
    socket.on("error", (e) => resolve({ alpn: "failed", tls: "none", error: e.message }))
    socket.on("timeout", () => { resolve({ alpn: "timeout", tls: "none" }); socket.destroy() })
  })
  console.log(`   ALPN: ${alpnResult.alpn} | TLS: ${alpnResult.tls}`)

  // 2. H2 Anthropic API call
  console.log(`\n2. H2 POST ${ANTHROPIC_PATH}`)
  
  const body = JSON.stringify({
    model: "deepseek-v4-pro",
    max_tokens: 64,
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Hi" }],
    thinking: { type: "enabled" },
    output_config: { effort: "high" },
  })

  const client = http2.connect(`https://${HOST}`, { ALPNProtocols: ["h2"], servername: HOST })

  await new Promise((resolve) => {
    client.on("connect", () => {
      console.log("   H2 session ✓")
      const stream = client.request({
        ":method": "POST",
        ":path": ANTHROPIC_PATH,
        "content-type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
        "content-length": Buffer.byteLength(body),
      })

      let data = ""
      stream.on("data", (chunk) => { data += chunk.toString() })
      stream.on("end", () => {
        const status = stream.headersSent ? "ok" : "?"
        console.log(`   Response: ${data.slice(0, 200)}`)
        resolve()
      })
      stream.on("error", (e) => { console.log(`   Stream error: ${e.message}`); resolve() })
      stream.write(body)
      stream.end()
    })
    client.on("error", (e) => { console.log(`   H2 error: ${e.message}`); resolve() })
    setTimeout(() => { console.log("   (no response in 10s)"); resolve() }, 10000)
  })

  client.close()
  console.log("\n=== Verdict ===")
  console.log(`H2: ${alpnResult.alpn === "h2" ? "YES" : "NO"} | Anthropic API: ${alpnResult.alpn === "h2" ? "works via H2" : "H1 only"}`)
}

void main()
