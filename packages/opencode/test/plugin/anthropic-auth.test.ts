import { afterEach, describe, expect, test } from "bun:test"
import {
  ANTHROPIC_OAUTH_SCOPES,
  AnthropicAuthPlugin,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  generatePKCE,
  parseCallbackInput,
  refreshAccessToken,
  transformOAuthRequest,
} from "../../src/plugin/anthropic"
import type { PluginInput } from "@opencode-ai/plugin"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("plugin.anthropic-auth", () => {
  test("creates OMP-compatible PKCE authorization URLs", async () => {
    const pkce = await generatePKCE()
    const url = new URL(buildAuthorizeUrl("http://localhost:54545/callback", pkce, "state-123"))

    expect(pkce.verifier).toHaveLength(128)
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.origin + url.pathname).toBe("https://claude.ai/oauth/authorize")
    expect(url.searchParams.get("code")).toBe("true")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:54545/callback")
    expect(url.searchParams.get("scope")).toBe(ANTHROPIC_OAUTH_SCOPES)
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("state")).toBe("state-123")
  })

  test("accepts callback URLs, query fragments, and code#state input", () => {
    expect(parseCallbackInput("http://localhost:54545/callback?code=alpha&state=bravo")).toEqual({
      code: "alpha",
      state: "bravo",
    })
    expect(parseCallbackInput("?code=alpha&state=bravo")).toEqual({ code: "alpha", state: "bravo" })
    expect(parseCallbackInput("alpha#bravo")).toEqual({ code: "alpha", state: "bravo" })
    expect(parseCallbackInput("alpha#")).toEqual({ code: "alpha", state: undefined })
    expect(parseCallbackInput(" ")).toBeUndefined()
  })

  test("rejects a pasted callback from another OAuth flow before exchange", async () => {
    const pkce = await generatePKCE()
    await expect(
      exchangeCodeForTokens("code-from-another-flow#unexpected-state", "expected-state", "http://localhost/callback", pkce),
    ).rejects.toThrow("State mismatch - possible CSRF attack")
  })

  test("uses the observed JSON refresh protocol and preserves a non-rotated refresh token", async () => {
    let request: Request | undefined
    const fakeFetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        request = new Request(input, init)
        return Response.json({ access_token: "sk-ant-oat-access", expires_in: 28_800 })
      },
      { preconnect: originalFetch.preconnect },
    )
    globalThis.fetch = fakeFetch

    const token = await refreshAccessToken("refresh-token")
    expect(token.refresh_token).toBeUndefined()
    expect(request?.url).toBe("https://api.anthropic.com/v1/oauth/token")
    expect(request?.headers.get("content-type")).toBe("application/json")
    expect(request?.headers.get("anthropic-beta")).toBe("oauth-2025-04-20")
    expect(request?.headers.get("user-agent")).toBe("anthropic-sdk-typescript/0.112.1 userOAuthProvider")
    expect(await request?.json()).toEqual({
      grant_type: "refresh_token",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
      refresh_token: "refresh-token",
    })
  })

  test("accepts a loopback callback, validates its state, and exchanges its code", async () => {
    const pluginInput = {} as PluginInput // OAuth methods do not inspect PluginInput; the loader owns the client dependency.
    const hooks = await AnthropicAuthPlugin(pluginInput)
    const method = hooks.auth?.methods[0]
    if (!method || method.type !== "oauth") throw new Error("Anthropic browser OAuth method is unavailable")

    const authorization = await method.authorize()
    if (authorization.method !== "auto") throw new Error("Anthropic browser OAuth method must wait for a callback")
    const authorizeUrl = new URL(authorization.url)
    const callbackUrl = new URL(authorizeUrl.searchParams.get("redirect_uri")!)
    callbackUrl.searchParams.set("code", "browser-code")
    callbackUrl.searchParams.set("state", authorizeUrl.searchParams.get("state")!)

    const fakeFetch = Object.assign(
      async () => Response.json({ access_token: "sk-ant-oat-access", refresh_token: "refresh-token", expires_in: 28_800 }),
      { preconnect: originalFetch.preconnect },
    )
    globalThis.fetch = fakeFetch
    const page = await originalFetch(callbackUrl)
    expect(page.status).toBe(200)
    await expect(authorization.callback()).resolves.toMatchObject({
      type: "success",
      access: "sk-ant-oat-access",
      refresh: "refresh-token",
    })
  })

  test("turns an AI SDK request into the OAuth Claude-Code wire shape", async () => {
    const transformed = transformOAuthRequest({
      headers: {
        "x-api-key": "dummy",
        authorization: "Bearer stale",
        "anthropic-beta": "interleaved-thinking-2025-05-14",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 100_000,
        messages: [{ role: "user", content: [{ type: "text", text: "reply with pong" }] }],
        system: [{ type: "text", text: "user instruction" }],
      }),
    })

    const headers = new Headers(transformed.headers)
    expect(headers.has("x-api-key")).toBe(false)
    expect(headers.has("authorization")).toBe(false)
    expect(headers.get("user-agent")).toBe("claude-cli/2.1.257 (external, cli)")
    expect(headers.get("anthropic-version")).toBe("2023-06-01")
    expect(headers.get("x-app")).toBe("cli")
    expect(headers.get("anthropic-beta")).toContain("oauth-2025-04-20")
    expect(headers.get("anthropic-beta")).not.toContain("advanced-tool-use-2025-11-20")

    if (!(transformed.body instanceof Uint8Array)) throw new Error("OAuth transform did not encode the request body")
    const body = JSON.parse(new TextDecoder().decode(transformed.body))
    expect(body.max_tokens).toBe(64_000)
    expect(body.system).toHaveLength(3)
    expect(body.system[0].text).toStartWith("x-anthropic-billing-header:")
    expect(body.system[0].text).not.toContain("cch=00000")
    expect(body.system[1]).toEqual({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
    })
    expect(body.system[2]).toEqual({ type: "text", text: "user instruction" })
  })
})
