import { Effect, Schema } from "effect"
import { fileURLToPath } from "node:url"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const PLAYWRIGHT_TIMEOUT = 60 * 1000 // 60 seconds for Playwright (JS challenges take time)

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const)))
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
    }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

function buildHeaders(format: "text" | "markdown" | "html") {
  let acceptHeader = "*/*"
  switch (format) {
    case "markdown":
      acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
      break
    case "text":
      acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
      break
    case "html":
      acceptHeader =
        "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
      break
  }
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    Accept: acceptHeader,
    "Accept-Language": "en-US,en;q=0.9",
  }
}

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: {
              url: params.url,
              format: params.format,
              timeout: params.timeout,
            },
          })

          const format = params.format ?? "markdown"
          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)
          const headers = buildHeaders(format)
          const request = HttpClientRequest.get(params.url).pipe(HttpClientRequest.setHeaders(headers))

          // Strategy 1: Try HTTP first
          const httpExit = yield* Effect.exit(
            Effect.gen(function* () {
              const response = yield* http.execute(request).pipe(
                Effect.timeoutOrElse({
                  duration: timeout,
                  orElse: () => Effect.fail(new Error("Request timed out")),
                }),
              )
              if (response.status < 200 || response.status >= 300) {
                return yield* Effect.fail(new Error(`HTTP ${response.status}`))
              }
              return yield* processHttpResponse(response as any, { url: params.url, format })
            }),
          )

          if (httpExit._tag === "Success") return httpExit.value

          // Strategy 2: HTTP failed — fall back to Playwright
          const playwrightResult = yield* Effect.tryPromise({
            try: () => fetchWithPlaywright(params.url, format, PLAYWRIGHT_TIMEOUT),
            catch: (err) =>
              new Error(
                `Playwright fallback failed: ${err instanceof Error ? err.message : String(err)}`,
              ),
          })
          if (playwrightResult) return playwrightResult

          // Strategy 3: Both failed
          const httpErr = httpExit._tag === "Failure" ? httpExit.cause : null
          const errMsg = (httpErr as any)?.reason?.message ?? (httpErr as any)?._tag ?? "unknown error"
          return {
            output: `Failed to fetch the URL.\nHTTP error: ${errMsg}\nPlaywright fallback also failed.`,
            title: `${params.url} (fetch failed)`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function processHttpResponse(
  response: { status: number; headers: Record<string, string>; arrayBuffer: Effect.Effect<ArrayBuffer> },
  params: { url: string; format: "text" | "markdown" | "html" },
) {
  return Effect.gen(function* () {
    const contentLength = response.headers["content-length"]
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    const arrayBuffer = yield* response.arrayBuffer
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    const contentType = response.headers["content-type"] || ""
    const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
    const title = `${params.url} (${contentType})`

    if (isImageAttachment(mime)) {
      const base64Content = Buffer.from(arrayBuffer).toString("base64")
      return {
        title,
        output: "Image fetched successfully",
        metadata: {},
        attachments: [
          {
            type: "file" as const,
            mime,
            url: `data:${mime};base64,${base64Content}`,
          },
        ],
      }
    }

    const content = new TextDecoder().decode(arrayBuffer)

    switch (params.format) {
      case "markdown":
        if (contentType.includes("text/html")) {
          const markdown = convertHTMLToMarkdown(content)
          return { output: markdown, title, metadata: {} }
        }
        return { output: content, title, metadata: {} }

      case "text":
        if (contentType.includes("text/html")) {
          const text = yield* Effect.promise(() => extractTextFromHTML(content))
          return { output: text, title, metadata: {} }
        }
        return { output: content, title, metadata: {} }

      case "html":
        return { output: content, title, metadata: {} }

      default:
        return { output: content, title, metadata: {} }
    }
  })
}

async function fetchWithPlaywright(
  url: string,
  format: "text" | "markdown" | "html",
  timeoutMs: number,
): Promise<{ output: string; title: string; metadata: Record<string, unknown> } | null> {
  // Bun cannot connect to Playwright's CDP on Windows, so we spawn a Node.js
  // child process that does the browser fetch.
  const helperPath = fileURLToPath(new URL("./playwright-fetch-helper.cjs", import.meta.url))
  // Resolve from the package root (two dirs up from src/tool/)
  const pkgDir = fileURLToPath(new URL("../..", import.meta.url))

  // Resolve node binary (Bun.spawn may not inherit full PATH on Windows)
  const nodePath = Bun.which("node") || "node"

  const proc = Bun.spawn([nodePath, helperPath, url, String(timeoutMs)], {
    cwd: pkgDir,
    stdout: "pipe",
    stderr: "pipe",
  })

  // Apply a timeout around the process wait
  const procTimeout = timeoutMs + 30_000 // 30s extra for browser launch overhead
  const timedExit = Promise.race([
    proc.exited.then((code) => code),
    new Promise<number>((resolve) => setTimeout(() => resolve(-1), procTimeout)),
  ])

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await timedExit

  if (exitCode !== 0 || !stdout.trim()) {
    if (stderr.trim()) {
      // Log stderr but don't expose to user
      console.error("[webfetch:playwright]", stderr.trim().substring(0, 500))
    }
    return null
  }

  let result: { html: string; pageTitle: string; status?: number }
  try {
    result = JSON.parse(stdout.trim())
  } catch {
    return null
  }

  if (!result || !result.html) return null

  // Don't accept Cloudflare challenge pages
  if (
    result.html.includes("Just a moment") &&
    result.html.includes("cf-browser-verification")
  ) {
    return null
  }

  switch (format) {
    case "markdown":
      return {
        output: convertHTMLToMarkdown(result.html),
        title: `${url} (via Playwright — ${result.pageTitle})`,
        metadata: {},
      }
    case "text":
      return {
        output: await extractTextFromHTML(result.html),
        title: `${url} (via Playwright — ${result.pageTitle})`,
        metadata: {},
      }
    case "html":
      return {
        output: result.html,
        title: `${url} (via Playwright — ${result.pageTitle})`,
        metadata: {},
      }
    default:
      return {
        output: result.html,
        title: `${url} (via Playwright — ${result.pageTitle})`,
        metadata: {},
      }
  }
}

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
