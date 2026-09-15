// Bun 1.4.0 client-side HTTP/3 decisive probe:
// fetch https://api.novita.ai with protocol:"http3" (per-request pin)
// and with the global experimental flag + alt-svc upgrade path.
// Usage: bun scripts/probe-bun-h3-client.mjs

console.log("bun:", Bun.version)

// 1. Per-request pin: protocol: "http3"
try {
  const started = Date.now()
  const res = await fetch("https://api.novita.ai/v3/openai/models", {
    protocol: "http3",
    headers: { "user-agent": "opencode-probe/1.0" },
  })
  console.log(`per-request http3: status ${res.status} in ${Date.now() - started}ms`)
} catch (e) {
  console.log(`per-request http3: FAILED (${e.message}${e.code ? " code=" + e.code : ""})`)
}

// 2. Per-request pin: "h3" alias
try {
  const res = await fetch("https://api.novita.ai/v3/openai/models", {
    protocol: "h3",
    headers: { "user-agent": "opencode-probe/1.0" },
  })
  console.log(`per-request h3 alias: status ${res.status}`)
} catch (e) {
  console.log(`per-request h3 alias: FAILED (${e.message})`)
}

// 3. Baseline h2 pin (must work — our prod transport)
try {
  const res = await fetch("https://api.novita.ai/v3/openai/models", {
    protocol: "http2",
    headers: { "user-agent": "opencode-probe/1.0" },
  })
  console.log(`per-request http2 (control): status ${res.status}`)
} catch (e) {
  console.log(`per-request http2 (control): FAILED (${e.message})`)
}

// 4. Alt-svc upgrade path: env flag is set by wrapper before bun starts.
console.log("BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT =", process.env.BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT ?? "(unset)")
