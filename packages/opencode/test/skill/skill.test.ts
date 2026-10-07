import { describe, expect, setDefaultTimeout } from "bun:test"
import { Effect, Layer } from "effect"
import { Skill } from "../../src/skill"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideInstance, provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import path from "path"
import fs from "fs/promises"

// Each case spawns git and boots an instance (~4 s alone); under a loaded machine bun's 5 s
// default turned all five red on 2026-10-07 (run 20261007T161354Z_f782d0b1) with no code fault.
setDefaultTimeout(20_000)

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, node))

async function writeSkill(file: string, name: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    `---
name: ${name}
description: Fixture skill ${name}.
---

# ${name}
`,
  )
}

const withHome = <A, E, R>(home: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = home
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        process.env.OPENCODE_TEST_HOME = prev
      }),
  )

describe("skill", () => {
  it.live("discovers skills from .opencode/skill/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "test-skill", "SKILL.md"),
              `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(2)
          const item = list.find((x) => x.name === "test-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBe("A test skill for verification.")
          expect(item!.location).toContain(path.join("skill", "test-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers multiple skills from .opencode/skill/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".opencode", "skill", "skill-one", "SKILL.md"),
                `---
name: skill-one
description: First test skill.
---

# Skill One
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skill", "skill-two", "SKILL.md"),
                `---
name: skill-two
description: Second test skill.
---

# Skill Two
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(3)
          expect(list.find((x) => x.name === "skill-one")).toBeDefined()
          expect(list.find((x) => x.name === "skill-two")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("skips skills with missing frontmatter", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "no-frontmatter", "SKILL.md"),
              `# No Frontmatter

Just some content without YAML frontmatter.
`,
            ),
          )

          const skill = yield* Skill.Service
          const all = yield* skill.all()
          expect(all.length).toBe(1)
          expect(all[0].name).toBe("compaction")
        }),
      { git: true },
    ),
  )

  it.live("returns only built-in compaction skill when no skills exist", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const all = yield* skill.all()
          expect(all.length).toBe(1)
          expect(all[0].name).toBe("compaction")
        }),
      { git: true },
    ),
  )

  // SUPERSEDED SPEC (plans_completed/2026-09-30_no-foreign-skill-discovery.md, F4). Six cases used to
  // assert that skills are discovered from foreign roots — project `.claude/skills/`,
  // `.agents/skills/`, both at once, the global `~/.claude/skills/` and `~/.agents/skills/`,
  // and a directory count that included the two foreign roots. The requirement changed
  // (owner, 2026-09-30): our runtime reads ONLY its own skill surfaces; a foreign skill is
  // adopted by copying it under `.opencode/skills/`, never read in place. This one case is
  // the new requirement, with every foreign root present so that any of them leaking FAILS,
  // and both of our own spellings (`skill/`, `skills/`) present so that the removal cannot
  // take our own surface with it (F2).
  it.live("reads only our own skill roots: .claude and .agents skills are not discovered", () =>
    Effect.gen(function* () {
      const home = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const project = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      yield* Effect.promise(() =>
        Promise.all([
          writeSkill(path.join(home.path, ".claude", "skills", "theirs-global-claude", "SKILL.md"), "theirs-global-claude"),
          writeSkill(path.join(home.path, ".agents", "skills", "theirs-global-agents", "SKILL.md"), "theirs-global-agents"),
          writeSkill(path.join(project.path, ".claude", "skills", "theirs-claude", "SKILL.md"), "theirs-claude"),
          writeSkill(path.join(project.path, ".agents", "skills", "theirs-agents", "SKILL.md"), "theirs-agents"),
          writeSkill(path.join(project.path, ".opencode", "skill", "ours-singular", "SKILL.md"), "ours-singular"),
          writeSkill(path.join(project.path, ".opencode", "skills", "ours-plural", "SKILL.md"), "ours-plural"),
        ]),
      )

      yield* withHome(
        home.path,
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const names = (yield* skill.all()).map((x) => x.name).toSorted()
          expect(names).toEqual(["compaction", "ours-plural", "ours-singular"])
          const dirs = (yield* skill.dirs()).map((x) => path.relative(project.path, x)).toSorted()
          expect(dirs).toEqual([
            path.join(".opencode", "skill", "ours-singular"),
            path.join(".opencode", "skills", "ours-plural"),
          ])
        }).pipe(provideInstance(project.path)),
      )
    }),
  )
})
