/** Shared guard + client for the live probes. */
import { createAnthropic } from "../../../packages/opencode/node_modules/@ai-sdk/anthropic/dist/index.js"

export function requireKey(probe: string) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.log(
      `${probe}: SKIPPED - ANTHROPIC_API_KEY is not set.\n` +
        `This is Unknown, not a failed oracle: the claim stays unproven until the probe runs against the real wire.\n` +
        `Run:  ANTHROPIC_API_KEY=sk-ant-... bun run experiments/2026-09-12_anthropic-cache/${probe}`,
    )
    process.exit(0)
  }
  return key
}

/** Provider built the way provider.ts builds it, incl. the static beta header. */
export function client(extraBeta?: string) {
  const betas = ["interleaved-thinking-2025-05-14", "fine-grained-tool-streaming-2025-05-14"]
  if (extraBeta) betas.push(extraBeta)
  return createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    headers: { "anthropic-beta": betas.join(",") },
  })
}

export function usageOf(result: any) {
  const meta = result?.providerMetadata?.anthropic ?? {}
  return {
    input: result?.usage?.inputTokens ?? 0,
    cacheWrite: meta.cacheCreationInputTokens ?? result?.usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
    cacheRead: result?.usage?.inputTokenDetails?.cacheReadTokens ?? meta.cacheReadInputTokens ?? 0,
    output: result?.usage?.outputTokens ?? 0,
  }
}
