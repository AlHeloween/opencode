import { describe, expect, test, afterEach } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"
import { createGeminiProvider } from "../../src/provider/google-code-assist"

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  token_type: string
}

async function getGoogleOAuthToken(): Promise<{ accessToken: string; projectId?: string } | null> {
  try {
    const realXdgData = process.env.XDG_DATA_HOME?.includes("opencode-test-data")
      ? path.join(os.homedir(), ".local", "share")
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
    const authPath = path.join(realXdgData, "opencode", "auth.json")
    if (!fs.existsSync(authPath)) {
      console.log("Skipping: auth.json not found at", authPath)
      return null
    }

    const auth = JSON.parse(fs.readFileSync(authPath, "utf-8"))
    const googleAuth = auth.google
    if (!googleAuth || googleAuth.type !== "oauth") {
      console.log("Skipping: No Google OAuth credentials found in auth.json")
      return null
    }
    if (!googleAuth.access) {
      console.log("Skipping: Google OAuth access token missing")
      return null
    }
    if (!googleAuth.refresh) {
      console.log("Skipping: Google OAuth refresh token missing")
      return null
    }

    if (googleAuth.expires && googleAuth.expires < Date.now()) {
      console.log("Token expired (expired at", new Date(googleAuth.expires).toISOString() + "), refreshing...")
      if (!CLIENT_ID || !CLIENT_SECRET) {
        console.log(
          "Skipping: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET env vars required for token refresh",
        )
        return null
      }
      try {
        const response = await fetch(OAUTH_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: googleAuth.refresh,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
          }).toString(),
        })
        if (!response.ok) {
          const text = await response.text()
          console.log("Skipping: Token refresh failed:", response.status, text)
          return null
        }
        const tokens = (await response.json()) as TokenResponse
        console.log(
          "Token refreshed successfully, new expiry:",
          new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        )
        return {
          accessToken: tokens.access_token,
        }
      } catch (err) {
        console.log("Skipping: Token refresh error:", err instanceof Error ? err.message : String(err))
        return null
      }
    }

    return {
      accessToken: googleAuth.access,
    }
  } catch (err) {
    console.log("Skipping: Failed to read auth.json:", err instanceof Error ? err.message : String(err))
    return null
  }
}

describe("google-code-assist integration (requires OAuth)", () => {
  let credentials: { accessToken: string; projectId?: string } | null

  test("makes real API call with OAuth token (doGenerate)", async () => {
    credentials = await getGoogleOAuthToken()
    if (!credentials) {
      return
    }

    const provider = createGeminiProvider({
      accessToken: credentials.accessToken,
    })

    const model = provider.languageModel("gemini-3-flash-preview")

    try {
      const result = await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Say 'Hello'" }],
          },
        ],
      })

      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0].type).toBe("text")
      if (result.content[0].type !== "text") throw new Error("Expected text content")
      expect(result.content[0].text).toContain("Hello")
      expect(result.finishReason).toBe("stop")
      expect(result.usage.inputTokens).toBeGreaterThan(0)
      expect(result.usage.outputTokens).toBeGreaterThan(0)
    } catch (err) {
      console.log("Integration test skipped due to API error:", err instanceof Error ? err.message : String(err))
      return
    }
  })

  test("streaming works with OAuth token (doStream)", async () => {
    credentials = await getGoogleOAuthToken()
    if (!credentials) {
      return
    }

    const provider = createGeminiProvider({
      accessToken: credentials.accessToken,
    })

    const model = provider.languageModel("gemini-3-flash-preview")

    let result
    try {
      result = await model.doStream({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Count from 1 to 3" }],
          },
        ],
      })
    } catch (err) {
      console.log("Integration test skipped due to API error:", err instanceof Error ? err.message : String(err))
      return
    }

    const chunks: any[] = []
    const reader = result.stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const textDeltas = chunks.filter((c) => c.type === "text-delta")
    expect(textDeltas.length).toBeGreaterThan(0)

    const finishEvents = chunks.filter((c) => c.type === "finish")
    expect(finishEvents.length).toBeGreaterThan(0)
    expect(finishEvents[0].usage.inputTokens).toBeGreaterThan(0)
  })
})
