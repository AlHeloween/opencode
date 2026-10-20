// std: ISO/IEC/IEEE 29119-3:2021 — Software testing, Part 3: Test documentation
//   (governs this unit-test file: test-documentation templates for the 29119-2 test process).
// receipt: universalsearch web «ISO/IEC/IEEE 29119 software testing standard test plan documentation»
//   -> webfetch https://www.iso.org/standard/79429.html
//   content_hash=1d10fe45b74c824e98d5a0b52c746162d7397bfc89758ec0f54540d3bae4d2d7
//   abstract: «specifies software test documentation templates ... output of the processes in 29119-2».
import { describe, expect, test } from "bun:test"
import { execFileSync } from "child_process"
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  formatPlanHygiene,
  getNoStandardReport,
  getPlanStatus,
  isEditedAfterCutoff,
  NO_STANDARD_CUTOFF,
  parseBoxStandard,
} from "../../src/util/plan-status"

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-nostd-"))
  mkdirSync(path.join(dir, "plans"), { recursive: true })
  mkdirSync(path.join(dir, "plans_completed"), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, "plans", name), body)
  return dir
}

const MIXED = [
  "- [ ] **T1 work one** std: ISO/IEC/IEEE 29119-3:2021",
  "- [ ] **T2 work two** std: none found (grep «std:»)",
  "- [ ] **T3 work three** std: none",
  "- [ ] **T4 work four**",
  "- [x] **T5 done, history**",
].join("\n")

describe("util.plan-status box standard", () => {
  test("the cutoff is the contracted one — a move needs a reason in the code", () => {
    expect(NO_STANDARD_CUTOFF).toBe("2026-10-21")
  })

  test("parseBoxStandard: named, receipted none, bare none, missing — four kinds, not two", () => {
    expect(parseBoxStandard("- [ ] **T1 x** std: ISO/IEC/IEEE 29119-3:2021").kind).toBe("named")
    expect(parseBoxStandard("- [ ] **T2 x** std: none found (grep «std:»)").kind).toBe("none-found")
    expect(parseBoxStandard("- [ ] **T3 x** std: none").kind).toBe("bare-none")
    expect(parseBoxStandard("- [ ] **T4 x**").kind).toBe("missing")
    // The control that must NOT read as a receipt: a bare «none» wears the shape of an entry.
    expect(parseBoxStandard("- [ ] **T5 x** std: none").kind).not.toBe("none-found")
  })

  test("a new/edited plan puts bare-none and missing boxes into red debt — never silent", () => {
    const dir = fixture({ "2026-03-01_mixed.md": `# Mixed\n\n${MIXED}\n` })
    const report = getNoStandardReport(dir, { cutoff: "2026-10-21", isEdited: () => true })
    expect(report.cutoff).toBe("2026-10-21")
    // T3 (bare none) + T4 (missing). T1/T2 comply; T5 is closed history, never counted.
    expect(report.debt.boxes).toBe(2)
    expect(report.debt.plans).toEqual(["plans/2026-03-01_mixed.md"])
    expect(report.grandfathered.boxes).toBe(0)
  })

  test("an untouched old plan counts the same boxes grey, not red — visibility without noise", () => {
    const dir = fixture({ "2026-03-01_mixed.md": `# Mixed\n\n${MIXED}\n` })
    const report = getNoStandardReport(dir, { cutoff: "2026-10-21", isEdited: () => false })
    expect(report.grandfathered.boxes).toBe(2)
    expect(report.grandfathered.plans).toEqual(["plans/2026-03-01_mixed.md"])
    expect(report.debt.boxes).toBe(0)
  })

  test("the hygiene line prints the contracted phrase for red debt", () => {
    const dir = fixture({ "2026-03-01_mixed.md": `# Mixed\n\n${MIXED}\n` })
    // New/edited plans read red; the stub stands in for the git detector here —
    // the detector's own legs (git log, mtime fallback) are qualified below.
    const line = formatPlanHygiene(getPlanStatus(dir, { isEdited: () => true }))
    expect(line).toContain("No standard: 2 box(es) in 1 plan(s)")
  })

  test("the hygiene line names the grey count too — grandfathered is listed, not hidden", () => {
    const dir = fixture({ "2026-03-01_mixed.md": `# Mixed\n\n${MIXED}\n` })
    const line = formatPlanHygiene(getPlanStatus(dir, { isEdited: () => false }))
    expect(line).toContain("grandfathered")
    expect(line).not.toContain("No standard: 2 box(es)")
  })
})

describe("util.plan-status edited-after-cutoff detector", () => {
  function gitFixture(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "plan-nostd-git-"))
    execFileSync("git", ["init"], { cwd: dir })
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
    return dir
  }

  function commit(dir: string, file: string, body: string, date: string): void {
    writeFileSync(path.join(dir, file), body)
    execFileSync("git", ["add", file], { cwd: dir })
    execFileSync("git", ["commit", "-m", "x"], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    })
  }

  test("git-qualified: old commit reads false, new commit true, untracked true", () => {
    const dir = gitFixture()
    commit(dir, "2026-03-02_old.md", "# Old\n\n- [ ] work\n", "2026-01-01T00:00:00Z")
    const abs = path.join(dir, "2026-03-02_old.md")
    expect(isEditedAfterCutoff(abs, "2026-10-21")).toBe(false)
    writeFileSync(abs, "# Old\n\n- [ ] work\n- [ ] more\n")
    commit(dir, "2026-03-02_old.md", "# Old\n\n- [ ] work\n- [ ] more\n", "2026-10-22T00:00:00Z")
    expect(isEditedAfterCutoff(abs, "2026-10-21")).toBe(true)
    // The control that must NOT pass vacuously: a file git never saw is new, hence red.
    writeFileSync(path.join(dir, "2026-03-03_new.md"), "# New\n\n- [ ] work\n")
    expect(isEditedAfterCutoff(path.join(dir, "2026-03-03_new.md"), "2026-10-21")).toBe(true)
  })

  test("mtime fallback: a file touched before the cutoff reads grey, after it red", () => {
    // The detector's second leg, qualified on a fixture with pinned mtimes (git is absent here).
    const oldDir = fixture({ "2026-03-04_old.md": `# Old\n\n- [ ] work\n` })
    const newDir = fixture({ "2026-03-05_new.md": `# New\n\n- [ ] work\n` })
    utimesSync(path.join(oldDir, "plans", "2026-03-04_old.md"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))
    utimesSync(path.join(newDir, "plans", "2026-03-05_new.md"), new Date("2026-10-22T00:00:00Z"), new Date("2026-10-22T00:00:00Z"))
    expect(getPlanStatus(oldDir).noStandardGrandfathered).toEqual([{ file: "plans/2026-03-04_old.md", boxes: 1 }])
    expect(getPlanStatus(newDir).noStandard).toEqual([{ file: "plans/2026-03-05_new.md", boxes: 1 }])
  })
})
