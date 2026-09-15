// Live probe (opt-in): reads the novita-ai key from bin/auth.json silently.
// Verifies the official balance endpoint + our 1/10000 USD scaling:
//   GET https://api.novita.ai/openapi/v1/billing/balance/detail
// Prints NOTHING secret. SKIP (exit 0) without a key.
import { readFileSync } from "node:fs"

let key
try {
  const auth = JSON.parse(readFileSync(new URL("../../bin/auth.json", import.meta.url), "utf8"))
  key = auth["novita-ai"]?.key
} catch {}
if (!key) {
  console.log("SKIP: no novita-ai key in bin/auth.json")
  process.exit(0)
}
console.log("key: loaded (bin/auth.json, novita-ai)")

const res = await fetch("https://api.novita.ai/openapi/v1/billing/balance/detail", {
  headers: { authorization: `Bearer ${key}`, accept: "application/json" },
})
console.log("http:", res.status)
const data = await res.json().catch(() => ({}))
const units = Number.parseFloat(data.availableBalance ?? "NaN")
const usd = Number.isFinite(units) ? units / 10_000 : NaN
console.log(JSON.stringify({ availableBalanceUnits: data.availableBalance, scaledUSD: usd, http: res.status }))

let ok = res.status === 200 && Number.isFinite(usd)
if (ok) console.log(`LIVE PROBE PASS — novita-ai: $${usd.toFixed(2)}`)
else console.log("LIVE PROBE FAIL")
process.exit(ok ? 0 : 1)
