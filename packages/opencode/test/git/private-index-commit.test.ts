import { $ } from "bun"
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

setDefaultTimeout(20_000)

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const SCRIPT = path.join(REPO_ROOT, "scripts", "commit_own.py")
const HOOK_BODY = "#!/bin/sh\necho ran >> hook-marker.log\nexit 0\n"

async function initFixture() {
  const tmp = await tmpdir({ git: true })
  const repo = tmp.path
  await Bun.write(path.join(repo, "a.txt"), "a-base\n")
  await Bun.write(path.join(repo, "b.txt"), "b-base\n")
  await $`git add a.txt b.txt`.cwd(repo).quiet()
  await $`git commit -m base`.cwd(repo).quiet()
  writeFileSync(path.join(repo, ".git", "hooks", "pre-commit"), HOOK_BODY)
  return Object.assign(tmp, { repo })
}

function hookRuns(repo: string): number {
  const marker = path.join(repo, "hook-marker.log")
  if (!existsSync(marker)) return 0
  return readFileSync(marker, "utf8").split("\n").filter((l) => l === "ran").length
}

async function stagedSnapshot(repo: string): Promise<string> {
  return (await $`git ls-files -s`.cwd(repo).quiet()).text()
}

describe("commit_own.py — private-index commit route", () => {
  test("B's commit carries only B's paths; A's staged state survives", async () => {
    await using fix = await initFixture()
    const repo = fix.repo
    await Bun.write(path.join(repo, "a.txt"), "a-work\n")
    await Bun.write(path.join(repo, "b.txt"), "b-work\n")
    await $`git add a.txt`.cwd(repo).quiet()
    const before = await stagedSnapshot(repo)
    expect(before).toContain("a.txt")

    const run = await $`python ${SCRIPT} --session sessB -m "b work" -- b.txt`.cwd(repo).quiet().nothrow()
    expect(run.exitCode).toBe(0)

    const names = (await $`git show --name-only --format= HEAD`.cwd(repo).quiet()).text().trim().split("\n")
    expect(names).toEqual(["b.txt"])
    expect(await stagedSnapshot(repo)).toBe(before)

    const commitB = await $`git commit -m "a work" -- a.txt`.cwd(repo).quiet()
    expect(commitB.exitCode).toBe(0)
    const subjects = (await $`git log --format=%s`.cwd(repo).quiet()).text()
    expect(subjects).toContain("b work")
    expect(subjects).toContain("a work")
    expect(existsSync(path.join(repo, ".git", "index-sessB"))).toBe(false)
  })

  test("pre-commit hook runs once per route commit", async () => {
    await using fix = await initFixture()
    const repo = fix.repo
    await Bun.write(path.join(repo, "b.txt"), "b-work\n")
    const runsBefore = hookRuns(repo)
    const run = await $`python ${SCRIPT} --session sessH -m "hooked" -- b.txt`.cwd(repo).quiet().nothrow()
    expect(run.exitCode).toBe(0)
    expect(hookRuns(repo)).toBe(runsBefore + 1)
  })

  test("HEAD moved between seed and commit: retry lands both commits", async () => {
    await using fix = await initFixture()
    const repo = fix.repo
    await Bun.write(path.join(repo, "b.txt"), "b-work\n")
    const run = await $`python ${SCRIPT} --session sessR -m "b work" -- b.txt`
      .cwd(repo)
      .env({ ...process.env, COMMIT_OWN_RACE_HOOK: "git commit --allow-empty -m race" })
      .quiet()
      .nothrow()
    expect(run.exitCode).toBe(0)
    const subjects = (await $`git log --format=%s`.cwd(repo).quiet()).text()
    expect(subjects).toContain("race")
    expect(subjects).toContain("b work")
    const top2 = (await $`git log --format=%s -2`.cwd(repo).quiet()).text().trim().split("\n")
    expect(top2).toEqual(["b work", "race"])
    const content = (await $`git show HEAD:b.txt`.cwd(repo).quiet()).text()
    expect(content).toBe("b-work\n")
  })

  test("unmodified path is refused, never an empty commit", async () => {
    await using fix = await initFixture()
    const repo = fix.repo
    const countBefore = (await $`git rev-list --count HEAD`.cwd(repo).quiet()).text().trim()
    const run = await $`python ${SCRIPT} --session sessN -m "nothing" -- b.txt`.cwd(repo).quiet().nothrow()
    expect(run.exitCode).not.toBe(0)
    expect(run.stderr.toString() + run.stdout.toString()).toMatch(/nothing staged|no changes/i)
    const countAfter = (await $`git rev-list --count HEAD`.cwd(repo).quiet()).text().trim()
    expect(countAfter).toBe(countBefore)
    expect(existsSync(path.join(repo, ".git", "index-sessN"))).toBe(false)
  })
})
