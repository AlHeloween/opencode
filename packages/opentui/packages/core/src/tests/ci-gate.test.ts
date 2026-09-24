/**
 * The CI gate holds its own spelling: three surfaces must agree, or `bun turbo test:ci`
 * silently skips `@opentui/core` again — the way 88 failures accumulated unseen.
 * Plan: `plans/to_be_confirmed/2026-09-22_opentui-core-test-ci-gate.md` (G4, the planstatus three-surface rule).
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dir, "../../../../../../")

function readJson(rel: string) {
  return JSON.parse(readFileSync(resolve(repoRoot, rel), "utf-8"))
}

test("the @opentui/core test:ci gate is registered on all three surfaces", () => {
  // 1. the script exists in the package itself
  const pkg = readJson("packages/opentui/packages/core/package.json")
  expect(pkg.scripts["test:ci"]).toContain("bun test")
  expect(pkg.scripts["test:ci"]).toContain("--reporter=junit")

  // 2. turbo knows the task — without this entry `bun turbo test:ci` never reaches the package
  const turbo = readJson("turbo.json")
  expect(Object.keys(turbo.tasks)).toContain("@opentui/core#test:ci")

  // 3. CI runs the pipeline AND publishes a path that covers this package's report
  const workflow = readFileSync(resolve(repoRoot, ".github/workflows/test.yml"), "utf-8")
  expect(workflow).toContain("bun turbo test:ci")
  expect(workflow).toContain("packages/**/.artifacts/unit/junit.xml")
})
