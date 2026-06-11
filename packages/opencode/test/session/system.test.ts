import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session/session"
import { SystemPrompt, parseFrontmatter, provider, providerName, promptFamily } from "../../src/session/system"
import type { Provider } from "../../src/provider/provider"
import { provideInstance, tmpdir } from "../fixture/fixture"
import PROMPT_ANTHROPIC from "../../src/session/prompt/anthropic.txt"
import PROMPT_DEFAULT from "../../src/session/prompt/default.txt"
import PROMPT_GPT from "../../src/session/prompt/gpt.txt"
import PROMPT_PLAN from "../../src/session/prompt/plan.txt"
import PROMPT_REASONING from "../../src/session/prompt/reasoning.txt"
import PROMPT_PLAN_REMINDER_ANTHROPIC from "../../src/session/prompt/plan-reminder-anthropic.txt"
import TASK_DESCRIPTION from "../../src/tool/task.txt"

function mockModel(apiId: string, providerId = "test"): Provider.Model {
  return {
    id: `${providerId}/${apiId}` as Provider.Model["id"],
    providerID: providerId as Provider.Model["providerID"],
    api: { id: apiId, url: "", npm: "" },
    name: apiId,
    capabilities: {} as Provider.Model["capabilities"],
    cost: {} as Provider.Model["cost"],
    limit: {} as Provider.Model["limit"],
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-01-01",
  }
}

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

describe("session.system", () => {
  test("prompt surfaces define explore to general delegation protocol", () => {
    for (const prompt of [PROMPT_REASONING, PROMPT_ANTHROPIC, PROMPT_DEFAULT, PROMPT_GPT, TASK_DESCRIPTION]) {
      expect(prompt).toContain("explore")
      expect(prompt).toContain("general")
      expect(prompt).toContain("trivial direct answers")
      expect(prompt).toContain("exact-file reads or edits")
      expect(prompt).toContain("cmd_runner session control/inspection")
      expect(prompt).toContain("without launching")
    }
  })

  test("plan reminders use general as planning subagent, not plan", async () => {
    const dynamic = await Bun.file(path.join(import.meta.dir, "../../src/session/prompt.ts")).text()

    expect(PROMPT_PLAN_REMINDER_ANTHROPIC).toContain("`general` subagent")
    expect(PROMPT_PLAN_REMINDER_ANTHROPIC).not.toContain("Plan subagent")
    expect(PROMPT_PLAN_REMINDER_ANTHROPIC).not.toContain("Plan agent")
    expect(dynamic).toContain("Launch general agent(s) to design the implementation")
    expect(dynamic).toContain("Launch at least 1 general agent")
    expect(dynamic).not.toContain("Launch at least 1 Plan agent")

    for (const prompt of [PROMPT_PLAN, PROMPT_PLAN_REMINDER_ANTHROPIC, dynamic]) {
      expect(prompt).toContain("cmd_runner session control/inspection")
      expect(prompt).toContain("do not launch general")
      expect(prompt).toContain("plans_completed")
      expect(prompt).toContain(".opencode/plans")
      expect(prompt).toContain("prohibited")
      expect(prompt).toContain("Explore agent")
      expect(prompt).toContain("real code execution state")
    }
  })

  test("session plan path uses repo root plans directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(path.relative(tmp.path, Session.plan({ slug: "check", time: { created: 123 } }))).toBe(
          path.join("plans", "123-check.md"),
        )
      },
    })
  })

  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".opencode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await load(tmp.path, (svc) => svc.get("build"))
          const runSkills = Effect.gen(function* () {
            const svc = yield* SystemPrompt.Service
            return yield* svc.skills(build!)
          }).pipe(Effect.provide(SystemPrompt.defaultLayer))

          const first = await Effect.runPromise(runSkills)
          const second = await Effect.runPromise(runSkills)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })
})

describe("parseFrontmatter", () => {
  test("extracts models and family, strips frontmatter from content", () => {
    const raw = [
      "---",
      "models:",
      "  - claude",
      "  - deepseek",
      "family: Claude",
      "---",
      "You are a coding assistant.",
    ].join("\n")
    const result = parseFrontmatter(raw)
    expect(result.models).toEqual(["claude", "deepseek"])
    expect(result.family).toBe("Claude")
    expect(result.content).toMatch(/^You are a coding assistant\./)
  })

  test("wildcard frontmatter", () => {
    const raw = [
      "---",
      "models:",
      '  - "*"',
      "family: General",
      "---",
      "Fallback prompt.",
    ].join("\n")
    const result = parseFrontmatter(raw)
    expect(result.models).toEqual(["*"])
    expect(result.family).toBe("General")
  })

  test("no frontmatter returns defaults", () => {
    const raw = "Just a plain prompt with no frontmatter."
    const result = parseFrontmatter(raw)
    expect(result.models).toEqual(["*"])
    expect(result.family).toBe("General")
    expect(result.content).toBe("Just a plain prompt with no frontmatter.")
  })

  test("empty models defaults to wildcard", () => {
    const raw = [
      "---",
      "family: SomeModel",
      "---",
      "Content after.",
    ].join("\n")
    const result = parseFrontmatter(raw)
    expect(result.models).toEqual(["*"])
    expect(result.family).toBe("SomeModel")
  })
})

describe("prompt matching (specificity-based)", () => {
  test("claude models match anthropic.txt", () => {
    const m = mockModel("claude-sonnet-4")
    expect(providerName(m)).toBe("anthropic.txt")
    expect(promptFamily(m)).toBe("Claude")
  })

  test("deepseek models match anthropic.txt", () => {
    const m = mockModel("deepseek-v4-pro")
    expect(providerName(m)).toBe("anthropic.txt")
    expect(promptFamily(m)).toBe("Claude")
  })

  test("gpt-4 models match beast.txt (specificity: gpt-4 > gpt)", () => {
    const m = mockModel("gpt-4-turbo")
    expect(providerName(m)).toBe("beast.txt")
    expect(promptFamily(m)).toBe("GPT (high-capability)")
  })

  test("o1 models match beast.txt", () => {
    const m = mockModel("o1-mini")
    expect(providerName(m)).toBe("beast.txt")
  })

  test("o3 models match beast.txt", () => {
    const m = mockModel("o3-large")
    expect(providerName(m)).toBe("beast.txt")
  })

  test("gpt-5 matches gpt.txt (gpt pattern, no gpt-4 match)", () => {
    const m = mockModel("gpt-5")
    expect(providerName(m)).toBe("gpt.txt")
    expect(promptFamily(m)).toBe("GPT")
  })

  test("gpt-codex matches codex.txt (codex > gpt specificity)", () => {
    const m = mockModel("gpt-codex-2")
    expect(providerName(m)).toBe("codex.txt")
    expect(promptFamily(m)).toBe("Codex")
  })

  test("gemini models match gemini.txt", () => {
    const m = mockModel("gemini-3-pro")
    expect(providerName(m)).toBe("gemini.txt")
    expect(promptFamily(m)).toBe("Gemini")
  })

  test("trinity models match trinity.txt", () => {
    const m = mockModel("trinity-v2", "some-provider")
    expect(providerName(m)).toBe("trinity.txt")
    expect(promptFamily(m)).toBe("Trinity")
  })

  test("kimi models match kimi.txt", () => {
    const m = mockModel("kimi-k2", "moonshot")
    expect(providerName(m)).toBe("kimi.txt")
    expect(promptFamily(m)).toBe("Kimi")
  })

  test("copilot-gpt-5 models match copilot-gpt-5.txt", () => {
    const m = mockModel("copilot-gpt-5")
    expect(providerName(m)).toBe("copilot-gpt-5.txt")
    expect(promptFamily(m)).toBe("GitHub Copilot")
  })

  test("unknown model falls back to default.txt", () => {
    const m = mockModel("unknown-model-xyz")
    expect(providerName(m)).toBe("default.txt")
    expect(promptFamily(m)).toBe("General")
  })
})

describe("prompt content clean of frontmatter", () => {
  test("provider() returns content without frontmatter block", () => {
    for (const apiId of [
      "claude-sonnet-4",
      "deepseek-v4",
      "gpt-4-turbo",
      "gpt-5",
      "gemini-3-pro",
      "unknown-model",
    ]) {
      const [content] = provider(mockModel(apiId))
      expect(content).not.toMatch(/^---/)
      expect(content.length).toBeGreaterThan(100)
    }
  })
})
