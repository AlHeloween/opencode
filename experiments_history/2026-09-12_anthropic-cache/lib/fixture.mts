/**
 * Shared fixture for the anthropic cache probes.
 *
 * The point of this file is that the probes must not measure a toy prompt.
 * The system slots are built from the REAL artifacts this repo ships
 * (reasoning_prompt.txt, AGENTS.md), so the prefix sizes the probes print are
 * the sizes opencode actually sends.
 */
import path from "path"

export const REPO = path.resolve(import.meta.dir, "../../..")

/** chars/4 — an ESTIMATE for relative comparison only, never a token count. */
export const estTokens = (s: string) => Math.ceil(s.length / 4)

export async function readRepo(rel: string) {
  const file = Bun.file(path.join(REPO, rel))
  if (!(await file.exists())) throw new Error(`fixture source missing: ${rel}`)
  return file.text()
}

export type Slot = { name: string; text: string }

/**
 * Mirrors assembleSystemMessages() in src/session/system-compose.ts:
 *   [universalEnv, stablePrefix(reasoning+kernel), ...pathSystem slots, mutableTail]
 * Slot names match that function so the probe output maps 1:1 onto the code.
 */
export async function systemSlots(): Promise<Slot[]> {
  const kernel = await readRepo("packages/opencode/src/session/prompt/reasoning_prompt.txt")
  const instructions = await readRepo("AGENTS.md")
  const skills = await readRepo("docs/agi-workflow.md").catch(() => "")
  return [
    { name: "universalEnv", text: "<env>\nplatform: win32\nshell: pwsh\ncwd: D:/zPython/opencode\n</env>" },
    { name: "stablePrefix(reasoning+kernel)", text: kernel },
    { name: "path:rules", text: "# Rules\n" + "- rule line kept stable across turns\n".repeat(120) },
    { name: "path:skills", text: skills.slice(0, 12_000) },
    { name: "path:env", text: "# Environment\n" + "- env fact\n".repeat(60) },
    { name: "path:instructions(AGENTS.md)", text: instructions },
    { name: "mutableTail(banner+agentPrompt)", text: "# Session\nagent: build\n" + "identity capsule line\n".repeat(40) },
  ]
}

/** One agentic turn = user -> assistant(tool-call) -> tool(result). */
export function agenticTail(turns: number): any[] {
  const msgs: any[] = []
  for (let i = 0; i < turns; i++) {
    msgs.push({ role: "user", content: [{ type: "text", text: `turn ${i}: inspect the provider transform` }] })
    msgs.push({
      role: "assistant",
      content: [
        { type: "text", text: `Looking at turn ${i}.` },
        { type: "tool-call", toolCallId: `call_${i}`, toolName: "read", input: { filePath: "src/provider/transform.ts" } },
      ],
    })
    msgs.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `call_${i}`,
          toolName: "read",
          output: { type: "text", value: "file body ".repeat(400) },
        },
      ],
    })
  }
  msgs.push({ role: "user", content: [{ type: "text", text: "now summarise" }] })
  return msgs
}

export function anthropicModel(apiId = "claude-opus-5"): any {
  return {
    id: apiId,
    providerID: "anthropic",
    api: { id: apiId, url: "https://api.anthropic.com/v1", npm: "@ai-sdk/anthropic" },
    name: apiId,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 5, output: 25, cache: { read: 0.5, write: 6.25 } },
    limit: { context: 1_000_000, output: 128_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-07-24",
    variants: {},
  }
}

export function table(rows: Record<string, string | number>[]) {
  if (rows.length === 0) return ""
  const cols = Object.keys(rows[0]!)
  const width = Object.fromEntries(
    cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length))]),
  )
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(width[cols[i]!]!)).join("  ")
  return [line(cols), line(cols.map((c) => "-".repeat(width[c]!))), ...rows.map((r) => line(cols.map((c) => String(r[c] ?? ""))))].join("\n")
}
