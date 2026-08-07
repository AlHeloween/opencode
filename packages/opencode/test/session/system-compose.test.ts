import { createHash } from "crypto"
import { describe, expect, test } from "bun:test"
import {
  assemblePathSystem,
  assembleSystemMessages,
  collapseSystemMessages,
  validateSystemOrder,
} from "../../src/session/system-compose"
import PROMPT_REASONING from "../../src/session/prompt/reasoning_prompt.txt"
import { ProviderTransform } from "../../src/provider/transform"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider/provider"

/**
 * System prefix digest — update procedure for intentional prompt revisions:
 *
 * 1. Change `prompts_kernel/` (canonical SPECS source) and re-assemble into
 *    `packages/opencode/src/session/prompt/reasoning_prompt.mdc`.
 * 2. Sync runtime sibling: copy mdc → reasoning_prompt.txt (runtime loads .txt).
 * 3. Run: `cd packages/opencode && bun test test/session/system-compose.test.ts`
 * 4. If only the digest assertion fails, update EXPECTED_REASONING_DIGEST below
 *    after reviewing the txt/mdc diff.
 * 5. Commit reasoning_prompt.mdc + reasoning_prompt.txt + digest update together.
 *
 * Runtime loads reasoning_prompt.txt via ProviderTransform (kernel slot is empty).
 */
const EXPECTED_REASONING_DIGEST = createHash("sha256").update(PROMPT_REASONING, "utf8").digest("hex")

function mockModel(id: string): Provider.Model {
  return {
    id: ModelID.zod.parse(id),
    providerID: ProviderID.zod.parse("test"),
    api: { id: id.split("/").pop()!, url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
    name: id,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 8_192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  }
}

describe("system-compose path assembly", () => {
  test("stable-first: rules → skills → env → instructions", () => {
    expect(
      assemblePathSystem({
        skills: "SKILLS",
        env: ["ENV"],
        rules: ["RULES"],
        instructions: ["AGENTS.md"],
      }),
    ).toEqual(["RULES", "SKILLS", "ENV", "AGENTS.md"])
  })
})

describe("system-compose provider assembly", () => {
  test("orders stable prefix then mutable session tail", () => {
    const parts = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      reasoningPrefix: "REASONING",
      kernel: "KERNEL",
      agentPrompt: "AGENT_PROMPT",
      pathSystem: ["RULES", "SKILLS", "ENV", "INSTRUCTIONS"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      userSystem: "USER",
      checkpoint: false,
    })
    // Order: [0] UE, [1] reasoning+kernel, [2] tools, [3] path (no agent role), [4] mutable
    // Agent prompt + active tools line only in mutable tail (not stable path).
    expect(parts).toEqual([
      "UE",
      "REASONING\nKERNEL",
      "TOOLS",
      "RULES\nSKILLS\nENV\nINSTRUCTIONS",
      "Active tools: a\nAGENT_PROMPT\n[session: ses_1]\nUSER",
    ])
  })

  test("checkpoint path strips stored identity at pathSystem[0]", () => {
    const parts = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      reasoningPrefix: "REASONING",
      kernel: "KERNEL",
      agentPrompt: "AGENT_PROMPT",
      pathSystem: ["OLD_IDENTITY", "RULES", "SKILLS", "ENV"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      checkpoint: true,
    })
    // Path body has no agent role; agentPrompt is mutable tail only.
    expect(parts[3]).toBe("RULES\nSKILLS\nENV")
    expect(parts[4]).toContain("AGENT_PROMPT")
    expect(parts.join("\n")).not.toContain("OLD_IDENTITY")
    expect(parts.some((p) => p === "USER")).toBe(false)
  })

  test("collapse keeps stable body separate from session/mutable tail", () => {
    const raw = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      reasoningPrefix: "REASONING",
      kernel: "KERNEL",
      agentPrompt: "AGENT_PROMPT",
      pathSystem: ["RULES", "SKILLS", "ENV", "INSTRUCTIONS"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      checkpoint: false,
    })
    const collapsed = collapseSystemMessages(raw, "UE")
    // Critical: session banner must NOT be joined into identity/path — that
    // forced a full path/skills recompute on every new session.
    // Agent role is mutable tail only — stable path has no AGENT_PROMPT.
    expect(collapsed).toEqual([
      "UE",
      "REASONING\nKERNEL",
      "TOOLS",
      "RULES\nSKILLS\nENV\nINSTRUCTIONS",
      "Active tools: a\nAGENT_PROMPT\n[session: ses_1]",
    ])
    expect(collapsed[3]).not.toContain("[session:")
    expect(collapsed[3]).not.toContain("AGENT_PROMPT")
    expect(collapsed[4]).toContain("[session: ses_1]")
  })

  test("two sessions share identical stable prefix bytes", () => {
    const base = {
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      reasoningPrefix: "REASONING",
      kernel: "KERNEL",
      agentPrompt: "AGENT_PROMPT",
      pathSystem: ["RULES", "SKILLS", "ENV"],
      activeToolsLine: "Active tools: a,b",
      checkpoint: false as const,
    }
    const a = collapseSystemMessages(
      assembleSystemMessages({ ...base, banner: "[session: ses_AAA]" }),
      "UE",
    )
    const b = collapseSystemMessages(
      assembleSystemMessages({ ...base, banner: "[session: ses_BBB]" }),
      "UE",
    )
    // Prefix slots 0..2 must be byte-identical across sessions
    expect(a[0]).toBe(b[0])
    expect(a[1]).toBe(b[1])
    expect(a[2]).toBe(b[2])
    expect(a[3]).toContain("SKILLS")
    expect(a[2]).not.toContain("ses_")
    // Only the mutable tail differs
    expect(a[3]).toEqual(b[3])
    expect(a[4]).not.toBe(b[4])
    expect(a[4]).toContain("ses_AAA")
    expect(b[4]).toContain("ses_BBB")
  })

  test("collapse is a no-op when header was mutated by a plugin", () => {
    const raw = ["MUTATED", "TOOLS", "TAIL"]
    expect(collapseSystemMessages(raw, "UE")).toEqual(raw)
  })
})

describe("system prefix digest (reasoning_prompt.txt)", () => {
  test("reasoning_prompt.txt artifact has stable documented digest", () => {
    const digest = createHash("sha256").update(PROMPT_REASONING, "utf8").digest("hex")
    expect(digest).toBe(EXPECTED_REASONING_DIGEST)
    expect(PROMPT_REASONING).toContain("PROMPT_ABI")
    expect(PROMPT_REASONING).toContain("GATED_WORKFLOW")
    expect(PROMPT_REASONING).not.toContain("_ALL_SPECS")
  })

  test("systemPromptPrefix is unified reasoning_prompt.txt, byte-stable", () => {
    const model = mockModel("anthropic/claude-sonnet-4")
    const a = ProviderTransform.systemPromptPrefix(model)
    const b = ProviderTransform.systemPromptPrefix(model)
    expect(a).toBe(b)
    expect(a).toContain("GATED_WORKFLOW")
    expect(a).toContain("PROMPT_ABI")
    expect(a.indexOf("GATED_WORKFLOW")).toBeLessThan(a.indexOf("PROMPT_ABI"))
    expect(a).toContain(PROMPT_REASONING.slice(0, 40))
  })

  test("systemPromptParts loads full txt as reasoning; kernel slot empty", () => {
    const parts = ProviderTransform.systemPromptParts(mockModel("anthropic/claude-sonnet-4"))
    // Unified identity: gates + claim_ledger + PROMPT_ABI dictionary live in one file.
    expect(parts.reasoning.length).toBeGreaterThan(10_000)
    expect(parts.reasoning.length).toBeLessThan(80_000)
    expect(parts.reasoning).toContain("GATED_WORKFLOW")
    expect(parts.reasoning).toContain("claim_ledger")
    expect(parts.reasoning).toMatch(/REUSE_BEFORE|REUSE\.BEFORE/)
    expect(parts.reasoning).toContain("PROMPT_ABI")
    expect(parts.reasoning).toContain("TERMS")
    expect(parts.kernel).toBe("")
  })

  test("reports prefix byte sizes for unified reasoning txt", () => {
    const reasoningBytes = Buffer.byteLength(PROMPT_REASONING, "utf8")
    const combined = Buffer.byteLength(
      ProviderTransform.systemPromptPrefix(mockModel("openai/gpt-4")),
      "utf8",
    )
    expect(reasoningBytes).toBeGreaterThan(10_000)
    expect(reasoningBytes).toBeLessThan(80_000)
    expect(combined).toBe(reasoningBytes)
  })
})

describe("validateSystemOrder", () => {
  test("returns true for correctly ordered system", () => {
    const system = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      reasoningPrefix: PROMPT_REASONING,
      kernel: "",
      agentPrompt: "AGENT",
      pathSystem: ["RULES", "SKILLS", "ENV", "INSTRUCTIONS"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      checkpoint: false,
    })
    expect(validateSystemOrder(system)).toBe(true)
  })

  test("returns true for short system (no validation needed)", () => {
    expect(validateSystemOrder(["UE", "TOOLS"])).toBe(true)
  })
})
