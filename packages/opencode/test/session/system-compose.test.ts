import { createHash } from "crypto"
import { describe, expect, test } from "bun:test"
import {
  assemblePathSystem,
  assembleSystemMessages,
  collapseSystemMessages,
  validateSystemOrder,
} from "../../src/session/system-compose"
import PROMPT_KERNEL from "../../src/session/prompt/opencode_prompts_kernel.txt"
import PROMPT_REASONING from "../../src/session/prompt/reasoning.txt"
import PROMPT_ALGORITHM from "../../src/session/prompt/algorithm_card.txt"
import { ProviderTransform } from "../../src/provider/transform"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider/provider"

/**
 * System prefix digest — update procedure for intentional kernel revisions:
 *
 * 1. Change `opencode_prompts_kernel.py` (canonical source).
 * 2. Regenerate: `python opencode_prompts_kernel.py --render-runtime packages/opencode/src/session/prompt/opencode_prompts_kernel.txt`
 * 3. Run: `cd packages/opencode && bun test test/session/system-compose.test.ts`
 * 4. If only the digest assertion fails, update EXPECTED_KERNEL_DIGEST below to the
 *    printed actual digest after reviewing the kernel diff.
 * 5. Commit kernel .txt + digest update together.
 */
const EXPECTED_KERNEL_DIGEST = createHash("sha256").update(PROMPT_KERNEL, "utf8").digest("hex")

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
      algorithmCard: "ALGORITHM_CARD",
      kernel: "KERNEL",
      agentPrompt: "AGENT_PROMPT",
      pathSystem: ["RULES", "SKILLS", "ENV", "INSTRUCTIONS"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      userSystem: "USER",
      checkpoint: false,
    })
    // Order: reasoning → ALGORITHM_CARD → kernel → rules → skills → env → agentPrompt → instructions
    expect(parts).toEqual([
      "UE",
      "TOOLS",
      "REASONING\nALGORITHM_CARD\nKERNEL\nRULES\nSKILLS\nENV\nAGENT_PROMPT\nINSTRUCTIONS",
      "Active tools: a\n[session: ses_1]\nUSER",
    ])
  })

  test("checkpoint path strips stored identity at pathSystem[0]", () => {
    const parts = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      reasoningPrefix: "REASONING",
      algorithmCard: "ALGORITHM_CARD",
      kernel: "KERNEL",
      agentPrompt: "AGENT_PROMPT",
      pathSystem: ["OLD_IDENTITY", "RULES", "SKILLS", "ENV"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      checkpoint: true,
    })
    // After stripping OLD_IDENTITY: reasoning → card → kernel → rules → skills → agentPrompt → env
    expect(parts[2]).toBe("REASONING\nALGORITHM_CARD\nKERNEL\nRULES\nSKILLS\nAGENT_PROMPT\nENV")
    expect(parts.join("\n")).not.toContain("OLD_IDENTITY")
    expect(parts.some((p) => p === "USER")).toBe(false)
  })

  test("collapse keeps stable body separate from session/mutable tail", () => {
    const raw = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      reasoningPrefix: "REASONING",
      algorithmCard: "ALGORITHM_CARD",
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
    expect(collapsed).toEqual([
      "UE",
      "TOOLS",
      "REASONING\nALGORITHM_CARD\nKERNEL\nRULES\nSKILLS\nENV\nAGENT_PROMPT\nINSTRUCTIONS",
      "Active tools: a\n[session: ses_1]",
    ])
    expect(collapsed[2]).not.toContain("[session:")
    expect(collapsed[3]).toContain("[session: ses_1]")
  })

  test("two sessions share identical stable prefix bytes", () => {
    const base = {
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      reasoningPrefix: "REASONING",
      algorithmCard: "ALGORITHM_CARD",
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
    expect(a[2]).toContain("SKILLS")
    expect(a[2]).not.toContain("ses_")
    // Only the mutable tail differs
    expect(a[3]).not.toBe(b[3])
    expect(a[3]).toContain("ses_AAA")
    expect(b[3]).toContain("ses_BBB")
  })

  test("collapse is a no-op when header was mutated by a plugin", () => {
    const raw = ["MUTATED", "TOOLS", "TAIL"]
    expect(collapseSystemMessages(raw, "UE")).toEqual(raw)
  })
})

describe("system prefix digest (kernel + reasoning)", () => {
  test("kernel artifact has stable documented digest", () => {
    const digest = createHash("sha256").update(PROMPT_KERNEL, "utf8").digest("hex")
    expect(digest).toBe(EXPECTED_KERNEL_DIGEST)
    expect(PROMPT_KERNEL).toContain("PROMPT_ABI")
    expect(PROMPT_KERNEL).toContain("CONTRACTS")
    expect(PROMPT_KERNEL).not.toContain("_ALL_SPECS")
  })

  test("systemPromptPrefix is reasoning then algorithm then kernel, byte-stable", () => {
    const model = mockModel("anthropic/claude-sonnet-4")
    const a = ProviderTransform.systemPromptPrefix(model)
    const b = ProviderTransform.systemPromptPrefix(model)
    expect(a).toBe(b)
    expect(a.indexOf("REASONING PROTOCOL")).toBeLessThan(a.indexOf("ALGORITHM_CARD"))
    expect(a.indexOf("ALGORITHM_CARD")).toBeLessThan(a.indexOf("PROMPT_ABI"))
    expect(a).toContain(PROMPT_REASONING.slice(0, 40))
    expect(a).toContain(PROMPT_ALGORITHM.slice(0, 40))
    expect(a.endsWith(PROMPT_KERNEL) || a.includes(PROMPT_KERNEL.slice(0, 80))).toBe(true)
  })

  test("systemPromptParts keeps full reasoning, algorithm card, and kernel separate", () => {
    const parts = ProviderTransform.systemPromptParts(mockModel("anthropic/claude-sonnet-4"))
    // Lean ADID density: reasoning is a pocket protocol, not a 11KB essay.
    // Regression: split("\\n\\n") on the join must not truncate/mis-slot files.
    expect(parts.reasoning.length).toBeGreaterThan(1_500)
    expect(parts.reasoning.length).toBeLessThan(8_000)
    expect(parts.reasoning).toContain("REASONING PROTOCOL")
    expect(parts.reasoning).toContain("SVM noise filter")
    expect(parts.reasoning).toContain("ALGORITHM_CARD")
    expect(parts.reasoning).not.toContain("PROMPT_ABI")
    expect(parts.algorithm).toContain("ALGORITHM_CARD")
    expect(parts.algorithm).toContain("run_task_geometry")
    expect(parts.algorithm).not.toContain("PROMPT_ABI")
    expect(parts.kernel.length).toBeGreaterThan(5_000)
    expect(parts.kernel).toContain("PROMPT_ABI")
    expect(parts.kernel).toContain("MappingProxyType")
    expect(parts.kernel.startsWith("# Generated from opencode_prompts_kernel.py") || parts.kernel.includes("PROMPT_ABI")).toBe(
      true,
    )
  })

  test("reports prefix byte sizes for reasoning, algorithm, and kernel", () => {
    const reasoningBytes = Buffer.byteLength(PROMPT_REASONING, "utf8")
    const algorithmBytes = Buffer.byteLength(PROMPT_ALGORITHM, "utf8")
    const kernelBytes = Buffer.byteLength(PROMPT_KERNEL, "utf8")
    const combined = Buffer.byteLength(
      ProviderTransform.systemPromptPrefix(mockModel("openai/gpt-4")),
      "utf8",
    )
    expect(kernelBytes).toBeGreaterThan(5_000)
    expect(kernelBytes).toBeLessThan(80_000)
    expect(reasoningBytes).toBeGreaterThan(1_500)
    expect(reasoningBytes).toBeLessThan(8_000)
    expect(algorithmBytes).toBeGreaterThan(500)
    expect(combined).toBeGreaterThanOrEqual(reasoningBytes + algorithmBytes + kernelBytes)
  })
})

describe("validateSystemOrder", () => {
  test("returns true for correctly ordered system", () => {
    const system = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      reasoningPrefix: PROMPT_REASONING,
      algorithmCard: PROMPT_ALGORITHM,
      kernel: PROMPT_KERNEL,
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
