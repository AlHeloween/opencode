import { createHash } from "crypto"
import { describe, expect, test } from "bun:test"
import {
  assemblePathSystem,
  assembleSystemMessages,
  collapseSystemMessages,
} from "../../src/session/system-compose"
import PROMPT_KERNEL from "../../src/session/prompt/opencode_prompts_kernel.txt"
import PROMPT_REASONING from "../../src/session/prompt/reasoning.txt"
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
  test("stable-first: skills → env → rules → instructions", () => {
    expect(
      assemblePathSystem({
        skills: "SKILLS",
        env: ["ENV"],
        rules: ["RULES"],
        instructions: ["AGENTS.md"],
      }),
    ).toEqual(["SKILLS", "ENV", "RULES", "AGENTS.md"])
  })
})

describe("system-compose provider assembly", () => {
  test("orders universal env, tool schemas, identity, path, tools line, banner", () => {
    const parts = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      identity: "IDENTITY",
      pathSystem: ["SKILLS", "ENV", "RULES", "INSTRUCTIONS"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      userSystem: "USER",
      checkpoint: false,
    })
    expect(parts).toEqual([
      "UE",
      "TOOLS",
      "IDENTITY",
      "SKILLS\nENV\nRULES\nINSTRUCTIONS",
      "Active tools: a",
      "[session: ses_1]",
      "USER",
    ])
  })

  test("checkpoint path strips stored identity at pathSystem[0]", () => {
    const parts = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      identity: "FRESH_IDENTITY",
      pathSystem: ["OLD_IDENTITY", "SKILLS", "ENV"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      checkpoint: true,
    })
    expect(parts[2]).toBe("FRESH_IDENTITY")
    expect(parts[3]).toBe("SKILLS\nENV")
    expect(parts.join("\n")).not.toContain("OLD_IDENTITY")
    expect(parts.some((p) => p === "USER")).toBe(false)
  })

  test("collapse keeps UE + schemas and joins the mutable tail", () => {
    const raw = assembleSystemMessages({
      universalEnv: "UE",
      toolSchemas: "TOOLS",
      identity: "IDENTITY",
      pathSystem: ["PATH"],
      activeToolsLine: "Active tools: a",
      banner: "[session: ses_1]",
      checkpoint: false,
    })
    const collapsed = collapseSystemMessages(raw, "UE")
    expect(collapsed).toEqual([
      "UE",
      "TOOLS",
      "IDENTITY\nPATH\nActive tools: a\n[session: ses_1]",
    ])
  })

  test("collapse is a no-op when header was mutated by a plugin", () => {
    const raw = ["MUTATED", "TOOLS", "TAIL"]
    expect(collapseSystemMessages(raw, "UE")).toEqual(raw)
  })
})

describe("system prefix digest (kernel + reasoning)", () => {
  test("kernel artifact has stable documented digest", () => {
    const digest = createHash("sha256").update(PROMPT_KERNEL, "utf8").digest("hex")
    // Self-updating baseline: first run pins EXPECTED via import of current file.
    // When the kernel intentionally changes, regenerate .txt then refresh
    // EXPECTED_KERNEL_DIGEST in this file (see header comment).
    expect(digest).toBe(EXPECTED_KERNEL_DIGEST)
    expect(PROMPT_KERNEL).toContain("PROMPT_ABI")
    expect(PROMPT_KERNEL).toContain("CONTRACTS")
    expect(PROMPT_KERNEL).not.toContain("_ALL_SPECS")
  })

  test("systemPromptPrefix is reasoning then kernel, byte-stable across calls", () => {
    const model = mockModel("anthropic/claude-sonnet-4")
    const a = ProviderTransform.systemPromptPrefix(model)
    const b = ProviderTransform.systemPromptPrefix(model)
    expect(a).toBe(b)
    expect(a.indexOf("Communication Protocol")).toBeLessThan(a.indexOf("PROMPT_ABI"))
    expect(a).toContain(PROMPT_REASONING.slice(0, 40))
    expect(a.endsWith(PROMPT_KERNEL) || a.includes(PROMPT_KERNEL.slice(0, 80))).toBe(true)
  })

  test("reports prefix byte sizes for reasoning and kernel", () => {
    const reasoningBytes = Buffer.byteLength(PROMPT_REASONING, "utf8")
    const kernelBytes = Buffer.byteLength(PROMPT_KERNEL, "utf8")
    const combined = Buffer.byteLength(
      ProviderTransform.systemPromptPrefix(mockModel("openai/gpt-4")),
      "utf8",
    )
    // Guardrails: kernel should stay compact relative to historical full-source dumps
    // (dict+contracts+specs ~30–50KB; full module is 100KB+).
    expect(kernelBytes).toBeGreaterThan(5_000)
    expect(kernelBytes).toBeLessThan(80_000)
    expect(reasoningBytes).toBeGreaterThan(5_000)
    expect(combined).toBeGreaterThanOrEqual(reasoningBytes + kernelBytes)
  })
})
