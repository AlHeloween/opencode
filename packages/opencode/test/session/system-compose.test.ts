import { createHash } from "crypto"
import { describe, expect, test } from "bun:test"
import {
  assemblePathSystem,
  assembleSystemMessages,
  collapseSystemMessages,
  collapseSystemMessagesInPlace,
  composeCheckpointSystemPrompt,
  validateSystemOrder,
} from "../../src/session/system-compose"
import PROMPT_REASONING from "../../src/session/prompt/reasoning_prompt.txt"
import { ProviderTransform } from "../../src/provider/transform"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider/provider"

const EXPECTED_REASONING_DIGEST = createHash("sha256").update(PROMPT_REASONING, "utf8").digest("hex")

function mockModel(id: string): Provider.Model {
  return {
    id: ModelID.zod.parse(id),
    providerID: ProviderID.zod.parse("test"),
    api: { id: id.split("/").pop()!, url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
    name: id,
    capabilities: {
      temperature: true, reasoning: false, attachment: false, toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 8_192 },
    status: "active", options: {}, headers: {}, release_date: "2026-01-01",
  }
}

describe("system-compose path assembly", () => {
  test("stable-first: rules → skills → env → instructions", () => {
    expect(
      assemblePathSystem({
        skills: "SKILLS", env: ["ENV"], rules: ["RULES"], instructions: ["AGENTS.md"],
      }),
    ).toEqual(["RULES", "SKILLS", "ENV", "AGENTS.md"])
  })
})

describe("system-compose provider assembly", () => {
  test("path tiers are separate slots, banner before agentPrompt in mutable tail", () => {
    const parts = assembleSystemMessages({
      universalEnv: "UE",
      reasoningPrefix: "REASONING", kernel: "KERNEL",
      agentPrompt: "AGENT_PROMPT",
      pathSystem: ["RULES", "SKILLS", "ENV", "INSTRUCTIONS"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      userSystem: "USER",
      checkpoint: false,
    })
    // Slots: [0] UE, [1] kernel, [2] RULES, [3] SKILLS, [4] ENV, [5] INSTRUCTIONS, [6] mutable
    expect(parts).toEqual([
      "UE",
      "REASONING\nKERNEL",
      "RULES",
      "SKILLS",
      "ENV",
      "INSTRUCTIONS",
      "[session: ses_1]\nActive tools: a\nAGENT_PROMPT\nUSER",
    ])
  })

  test("checkpoint drops stored identity prefix from pathSystem[0]", () => {
    const parts = assembleSystemMessages({
      universalEnv: "UE",
      reasoningPrefix: "REASONING", kernel: "KERNEL",
      agentPrompt: "AGENT_PROMPT",
      pathSystem: ["OLD_IDENTITY", "RULES", "SKILLS", "ENV"],
      activeToolsLine: "",
      banner: "[session: ses_1]",
      checkpoint: true,
    })
    expect(parts.slice(2, -1)).toEqual(["RULES", "SKILLS", "ENV"])  // path tiers
    expect(parts.join("\n")).not.toContain("OLD_IDENTITY")
    expect(parts[parts.length - 1]).toContain("AGENT_PROMPT")
    expect(parts[parts.length - 1]).toContain("[session: ses_1]")
  })

  test("collapse keeps path tiers and mutable tail separate", () => {
    const raw = assembleSystemMessages({
      universalEnv: "UE",
      reasoningPrefix: "REASONING", kernel: "KERNEL",
      agentPrompt: "AGENT_PROMPT",
      pathSystem: ["RULES", "SKILLS", "ENV", "INSTRUCTIONS"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      checkpoint: false,
    })
    const collapsed = collapseSystemMessages(raw, "UE")
    // 7 slots (≤8) → no collapse, identical to raw
    expect(collapsed).toEqual(raw)
    // Session only in mutable tail, never in path tiers
    const mutable = collapsed[collapsed.length - 1]
    expect(mutable).toContain("[session: ses_1]")
    for (let i = 2; i < collapsed.length - 1; i++) {
      expect(collapsed[i]).not.toContain("[session:")
    }
  })

  test("two sessions share identical prefix across path tiers", () => {
    const base = {
      universalEnv: "UE",
      reasoningPrefix: "REASONING", kernel: "KERNEL",
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
    // All slots except the last (mutable tail) must be byte-identical
    for (let i = 0; i < a.length - 1; i++) {
      expect(a[i]).toBe(b[i])
    }
    // Only mutable tail differs
    expect(a[a.length - 1]).not.toBe(b[b.length - 1])
    expect(a[a.length - 1]).toContain("ses_AAA")
    expect(b[b.length - 1]).toContain("ses_BBB")
  })

  test("collapse is a no-op when header was mutated by a plugin", () => {
    const raw = ["MUTATED", "TOOLS", "TAIL"]
    expect(collapseSystemMessages(raw, "UE")).toEqual(raw)
  })

  test("in-place collapse preserves 4-slot system", () => {
    const system = ["UE", "REASONING", "PATH", "TAIL"]
    collapseSystemMessagesInPlace(system, "UE")
    expect(system).toEqual(["UE", "REASONING", "PATH", "TAIL"])
  })
})

describe("system prefix digest (reasoning_prompt.txt)", () => {
  test("reasoning_prompt.txt artifact has stable documented digest", () => {
    const digest = createHash("sha256").update(PROMPT_REASONING, "utf8").digest("hex")
    expect(digest).toBe(EXPECTED_REASONING_DIGEST)
    expect(PROMPT_REASONING).toContain("ABI_AND_VOCABULARY")
    expect(PROMPT_REASONING).toContain("KERNEL_MAP")
    expect(PROMPT_REASONING).not.toContain("_ALL_SPECS")
  })

  test("systemPromptPrefix is unified reasoning_prompt.txt, byte-stable", () => {
    const model = mockModel("anthropic/claude-sonnet-4")
    const a = ProviderTransform.systemPromptPrefix(model)
    const b = ProviderTransform.systemPromptPrefix(model)
    expect(a).toBe(b)
    expect(a).toContain("KERNEL_MAP")
    expect(a).toContain("ABI_AND_VOCABULARY")
    expect(a.indexOf("KERNEL_MAP")).toBeLessThan(a.indexOf("ABI_AND_VOCABULARY"))
    expect(a).toContain(PROMPT_REASONING.slice(0, 40))
  })

  test("systemPromptParts loads full txt as reasoning; kernel slot empty", () => {
    const parts = ProviderTransform.systemPromptParts(mockModel("anthropic/claude-sonnet-4"))
    expect(parts.reasoning.length).toBeGreaterThan(10_000)
    expect(parts.reasoning.length).toBeLessThan(80_000)
    expect(parts.reasoning).toContain("KERNEL_MAP")
    expect(parts.reasoning).toContain("CLAIM_LEDGER")
    expect(parts.reasoning).toMatch(/REUSE_BEFORE|REUSE\.BEFORE/)
    expect(parts.reasoning).toContain("ABI_AND_VOCABULARY")
    expect(parts.reasoning).toContain("SHARED_RULES")
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
    expect(validateSystemOrder(["UE", "PATH"])).toBe(true)
  })
})

/**
 * Single-identity discipline for persisted checkpoint systemPrompt.
 *
 * Regression: captureSummary prepended the identity (= reasoning kernel,
 * ~57k chars) on EVERY call over a live checkpoint — three compactions grew
 * the wire prefix to three kernel copies (~35-40k dead tokens per request).
 * The composer must repair accumulated copies on reuse and prepend exactly
 * once on fresh assembly.
 */
const IDENTITY = "KERNEL-IDENTITY-TEXT"
const RULES = ["rule-a", "rule-b"]

describe("composeCheckpointSystemPrompt — single-identity invariant", () => {
  test("fresh assembly prepends identity exactly once", () => {
    const result = composeCheckpointSystemPrompt({ stored: undefined, freshPath: RULES, identity: IDENTITY })
    expect(result).toEqual([IDENTITY, ...RULES])
    expect(result.filter((entry) => entry === IDENTITY)).toHaveLength(1)
  })

  test("reuse of a clean stored prompt is unchanged", () => {
    const stored = [IDENTITY, ...RULES]
    const result = composeCheckpointSystemPrompt({ stored, freshPath: [], identity: IDENTITY })
    expect(result).toEqual([IDENTITY, ...RULES])
    expect(result.filter((entry) => entry === IDENTITY)).toHaveLength(1)
  })

  test("reuse repairs historical identity accumulation (3 compactions)", () => {
    // What the old captureSummary produced: identity copied on every capture.
    const stored = [IDENTITY, IDENTITY, IDENTITY, ...RULES]
    const result = composeCheckpointSystemPrompt({ stored, freshPath: [], identity: IDENTITY })
    expect(result).toEqual([IDENTITY, ...RULES])
    expect(result.filter((entry) => entry === IDENTITY)).toHaveLength(1)
    // Rules survive the repair untouched.
    expect(result.slice(1)).toEqual(RULES)
  })

  test("repair keeps non-identity duplicates (only identity discipline is enforced)", () => {
    const stored = [IDENTITY, "rule-a", "rule-a", IDENTITY]
    const result = composeCheckpointSystemPrompt({ stored, freshPath: [], identity: IDENTITY })
    expect(result).toEqual([IDENTITY, "rule-a", "rule-a"])
  })

  test("empty identity on fresh assembly prepends nothing", () => {
    const result = composeCheckpointSystemPrompt({ stored: undefined, freshPath: RULES, identity: "" })
    expect(result).toEqual(RULES)
  })

  test("empty stored array falls back to fresh assembly", () => {
    const result = composeCheckpointSystemPrompt({ stored: [], freshPath: RULES, identity: IDENTITY })
    expect(result).toEqual([IDENTITY, ...RULES])
  })
})
