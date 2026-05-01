import { Effect, Schema } from "effect"
import { Config } from "../config/config"
import * as Tool from "./tool"

import DESCRIPTION from "./universalsearch.txt"

const Source = Schema.Literals(["agent", "web", "code", "hybrid"])

export const Parameters = Schema.Struct({
  query: Schema.optional(
    Schema.String.annotate({ description: "Search query or research question" }),
  ),
  source: Schema.optional(Source).annotate({
    description:
      "Search mode: 'agent' for autonomous research (default), 'web' for web search, 'code' for code search, 'hybrid' for combined",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Number of results to return (default: 5 for web, 10 for code)",
  }),
  max_turns: Schema.optional(Schema.Number).annotate({
    description: "Maximum agent iterations for agent mode (default: 5)",
  }),
  job_id: Schema.optional(Schema.String).annotate({
    description: "Job ID to poll for results (used with agent mode)",
  }),
})

const DEFAULT_TIMEOUT = 60000
const POLL_INTERVAL_MS = 5000
const MAX_POLL_DURATION_MS = 300000

type Metadata = {
  resultsCount?: number
  jobId?: string
  status?: string
  mode?: string
}

export const UniversalSearchTool = Tool.define(
  "universalsearch",
  Effect.gen(function* () {
    const config = yield* Config.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "universalsearch",
            patterns: [params.query || params.job_id || ""],
            always: ["*"],
            metadata: {
              query: params.query,
              source: params.source,
              limit: params.limit,
              max_turns: params.max_turns,
              job_id: params.job_id,
            },
          })

          const cfg = yield* config.get()
          const usConfig = cfg.universal_search || {}
          const url = usConfig.url || "http://127.0.0.1:3005"
          const enabled = usConfig.enabled !== false

          if (!enabled) {
            throw new Error("Universal search service is disabled in config")
          }

          if (params.job_id) {
            return yield* pollAgentJob(url, params.job_id)
          }

          const source = params.source || "agent"

          switch (source) {
            case "agent":
              return yield* executeAgentSearch(url, params)
            case "web":
              return yield* executeWebSearch(url, params)
            case "code":
              return yield* executeCodeSearch(url, params)
            case "hybrid":
              return yield* executeHybridSearch(url, params)
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function checkHealth(url: string) {
  return Effect.tryPromise({
    try: async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      try {
        const response = await fetch(`${url}/health`, { signal: controller.signal })
        return response.ok
      } finally {
        clearTimeout(timer)
      }
    },
    catch: () => false,
  })
}

function executeAgentSearch(
  url: string,
  params: { query?: string; max_turns?: number },
) {
  return Effect.gen(function* () {
    if (!params.query) {
      throw new Error("query is required for agent search")
    }

    const healthy = yield* checkHealth(url)
    if (!healthy) {
      throw new Error("Universal search service is not responding on port 3005. Ensure the service is running.")
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

    try {
      const response = yield* Effect.tryPromise(() =>
        fetch(`${url}/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: params.query,
            max_turns: params.max_turns || 5,
            model: null,
            system_prompt: null,
          }),
          signal: controller.signal,
        }),
      )

      if (!response.ok) {
        const errorText = yield* Effect.tryPromise(() => response.text())
        throw new Error(`Universal search agent error (${response.status}): ${errorText}`)
      }

      const result = (yield* Effect.tryPromise(() => response.json())) as any

      if (!result?.success || !result?.id) {
        throw new Error("Universal search agent failed to start job")
      }

      return {
        output: `Agent research job started: **${result.id}**\n\nPoll for results with: \`universalsearch({ job_id: "${result.id}" })\`\n\nThe tool will automatically poll every 5 seconds and return results when the research is complete (up to 5 minutes).`,
        title: `Agent research: ${params.query}`,
        metadata: { jobId: result.id, status: "processing", mode: "agent" } as Metadata,
      }
    } finally {
      clearTimeout(timer)
    }
  })
}

function pollAgentJob(url: string, jobId: string) {
  return Effect.gen(function* () {
    const startTime = Date.now()

    while (true) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

      try {
        const response = yield* Effect.tryPromise(() =>
          fetch(`${url}/agent/${jobId}`, { signal: controller.signal }),
        )

        if (!response.ok) {
          const errorText = yield* Effect.tryPromise(() => response.text())
          throw new Error(`Universal search job status error (${response.status}): ${errorText}`)
        }

        const result = (yield* Effect.tryPromise(() => response.json())) as any

        if (!result?.success) {
          throw new Error("Failed to get job status")
        }

        if (result.status === "completed" && result.data) {
          let output = `# Research Results for "${result.data.query}"\n\n`
          output += `**Answer:** ${result.data.answer}\n\n`
          output += `**Turns:** ${result.data.turns}\n\n`

          if (result.data.tool_calls?.length > 0) {
            output += `## Research Steps\n\n`
            for (const call of result.data.tool_calls) {
              output += `### Turn ${call.turn}: ${call.tool}\n`
              output += `**Input:** ${JSON.stringify(call.input)}\n\n`
              if (call.output?.markdown) {
                output += `${call.output.markdown}\n\n`
              }
            }
          }

          return {
            output,
            title: `Agent research complete: ${result.data.query}`,
            metadata: { jobId, status: "completed", mode: "agent", resultsCount: result.data.tool_calls?.length } as Metadata,
          }
        }

        if (result.status === "processing") {
          if (Date.now() - startTime >= MAX_POLL_DURATION_MS) {
            return {
              output: `Job **${jobId}** did not complete within the maximum wait time of ${MAX_POLL_DURATION_MS / 60000} minutes. The research may still be running on the server.`,
              title: "Agent research: timeout",
              metadata: { jobId, status: "timeout", mode: "agent" } as Metadata,
            }
          }

          yield* Effect.sleep(POLL_INTERVAL_MS)
          continue
        }

        if (result.status === "cancelled") {
          return {
            output: `Job **${jobId}** was cancelled.`,
            title: "Agent research: cancelled",
            metadata: { jobId, status: "cancelled", mode: "agent" } as Metadata,
          }
        }

        throw new Error(`Unknown job status: ${result.status}`)
      } finally {
        clearTimeout(timer)
      }
    }
  })
}

function executeWebSearch(url: string, params: { query?: string; limit?: number }) {
  return Effect.gen(function* () {
    if (!params.query) {
      throw new Error("query is required for web search")
    }

    const healthy = yield* checkHealth(url)
    if (!healthy) {
      throw new Error("Universal search service is not responding on port 3005. Ensure the service is running.")
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

    try {
      const response = yield* Effect.tryPromise(() =>
        fetch(`${url}/web/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: params.query,
            count: params.limit || 5,
            scrape_formats: "markdown",
            only_main_content: true,
          }),
          signal: controller.signal,
        }),
      )

      if (!response.ok) {
        const errorText = yield* Effect.tryPromise(() => response.text())
        throw new Error(`Universal search web error (${response.status}): ${errorText}`)
      }

      const results = (yield* Effect.tryPromise(() => response.json())) as any

      if (!results?.results?.length) {
        return {
          output: "No search results found. Please try a different query.",
          title: `Web search: ${params.query}`,
          metadata: { resultsCount: 0, mode: "web" } as Metadata,
        }
      }

      let output = `# Web Search Results for "${params.query}"\n\n`

      for (let i = 0; i < results.results.length; i++) {
        const result = results.results[i]
        output += `## ${i + 1}. ${result.title || "Untitled"}\n`
        output += `**URL:** ${result.url}\n\n`
        if (result.description) output += `${result.description}\n\n`
        if (result.markdown) output += `${result.markdown}\n\n`
      }

      return {
        output,
        title: `Web search: ${params.query}`,
        metadata: { resultsCount: results.results.length, mode: "web" } as Metadata,
      }
    } finally {
      clearTimeout(timer)
    }
  })
}

function executeCodeSearch(url: string, params: { query?: string; limit?: number }) {
  return Effect.gen(function* () {
    if (!params.query) {
      throw new Error("query is required for code search")
    }

    const healthy = yield* checkHealth(url)
    if (!healthy) {
      throw new Error("Universal search service is not responding on port 3005. Ensure the service is running.")
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

    try {
      const response = yield* Effect.tryPromise(() =>
        fetch(`${url}/web/sourcegraph`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: params.query, count: params.limit || 10 }),
          signal: controller.signal,
        }),
      )

      if (!response.ok) {
        const errorText = yield* Effect.tryPromise(() => response.text())
        throw new Error(`Universal search code error (${response.status}): ${errorText}`)
      }

      const results = (yield* Effect.tryPromise(() => response.json())) as any

      if (!results?.results?.length) {
        return {
          output: "No code search results found. Please try a different query.",
          title: `Code search: ${params.query}`,
          metadata: { resultsCount: 0, mode: "code" } as Metadata,
        }
      }

      let output = `# Code Search Results for "${params.query}"\n\n`

      for (let i = 0; i < results.results.length; i++) {
        const result = results.results[i]
        output += `## ${i + 1}. ${result.file || result.path}\n`
        if (result.repository) output += `**Repository:** ${result.repository}\n\n`
        if (result.line) output += `Line ${result.line}: `
        if (result.preview) output += `\`${result.preview.trim()}\`\n\n`
        if (result.content) output += `\`\`\`\n${result.content.trim().substring(0, 500)}\n\`\`\`\n\n`
      }

      return {
        output,
        title: `Code search: ${params.query}`,
        metadata: { resultsCount: results.results.length, mode: "code" } as Metadata,
      }
    } finally {
      clearTimeout(timer)
    }
  })
}

function executeHybridSearch(url: string, params: { query?: string; limit?: number }) {
  return Effect.gen(function* () {
    if (!params.query) {
      throw new Error("query is required for hybrid search")
    }

    const healthy = yield* checkHealth(url)
    if (!healthy) {
      throw new Error("Universal search service is not responding on port 3005. Ensure the service is running.")
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

    try {
      const response = yield* Effect.tryPromise(() =>
        fetch(`${url}/hybrid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: params.query, count: params.limit || 10 }),
          signal: controller.signal,
        }),
      )

      if (!response.ok) {
        const errorText = yield* Effect.tryPromise(() => response.text())
        throw new Error(`Universal search hybrid error (${response.status}): ${errorText}`)
      }

      const results = (yield* Effect.tryPromise(() => response.json())) as any

      if (!results?.results?.length) {
        return {
          output: "No hybrid search results found. Please try a different query.",
          title: `Hybrid search: ${params.query}`,
          metadata: { resultsCount: 0, mode: "hybrid" } as Metadata,
        }
      }

      let output = `# Hybrid Search Results for "${params.query}"\n\n`
      output += "_Results from local code search (first) and Sourcegraph (second)_\n\n"

      for (let i = 0; i < results.results.length; i++) {
        const result = results.results[i]
        const sourceLabel = result.source === "local" ? "[Local]" : "[Sourcegraph]"
        output += `## ${i + 1}. ${sourceLabel} ${result.file || result.url}\n`
        if (result.repository) output += `**Repository:** ${result.repository}\n\n`
        if (result.line) output += `Line ${result.line}: `
        if (result.preview) output += `\`${result.preview.trim()}\`\n\n`
        if (result.url) output += `**URL:** ${result.url}\n\n`
      }

      return {
        output,
        title: `Hybrid search: ${params.query}`,
        metadata: { resultsCount: results.results.length, mode: "hybrid" } as Metadata,
      }
    } finally {
      clearTimeout(timer)
    }
  })
}
