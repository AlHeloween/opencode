import { createServer, type Server } from "http"
import * as Log from "@opencode-ai/core/util/log"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { OAUTH_DUMMY_KEY } from "@/auth"

const log = Log.create({ service: "plugin.anthropic" })

const CLIENT_ID = atob("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl")
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
const TOKEN_URL = "https://api.anthropic.com/v1/oauth/token"
const OAUTH_PORT = 54545
const CALLBACK_PATH = "/callback"
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000
const CLAUDE_CODE_VERSION = "2.1.257"
const CLAUDE_CODE_SDK_VERSION = "0.112.1"
const CLAUDE_CODE_MAX_OUTPUT_TOKENS = 64_000
const CLAUDE_CODE_SYSTEM_INSTRUCTION = "You are Claude Code, Anthropic's official CLI for Claude."
const CCH_SEED = 0x4d659218e32a3268n
const CCH_PLACEHOLDER = "cch=00000"
const BILLING_PREFIX = "x-anthropic-billing-header:"

const OAUTH_BETAS = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "mid-conversation-system-2026-04-07",
  "fallback-credit-2026-06-01",
]

const STAINLESS_ARCH: Record<string, string> = {
  amd64: "x64",
  x64: "x64",
  arm64: "arm64",
  aarch64: "arm64",
  "386": "x86",
  x86: "x86",
  ia32: "x86",
}

const STAINLESS_OS: Record<string, string> = {
  darwin: "MacOS",
  win32: "Windows",
  windows: "Windows",
  linux: "Linux",
  freebsd: "FreeBSD",
}

export const ANTHROPIC_OAUTH_SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"

interface PkceCodes {
  verifier: string
  challenge: string
}

export interface AnthropicTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  account?: { uuid?: string; email_address?: string }
  organization?: { uuid?: string; name?: string }
}

export interface AnthropicOAuthIdentity {
  accountId?: string
  email?: string
  orgId?: string
  orgName?: string
}

interface CallbackResult {
  code: string
  state: string
}

interface PendingOAuth {
  state: string
  resolve: (result: CallbackResult) => void
  reject: (error: Error) => void
}

let oauthServer: Server | undefined
let oauthPort: number | undefined
let pendingOAuth: PendingOAuth | undefined
let refreshPromise: Promise<AnthropicTokenResponse> | undefined

function base64Url(bytes: Uint8Array | ArrayBuffer): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url")
}

export async function generatePKCE(): Promise<PkceCodes> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(96))
  const verifier = base64Url(verifierBytes)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(hash) }
}

export function generateState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}

export function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: ANTHROPIC_OAUTH_SCOPES,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

export function parseCallbackInput(input: string): { code: string; state?: string } | undefined {
  const value = input.trim()
  if (!value) return

  try {
    const url = new URL(value)
    const code = url.searchParams.get("code")
    if (code) return { code, state: url.searchParams.get("state") ?? undefined }
  } catch {
    // A code or fragment is not a URL. Parse below.
  }

  if (value.includes("code=")) {
    const query = value.replace(/^[?#]/, "")
    const params = new URLSearchParams(query)
    const code = params.get("code")
    if (code) return { code, state: params.get("state") ?? undefined }
  }

  const [code, state] = value.split("#", 2)
  return code ? { code, state: state || undefined } : undefined
}

export function extractIdentity(tokens: AnthropicTokenResponse): AnthropicOAuthIdentity {
  return {
    accountId: tokens.account?.uuid || undefined,
    email: tokens.account?.email_address || undefined,
    orgId: tokens.organization?.uuid || undefined,
    orgName: tokens.organization?.name || undefined,
  }
}

function tokenExpiry(expiresIn: number): number {
  return Date.now() + expiresIn * 1000 - EXPIRY_SAFETY_MARGIN_MS
}

async function postToken(body: Record<string, string>, headers: Record<string, string> = {}): Promise<AnthropicTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Anthropic token request failed: ${response.status} ${await response.text()}`)
  const data = (await response.json()) as AnthropicTokenResponse
  if (!data.access_token || !data.expires_in) throw new Error("Anthropic token response is missing access_token or expires_in")
  return data
}

export async function exchangeCodeForTokens(
  input: string,
  expectedState: string,
  redirectUri: string,
  pkce: PkceCodes,
): Promise<AnthropicTokenResponse> {
  const callback = parseCallbackInput(input)
  if (!callback) throw new Error("Missing authorization code")
  if (callback.state && callback.state !== expectedState) throw new Error("State mismatch - possible CSRF attack")
  return postToken({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: callback.code,
    state: callback.state ?? expectedState,
    redirect_uri: redirectUri,
    code_verifier: pkce.verifier,
  })
}

export async function refreshAccessToken(refreshToken: string): Promise<AnthropicTokenResponse> {
  return postToken(
    {
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    },
    {
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": `anthropic-sdk-typescript/${CLAUDE_CODE_SDK_VERSION} userOAuthProvider`,
    },
  )
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
}

function resultHtml(success: boolean, message = ""): string {
  const title = success ? "Authentication Successful" : "Authentication Failed"
  const body = success
    ? "You have successfully logged in. You can now close this tab."
    : escapeHtml(message || "An error occurred during authorization.")
  return `<!doctype html><html><head><meta charset="utf-8"><title>OpenCode - ${title}</title><style>body{font-family:system-ui,sans-serif;background:#131010;color:#f1ecec;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:36rem;padding:2rem;border:1px solid #443d3d;border-radius:12px;background:#1c1717}h1{margin-top:0}</style></head><body><main class="card"><h1>${title}</h1><p>${body}</p></main>${success ? "<script>setTimeout(()=>window.close(),3000)</script>" : ""}</body></html>`
}

function listen(server: Server, port: number): Promise<number> {
  const completion = Promise.withResolvers<number>()
  const onError = (error: Error) => {
    server.off("listening", onListening)
    completion.reject(error)
  }
  const onListening = () => {
    server.off("error", onError)
    const address = server.address()
    if (!address || typeof address === "string") {
      completion.reject(new Error("OAuth callback server has no TCP address"))
      return
    }
    completion.resolve(address.port)
  }
  server.once("error", onError)
  server.once("listening", onListening)
  server.listen(port)
  return completion.promise
}

async function startOAuthServer(): Promise<string> {
  if (oauthServer && oauthPort) return `http://localhost:${oauthPort}${CALLBACK_PATH}`

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost")
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404)
      res.end("Not Found")
      return
    }

    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const error = url.searchParams.get("error")
    const description = url.searchParams.get("error_description")
    if (error) {
      const message = description || error
      pendingOAuth?.reject(new Error(`Authorization failed: ${message}`))
      pendingOAuth = undefined
      res.writeHead(500, { "Content-Type": "text/html" })
      res.end(resultHtml(false, message))
      return
    }
    if (!code) {
      const message = "Missing authorization code"
      pendingOAuth?.reject(new Error(message))
      pendingOAuth = undefined
      res.writeHead(400, { "Content-Type": "text/html" })
      res.end(resultHtml(false, message))
      return
    }
    if (!pendingOAuth || state !== pendingOAuth.state) {
      const message = "State mismatch - possible CSRF attack"
      pendingOAuth?.reject(new Error(message))
      pendingOAuth = undefined
      res.writeHead(400, { "Content-Type": "text/html" })
      res.end(resultHtml(false, message))
      return
    }

    const pending = pendingOAuth
    pendingOAuth = undefined
    pending.resolve({ code, state })
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(resultHtml(true))
  })

  try {
    oauthPort = await listen(server, OAUTH_PORT)
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined
    if (code !== "EADDRINUSE") throw error
    oauthPort = await listen(server, 0)
    log.warn("Anthropic OAuth callback port unavailable; using an ephemeral loopback port", {
      preferredPort: OAUTH_PORT,
      actualPort: oauthPort,
    })
  }
  oauthServer = server
  return `http://localhost:${oauthPort}${CALLBACK_PATH}`
}

function stopOAuthServer() {
  const server = oauthServer
  oauthServer = undefined
  oauthPort = undefined
  if (server) server.close()
}

function waitForCallback(state: string): Promise<CallbackResult> {
  if (pendingOAuth) pendingOAuth.reject(new Error("Superseded by a new Anthropic OAuth login"))
  const completion = Promise.withResolvers<CallbackResult>()
  const timer = setTimeout(() => {
    if (pendingOAuth?.state !== state) return
    pendingOAuth = undefined
    completion.reject(new Error("OAuth callback timeout - authorization took too long"))
  }, CALLBACK_TIMEOUT_MS)
  pendingOAuth = {
    state,
    resolve(result) {
      clearTimeout(timer)
      completion.resolve(result)
    },
    reject(error) {
      clearTimeout(timer)
      completion.reject(error)
    },
  }
  return completion.promise
}

function firstUserText(payload: Record<string, unknown>): string {
  const messages = payload.messages
  if (!Array.isArray(messages)) return ""
  for (const message of messages) {
    if (!message || typeof message !== "object" || !("role" in message) || message.role !== "user" || !("content" in message)) {
      continue
    }
    const { content } = message
    if (typeof content === "string") return content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== "object" || !("text" in block) || typeof block.text !== "string") continue
      return block.text
    }
  }
  return ""
}

function createBillingHeader(userText: string): string {
  const chars = [4, 7, 20].map((index) => userText[index] ?? "0").join("")
  const suffix = Bun.CryptoHasher.hash("sha256", `59cf53e54c78${chars}${CLAUDE_CODE_VERSION}`, "hex").slice(0, 3)
  return `${BILLING_PREFIX} cc_version=${CLAUDE_CODE_VERSION}.${suffix}; cc_entrypoint=claude-desktop; ${CCH_PLACEHOLDER};`
}

function patchCch(body: Uint8Array): void {
  const marker = Buffer.from(`"system":[{"type":"text","text":"${BILLING_PREFIX}`)
  const placeholder = Buffer.from(CCH_PLACEHOLDER)
  const view = Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  const markerIndex = view.indexOf(marker)
  if (markerIndex === -1) return
  const searchFrom = markerIndex + marker.length
  const placeholderIndex = view.indexOf(placeholder, searchFrom)
  if (placeholderIndex === -1 || placeholderIndex - searchFrom > 150) return
  const hash = Bun.hash.xxHash64(body, CCH_SEED)
  const cch = (hash & 0xfffffn).toString(16).padStart(5, "0")
  for (let index = 0; index < 5; index++) view[placeholderIndex + 4 + index] = cch.charCodeAt(index)
}

function mergeBetas(existing: string | null): string {
  return [...new Set([...(existing?.split(",") ?? []), ...OAUTH_BETAS].map((item) => item.trim()).filter(Boolean))].join(",")
}

export function transformOAuthRequest(init: RequestInit | undefined): RequestInit {
  const headers = new Headers(init?.headers)
  headers.delete("x-api-key")
  headers.delete("X-Api-Key")
  headers.delete("authorization")
  headers.set("Accept", "application/json")
  headers.set("Content-Type", "application/json")
  headers.set("User-Agent", `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`)
  headers.set("anthropic-beta", mergeBetas(headers.get("anthropic-beta")))
  headers.set("anthropic-dangerous-direct-browser-access", "true")
  headers.set("anthropic-version", "2023-06-01")
  headers.set("x-app", "cli")
  headers.set("x-client-request-id", crypto.randomUUID())
  headers.set("X-Stainless-Arch", STAINLESS_ARCH[process.arch] ?? `other::${process.arch}`)
  headers.set("X-Stainless-Lang", "js")
  headers.set("X-Stainless-OS", STAINLESS_OS[process.platform] ?? `Other::${process.platform}`)
  headers.set("X-Stainless-Package-Version", CLAUDE_CODE_SDK_VERSION)
  headers.set("X-Stainless-Retry-Count", "0")
  headers.set("X-Stainless-Runtime", "node")
  headers.set("X-Stainless-Runtime-Version", "v26.3.0")
  headers.set("X-Stainless-Timeout", "600")
  headers.delete("content-length")

  if (typeof init?.body !== "string") return { ...init, headers }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(init.body)
  } catch {
    return { ...init, headers }
  }
  const existingSystem = Array.isArray(payload.system) ? payload.system : payload.system ? [payload.system] : []

  const hasBillingHeader = existingSystem.some((block) => {
    if (!block || typeof block !== "object" || !("text" in block) || typeof block.text !== "string") return false
    return block.text.startsWith(BILLING_PREFIX)
  })
  if (!hasBillingHeader) {
    payload.system = [
      { type: "text", text: createBillingHeader(firstUserText(payload)) },
      { type: "text", text: CLAUDE_CODE_SYSTEM_INSTRUCTION },
      ...existingSystem,
    ]
  }
  if (typeof payload.max_tokens === "number") payload.max_tokens = Math.min(payload.max_tokens, CLAUDE_CODE_MAX_OUTPUT_TOKENS)

  const body = new TextEncoder().encode(JSON.stringify(payload))
  patchCch(body)
  return { ...init, headers, body }
}

function withBetaQuery(input: RequestInfo | URL): URL {
  const original = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url)
  const url = new URL(original)
  if (url.pathname.endsWith("/v1/messages")) url.searchParams.set("beta", "true")
  return url
}

export async function AnthropicAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      async loader(getAuth) {
        const stored = await getAuth()
        if (stored.type !== "oauth") return {}

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            const current = await getAuth()
            if (current.type !== "oauth") return fetch(requestInput, init)

            let access = current.access
            let refresh = current.refresh
            if (!access || current.expires <= Date.now()) {
              refreshPromise ??= refreshAccessToken(refresh).finally(() => {
                refreshPromise = undefined
              })
              const tokens = await refreshPromise
              access = tokens.access_token
              refresh = tokens.refresh_token || refresh
              await input.client.auth.set({
                path: { id: "anthropic" },
                body: {
                  type: "oauth",
                  access,
                  refresh,
                  expires: tokenExpiry(tokens.expires_in),
                },
              })
            }

            const transformed = transformOAuthRequest(init)
            const headers = new Headers(transformed.headers)
            headers.set("Authorization", `Bearer ${access}`)
            return fetch(withBetaQuery(requestInput), { ...transformed, headers })
          },
        }
      },
      methods: [
        {
          label: "Claude Pro/Max (browser)",
          type: "oauth",
          authorize: async () => {
            const redirectUri = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const callbackPromise = waitForCallback(state)
            return {
              url: buildAuthorizeUrl(redirectUri, pkce, state),
              instructions:
                "Complete login in your browser. If the browser cannot reach this machine, choose the Claude Pro/Max (paste code) method.",
              method: "auto" as const,
              callback: async () => {
                try {
                  const callback = await callbackPromise
                  const tokens = await exchangeCodeForTokens(callback.code, callback.state, redirectUri, pkce)
                  const identity = extractIdentity(tokens)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token ?? "",
                    access: tokens.access_token,
                    expires: tokenExpiry(tokens.expires_in),
                    ...identity,
                    authorizedAt: Date.now(),
                  }
                } finally {
                  stopOAuthServer()
                }
              },
            }
          },
        },
        {
          label: "Claude Pro/Max (paste code)",
          type: "oauth",
          authorize: async () => {
            const pkce = await generatePKCE()
            const state = generateState()
            const redirectUri = `http://localhost:${OAUTH_PORT}${CALLBACK_PATH}`
            return {
              url: buildAuthorizeUrl(redirectUri, pkce, state),
              instructions: "Complete login in your browser, then paste the final redirect URL or authorization code.",
              method: "code" as const,
              callback: async (value: string) => {
                const tokens = await exchangeCodeForTokens(value, state, redirectUri, pkce)
                const identity = extractIdentity(tokens)
                return {
                  type: "success" as const,
                  refresh: tokens.refresh_token ?? "",
                  access: tokens.access_token,
                  expires: tokenExpiry(tokens.expires_in),
                  ...identity,
                  authorizedAt: Date.now(),
                }
              },
            }
          },
        },
        {
          label: "API key",
          type: "api",
        },
      ],
    },
  }
}
