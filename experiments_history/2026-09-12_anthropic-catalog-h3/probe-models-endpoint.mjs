// Anthropic catalog-source probe — can PROVIDER_SOURCES (provider-sync.ts) take
// an "anthropic" entry the way novita-ai and openrouter do?
//
// The two existing sources are PUBLIC endpoints, fetched at build time with no
// credentials. This probe establishes whether api.anthropic.com/v1/models can
// play the same role, and exactly which models.dev fields it can fill.
//
// Without a key it records the auth contract (that is the finding).
// With ANTHROPIC_API_KEY it dumps the real field set of one entry plus the
// per-field coverage across the whole list.
//
// Usage:
//   bun run experiments/2026-09-12_anthropic-catalog-h3/probe-models-endpoint.mjs
//   ANTHROPIC_API_KEY=sk-ant-... bun run experiments/2026-09-12_anthropic-catalog-h3/probe-models-endpoint.mjs

const KEY = process.env.ANTHROPIC_API_KEY
const URL_MODELS = "https://api.anthropic.com/v1/models?limit=100"

// models.dev fields provider-sync.ts's mapModel must produce (ModelsDevModel).
const REQUIRED = [
  "id", "name", "attachment", "reasoning", "tool_call", "temperature",
  "release_date", "modalities", "limit.context", "limit.output",
]
const VALUABLE = ["cost.input", "cost.output", "cost.cache_read", "cost.cache_write", "reasoning_options", "family", "knowledge", "status"]

const res = await fetch(URL_MODELS, {
  headers: {
    "anthropic-version": "2023-06-01",
    ...(KEY ? { "x-api-key": KEY } : {}),
    "user-agent": "opencode-catalog-probe",
  },
})

console.log(`GET ${URL_MODELS}`)
console.log(`status: ${res.status} ${res.statusText}`)
const text = await res.text()

if (!res.ok) {
  console.log(`body: ${text.slice(0, 300)}`)
  console.log(
    "\nFINDING: the catalog endpoint is NOT public." +
      "\nnovita-ai and openrouter sources fetch unauthenticated at build time" +
      "\n(provider-sync.ts:318-355). An anthropic source cannot do that — see" +
      "\nplans/2026-09-12_anthropic-catalog-sync.md for the two options" +
      "\n(build-time key vs runtime per-user refresh).",
  )
  process.exit(0)
}

const data = JSON.parse(text)
const models = data.data ?? []
console.log(`models returned: ${models.length}  has_more=${data.has_more}`)
console.log(`\nfirst entry verbatim:\n${JSON.stringify(models[0], null, 2)}`)

const keys = new Set()
for (const model of models) for (const key of Object.keys(model)) keys.add(key)
console.log(`\nunion of keys across ${models.length} entries: ${[...keys].sort().join(", ")}`)

const probeField = (path) => {
  const present = models.filter((model) => {
    let node = model
    for (const part of path.split(".")) node = node?.[part]
    return node !== undefined && node !== null
  }).length
  return `${present}/${models.length}`
}
console.log("\nmodels.dev REQUIRED field coverage (directly derivable):")
for (const field of REQUIRED) console.log(`  ${field.padEnd(20)} ${probeField(field)}`)
console.log("\nmodels.dev VALUABLE field coverage:")
for (const field of VALUABLE) console.log(`  ${field.padEnd(20)} ${probeField(field)}`)
console.log(
  "\nAnything at 0/N must keep coming from models.dev or the bundled JSON —" +
    "\nthe sync must MERGE, never replace, or it will erase pricing.",
)
