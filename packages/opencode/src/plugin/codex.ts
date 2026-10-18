import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"
import { Installation } from "../installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { OAUTH_DUMMY_KEY } from "../auth"
import os from "os"
import { setTimeout as sleep } from "node:timers/promises"
import { createServer } from "http"

const log = Log.create({ service: "plugin.codex" })

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
// Loopback OAuth callback preferred port. MUST stay inside the IANA dynamic/private
// range 49152-65535 (never assigned, so no trespass possible): 1455 is `esl-lm`, 1456 is
// `dca` — чужая территория, см. docs/ports.md. On EADDRINUSE startOAuthServer falls
// back to an ephemeral port.
const OAUTH_PORT = 54546
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000

interface PkceCodes {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export interface IdTokenClaims {
  chatgpt_account_id?: string
  chatgpt_data_residency?: string
  chatgpt_compute_residency?: string
  organizations?: Array<{ id: string }>
  email?: string
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
    chatgpt_data_residency?: string
    chatgpt_compute_residency?: string
  }
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims && extractAccountIdFromClaims(claims)
    if (accountId) return accountId
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    return claims ? extractAccountIdFromClaims(claims) : undefined
  }
  return undefined
}
export function extractResidency(token: string): string | undefined {
  const claims = parseJwtClaims(token)
  const auth = claims?.["https://api.openai.com/auth"] as
    | { chatgpt_data_residency?: unknown; chatgpt_compute_residency?: unknown }
    | undefined
  const direct =
    typeof claims?.chatgpt_data_residency === "string"
      ? claims.chatgpt_data_residency
      : typeof claims?.chatgpt_compute_residency === "string"
        ? claims.chatgpt_compute_residency
        : undefined
  const namespaced: Array<unknown> = [auth?.chatgpt_data_residency, auth?.chatgpt_compute_residency]
  for (const claim of [direct, ...namespaced]) {
    if (typeof claim !== "string") continue
    const residency = claim.trim()
    if (!residency || residency === "no_constraint") continue
    return residency
  }
  return undefined
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode",
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

interface TokenResponse {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

async function formatTokenEndpointError(response: Response): Promise<string> {
  let detail = ""
  try {
    const text = await response.text()
    if (text) {
      try {
        const body = JSON.parse(text) as Record<string, unknown>
        const code = typeof body.error === "string" ? body.error : typeof body.code === "string" ? body.code : ""
        const message =
          typeof body.error_description === "string"
            ? body.error_description
            : typeof body.message === "string"
              ? body.message
              : typeof body.description === "string"
                ? body.description
                : ""
        detail = code && message && code !== message ? `${code}: ${message}` : code || message || text
      } catch {
        detail = text
      }
    }
  } catch {
    detail = ""
  }
  return detail ? `${response.status} ${detail}` : `${response.status}`
}

async function exchangeCodeForTokens(code: string, redirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await formatTokenEndpointError(response)}`)
  }
  const tokens = (await response.json()) as TokenResponse
  if (!tokens.access_token || !tokens.refresh_token || typeof tokens.expires_in !== "number") {
    throw new Error("Token response missing required fields (access_token, refresh_token, expires_in)")
  }
  return tokens
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${await formatTokenEndpointError(response)}`)
  }
  return response.json()
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>OpenCode - Codex Authorization Successful</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to OpenCode.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>OpenCode - Codex Authorization Failed</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
      .error {
        color: #ff917b;
        font-family: monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${error}</div>
    </div>
  </body>
</html>`

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined
let oauthPort: number | undefined

function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  const completion = Promise.withResolvers<number>()
  const onError = (error: Error) => {
    server.off("listening", onListening)
    completion.reject(error)
  }
  const onListening = () => {
    server.off("error", onError)
    const address = server.address()
    if (!address || typeof address === "string") {
      completion.reject(new Error("Codex OAuth callback server has no TCP address"))
      return
    }
    completion.resolve(address.port)
  }
  server.once("error", onError)
  server.once("listening", onListening)
  server.listen(port)
  return completion.promise
}

async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer && oauthPort) {
    return { port: oauthPort, redirectUri: `http://localhost:${oauthPort}/auth/callback` }
  }

  // Drop a dead holder left by a failed listen so the next attempt really binds.
  oauthServer = undefined
  oauthPort = undefined

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`)

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const errorDescription = url.searchParams.get("error_description")

      if (error) {
        const errorMsg = errorDescription || error
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      if (!code) {
        const errorMsg = "Missing authorization code"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        const errorMsg = "Invalid state - potential CSRF attack"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      const current = pendingOAuth
      pendingOAuth = undefined

      const redirectUri = `http://localhost:${oauthPort}/auth/callback`
      exchangeCodeForTokens(code, redirectUri, current.pkce)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err))

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(HTML_SUCCESS)
      return
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"))
      pendingOAuth = undefined
      res.writeHead(200)
      res.end("Login cancelled")
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  try {
    oauthPort = await listen(server, OAUTH_PORT)
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined
    if (code !== "EADDRINUSE") {
      oauthServer = undefined
      oauthPort = undefined
      throw error
    }
    oauthPort = await listen(server, 0)
    log.warn("codex oauth callback port unavailable; using an ephemeral loopback port", {
      preferredPort: OAUTH_PORT,
      actualPort: oauthPort,
    })
  }
  oauthServer = server
  log.info("codex oauth server started", { port: oauthPort })

  return { port: oauthPort, redirectUri: `http://localhost:${oauthPort}/auth/callback` }
}

function stopOAuthServer() {
  const server = oauthServer
  oauthServer = undefined
  oauthPort = undefined
  if (server) {
    server.close(() => {
      log.info("codex oauth server stopped")
    })
  }
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      },
      5 * 60 * 1000,
    ) // 5 minute timeout

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

export async function CodexAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "openai",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        // Single-flight for token refresh: concurrent requests share one refresh.
        let refreshPromise: Promise<{ access: string; accountId: string | undefined }> | undefined

        // ChatGPT sign-in has a different model catalog from the OpenAI API.
        // Keep this list aligned with the published Codex model availability.
        // Explicit pins first, then the version rule: gpt-6+ always, gpt-5.x only above 5.4.
        const allowedModels = new Set(["gpt-5.5", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini", "gpt-6-sol", "gpt-6-luna"])
        const disallowedModels = new Set(["gpt-5.5-pro"])
        for (const [modelId, model] of Object.entries(provider.models)) {
          if (model.api.id === "gpt-5.6") {
            delete provider.models[modelId]
            continue
          }
          if (allowedModels.has(model.api.id)) continue
          if (disallowedModels.has(model.api.id)) {
            delete provider.models[modelId]
            continue
          }
          const match = model.api.id.match(/^gpt-(\d+)(?:\.(\d+))?/)
          if (!match) {
            delete provider.models[modelId]
            continue
          }
          const major = Number(match[1])
          const minor = Number(match[2] ?? 0)
          if (major > 5 || (major === 5 && minor > 4)) continue
          delete provider.models[modelId]
        }

        // Zero out costs for Codex (included with ChatGPT subscription)
        for (const model of Object.values(provider.models)) {
          model.cost = {
            input: 0,
            output: 0,
            cache: { read: 0, write: 0 },
          }

          // gpt-5.5 models temporarily have restricted context window size for codex plans
          if (model.id.includes("gpt-5.5")) {
            model.limit = {
              context: 400_000,
              //@ts-expect-error incorrect type for v1 sdk but works
              input: 272_000,
              output: 128_000,
            }
          }
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            // Remove dummy API key authorization header
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.delete("authorization")
                init.headers.delete("Authorization")
              } else if (Array.isArray(init.headers)) {
                init.headers = init.headers.filter(([key]) => key.toLowerCase() !== "authorization")
              } else {
                delete init.headers["authorization"]
                delete init.headers["Authorization"]
              }
            }

            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            // Cast to include accountId field
            const authWithAccount = currentAuth as typeof currentAuth & { accountId?: string }

            // Check if token needs refresh
            if (!currentAuth.access || currentAuth.expires < Date.now()) {
              log.info("refreshing codex access token")
              if (!refreshPromise) {
                refreshPromise = refreshAccessToken(currentAuth.refresh).then(async (tokens) => {
                  const newAccountId = extractAccountId(tokens) || authWithAccount.accountId
                  await input.client.auth.set({
                    path: { id: "openai" },
                    body: {
                      type: "oauth",
                      refresh: tokens.refresh_token,
                      access: tokens.access_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      ...(newAccountId && { accountId: newAccountId }),
                    },
                  })
                  return { access: tokens.access_token, accountId: newAccountId }
                })
                refreshPromise.finally(() => {
                  if (refreshPromise !== undefined) refreshPromise = undefined
                })
              }
              const refreshed = await refreshPromise
              currentAuth.access = refreshed.access
              authWithAccount.accountId = refreshed.accountId
            }

            // Build headers
            const headers = new Headers()
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.forEach((value, key) => headers.set(key, value))
              } else if (Array.isArray(init.headers)) {
                for (const [key, value] of init.headers) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              } else {
                for (const [key, value] of Object.entries(init.headers)) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              }
            }

            // Set authorization header with access token
            headers.set("authorization", `Bearer ${currentAuth.access}`)

            // Set ChatGPT-Account-Id header for organization subscriptions
            if (authWithAccount.accountId) {
              headers.set("ChatGPT-Account-Id", authWithAccount.accountId)
            }
            // Region-pinned workspaces reject requests without declared residency (HTTP 401).
            // The token already carries it, so no configuration is needed.
            const residency = extractResidency(currentAuth.access)
            if (residency) headers.set("x-openai-internal-codex-residency", residency)

            // Identify as Codex CLI for first-party model access (e.g. Luna)
            // Without these, the backend treats requests as "3rd party" and
            // restricts access to certain models.
            headers.set("originator", "codex_cli_rs")
            headers.set("User-Agent", "Codex/0.300.0")

            // Rewrite URL to Codex endpoint
            const parsed =
              requestInput instanceof URL
                ? requestInput
                : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)
            const url =
              parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
                ? new URL(CODEX_API_ENDPOINT)
                : parsed

            return fetch(url, {
              ...init,
              headers,
            })
          },
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus (browser)",
          type: "oauth",
          authorize: async () => {
            const { redirectUri } = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const authUrl = buildAuthorizeUrl(redirectUri, pkce, state)

            const callbackPromise = waitForOAuthCallback(pkce, state)

            return {
              url: authUrl,
              instructions: "Complete authorization in your browser. This window will close automatically.",
              method: "auto" as const,
              callback: async () => {
                const tokens = await callbackPromise
                stopOAuthServer()
                const accountId = extractAccountId(tokens)
                return {
                  type: "success" as const,
                  refresh: tokens.refresh_token,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  accountId,
                }
              },
            }
          },
        },
        {
          label: "ChatGPT Pro/Plus (headless)",
          type: "oauth",
          authorize: async () => {
            const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": `opencode/${InstallationVersion}`,
              },
              body: JSON.stringify({ client_id: CLIENT_ID }),
            })

            if (!deviceResponse.ok) {
              throw new Error(`Failed to initiate device authorization: ${deviceResponse.status} ${await deviceResponse.text()}`)
            }

            const deviceData = (await deviceResponse.json()) as {
              device_auth_id?: string
              user_code?: string
              interval?: string | number
            }
            if (!deviceData.device_auth_id || !deviceData.user_code) {
              throw new Error("Device authorization response missing device_auth_id or user_code")
            }
            // Upper bound on polling so a server-side error can never spin forever.
            const DEVICE_MAX_POLLS = 120
            const rawInterval = typeof deviceData.interval === "number" ? deviceData.interval : parseInt(String(deviceData.interval ?? "5"), 10) || 5
            const interval = Math.max(rawInterval, 1) * 1000
            return {
              url: `${ISSUER}/codex/device`,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                for (let poll = 0; poll < DEVICE_MAX_POLLS; poll++) {
                  await sleep(poll === 0 ? Math.min(interval, OAUTH_POLLING_SAFETY_MARGIN_MS) : interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "User-Agent": `opencode/${InstallationVersion}`,
                    },
                    body: JSON.stringify({
                      device_auth_id: deviceData.device_auth_id,
                      user_code: deviceData.user_code,
                    }),
                  })

                  if (response.ok) {
                    const data = (await response.json()) as {
                      authorization_code: string
                      code_verifier: string
                    }

                    const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
                      method: "POST",
                      headers: { "Content-Type": "application/x-www-form-urlencoded" },
                      body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: data.authorization_code,
                        redirect_uri: `${ISSUER}/deviceauth/callback`,
                        client_id: CLIENT_ID,
                        code_verifier: data.code_verifier,
                      }).toString(),
                    })

                    if (!tokenResponse.ok) {
                      throw new Error(`Token exchange failed: ${await formatTokenEndpointError(tokenResponse)}`)
                    }

                    const tokens = (await tokenResponse.json()) as TokenResponse
                    if (!tokens.access_token || !tokens.refresh_token || typeof tokens.expires_in !== "number") {
                      throw new Error("Token response missing required fields (access_token, refresh_token, expires_in)")
                    }
                    return {
                      type: "success" as const,
                      refresh: tokens.refresh_token,
                      access: tokens.access_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      accountId: extractAccountId(tokens),
                    }
                  }

                  if (response.status !== 403 && response.status !== 404) {
                    throw new Error(`Device token polling failed: ${response.status} ${await response.text()}`)
                  }
                }
                throw new Error("Device authorization timed out — user did not complete login in time")

                }
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
    "chat.headers": async (input, output) => {
      if (input.model.providerID !== "openai") return
      output.headers.originator = "opencode"
      output.headers["User-Agent"] = `opencode/${InstallationVersion} (${os.platform()} ${os.release()}; ${os.arch()})`
      output.headers.session_id = input.sessionID
    },
    "chat.params": async (input, output) => {
      if (input.model.providerID !== "openai") return
      // Match codex cli
      output.maxOutputTokens = undefined
    },
  }
}
