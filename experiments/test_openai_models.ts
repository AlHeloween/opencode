/**
 * Validate all Codex API-available models using OAuth auth.
 *
 * 1. GET /backend-api/codex/models  — discover available models
 * 2. POST /backend-api/codex/responses — test each with "2+2=?"
 * 3. Report which work, which fail, and why
 *
 * Usage: bun run experiments/test_openai_models.ts
 * Output: experiments/results_YYYY-MM-DD.json + .md
 */

const AUTH_FILE = "bin/auth.json"
const OUTPUT_DIR = "experiments"
const MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models"
const RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token"
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const TIMEOUT_MS = 30_000

interface OAuthInfo {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

interface CodexModel {
  slug: string
  prefer_websockets?: boolean
  support_verbosity?: boolean
  input_modalities?: string[]
}

interface TestResult {
  id: string
  status: "ok" | "error" | "skipped"
  response_time_ms: number
  sample?: string
  error?: string
}

async function readJSON(path: string): Promise<unknown> {
  return await Bun.file(path).json()
}

function isExpired(expiresMs: number): boolean {
  return Date.now() + 60_000 > expiresMs
}

async function refreshOAuthToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
  })
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`)
  return await res.json()
}

async function codexFetch(
  url: string,
  accessToken: string,
  accountId: string | undefined,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${accessToken}`)
  headers.set("Content-Type", "application/json")
  if (accountId) headers.set("ChatGPT-Account-Id", accountId)
  return fetch(url, { ...init, headers })
}

async function main() {
  console.log("╔══════════════════════════════════════════════╗")
  console.log("║   Codex API Model Validation Test            ║")
  console.log("╚══════════════════════════════════════════════╝\n")

  // 1. Auth
  console.log("📖 Loading auth.json...")
  const authAll = (await readJSON(AUTH_FILE)) as Record<string, unknown>
  const oauth = authAll["openai"] as OAuthInfo | undefined
  if (!oauth || oauth.type !== "oauth") {
    console.error("❌ No OpenAI OAuth entry found in auth.json")
    process.exit(1)
  }
  console.log(`   Account: ${oauth.accountId ?? "unknown"}`)

  let accessToken = oauth.access
  if (isExpired(oauth.expires)) {
    console.log("   🔄 Token expired, refreshing...")
    const t = await refreshOAuthToken(oauth.refresh)
    accessToken = t.access_token
    console.log(`   ✅ Token refreshed`)
  } else {
    console.log("   ✅ Token valid")
  }

  // 2. Fetch models from Codex API
  console.log("\n📡 Fetching model list from /backend-api/codex/models...")
  const modelsUrl = new URL(MODELS_ENDPOINT)
  modelsUrl.searchParams.set("client_version", "1.14.28")
  const modelsRes = await codexFetch(modelsUrl.toString(), accessToken, oauth.accountId)

  if (!modelsRes.ok) {
    const text = await modelsRes.text()
    console.error(`❌ Failed to fetch models: ${modelsRes.status} — ${text.slice(0, 300)}`)
    process.exit(1)
  }

  const modelsData = (await modelsRes.json()) as { models?: CodexModel[] }
  const allModels = modelsData.models ?? []
  console.log(`   ✅ ${allModels.length} models available`)
  allModels.slice(0, 5).forEach((m) => console.log(`      - ${m.slug}`))
  if (allModels.length > 5) console.log(`      ... and ${allModels.length - 5} more`)

  const skipPrefixes = ["gpt-image-", "text-embedding-", "chatgpt-image-", "gpt-realtime-"]
  const testable = allModels
    .filter((m) => !skipPrefixes.some((p) => m.slug.startsWith(p)))
    .sort((a, b) => a.slug.localeCompare(b.slug))
  console.log(`   🧪 ${testable.length} testable after filtering\n`)

  // 3. Test each model
  const results: TestResult[] = []
  let passed = 0
  let failed = 0

  for (let i = 0; i < testable.length; i++) {
    const model = testable[i]
    const start = Date.now()

    const entry: TestResult = {
      id: model.slug,
      status: "error",
      response_time_ms: 0,
    }

    try {
      const res = await codexFetch(
        RESPONSES_ENDPOINT,
        accessToken,
        oauth.accountId,
        {
          method: "POST",
          body: JSON.stringify({
            model: model.slug,
            input: [{ role: "user", content: [{ type: "input_text", text: "2+2=?" }] }],
            reasoning: { effort: "low" },
            parallel_tool_calls: true,
            tool_choice: "auto",
            include: ["reasoning.encrypted_content"],
            store: false,
            stream: true,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      )

      const elapsed = Date.now() - start
      entry.response_time_ms = elapsed

      if (res.ok) {
        const body = await res.text()
        let content = ""

        const lines = body.split("\n")
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === "response.output_text.delta") {
                content = (data.delta as string) ?? ""
              }
              if (data.type === "response.done" && data.response) {
                const output = data.response.output as Array<Record<string, unknown>> | undefined
                if (output) {
                  for (const item of output) {
                    if (item.type === "message") {
                      const msgContent = item.content as Array<Record<string, unknown>> | undefined
                      if (msgContent) {
                        for (const c of msgContent) {
                          if (c.type === "output_text") {
                            content = (c.text as string) ?? content
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch {}
          }
        }

        entry.status = "ok"
        entry.sample = content.trim().slice(0, 100) || "(no text output)"
        passed++
        console.log(`   [${i + 1}/${testable.length}] ✅ ${model.slug} — ${elapsed}ms — ${content.trim().slice(0, 60)}`)
      } else {
        const errorText = await res.text()
        let msg = `HTTP ${res.status}`
        try {
          const err = JSON.parse(errorText)
          msg = err?.detail ?? err?.error?.message ?? msg
        } catch { msg = errorText.slice(0, 200) }
        entry.status = "error"
        entry.error = msg
        failed++
        console.log(`   [${i + 1}/${testable.length}] ❌ ${model.slug} — ${elapsed}ms — ${msg.slice(0, 80)}`)
      }
    } catch (err) {
      entry.response_time_ms = Date.now() - start
      entry.status = "error"
      entry.error = String(err).slice(0, 200)
      failed++
      console.log(`   [${i + 1}/${testable.length}] ❌ ${model.slug} — ${entry.response_time_ms}ms — ${String(err).slice(0, 60)}`)
    }

    results.push(entry)
  }

  // 4. Report
  const dateStr = new Date().toISOString().slice(0, 10)
  const report = {
    test_time: new Date().toISOString(),
    auth: { type: "oauth", accountId: oauth.accountId },
    api: RESPONSES_ENDPOINT,
    total_models: allModels.length,
    tested: testable.length,
    passed,
    failed,
    results,
  }

  const jsonPath = `${OUTPUT_DIR}/results_${dateStr}.json`
  await Bun.write(jsonPath, JSON.stringify(report, null, 2))

  const mdPath = `${OUTPUT_DIR}/results_${dateStr}.md`
  let md = `# Codex API Model Validation — ${dateStr}\n\n`
  md += `| Metric | Value |\n|--------|-------|\n`
  md += `| Test time | ${report.test_time} |\n`
  md += `| Auth | OAuth (${oauth.accountId}) |\n`
  md += `| Total models | ${report.total_models} |\n`
  md += `| Tested | ${report.tested} |\n`
  md += `| ✅ Passed | ${report.passed} |\n`
  md += `| ❌ Failed | ${report.failed} |\n\n`

  md += `## ✅ Working Models (${passed})\n\n`
  md += `| Model | Time | Sample |\n|------|------|--------|\n`
  for (const r of results.filter((r) => r.status === "ok")) {
    md += `| ${r.id} | ${r.response_time_ms}ms | ${r.sample ?? ""} |\n`
  }

  md += `\n## ❌ Failing Models (${failed})\n\n`
  md += `| Model | Error |\n|------|-------|\n`
  for (const r of results.filter((r) => r.status === "error")) {
    md += `| ${r.id} | ${r.error} |\n`
  }

  await Bun.write(mdPath, md)

  console.log(`\n📄 ${jsonPath}`)
  console.log(`📄 ${mdPath}`)
  console.log("\n" + "─".repeat(50))
  console.log(`\n📊 RESULTS: ${passed} working, ${failed} failing, out of ${testable.length} tested`)

  console.log("\n🔹 Working models:")
  for (const r of results.filter((r) => r.status === "ok")) {
    console.log(`   openai/${r.id}`)
  }
}

main().catch((err) => {
  console.error("❌ Fatal:", err)
  process.exit(1)
})
