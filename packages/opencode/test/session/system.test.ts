import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session/session"
import { SystemPrompt } from "../../src/session/system"
import { provideInstance, tmpdir } from "../fixture/fixture"
import PROMPT_ANTHROPIC from "../../src/session/prompt/anthropic.txt"
import PROMPT_DEFAULT from "../../src/session/prompt/default.txt"
import PROMPT_GPT from "../../src/session/prompt/gpt.txt"
import PROMPT_PLAN from "../../src/session/prompt/plan.txt"
import PROMPT_REASONING from "../../src/session/prompt/reasoning.txt"
import PROMPT_PLAN_REMINDER_ANTHROPIC from "../../src/session/prompt/plan-reminder-anthropic.txt"
import TASK_DESCRIPTION from "../../src/tool/task.txt"

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
