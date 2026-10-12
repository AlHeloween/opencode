import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

/**
 * Spec inventory integrity — the guard that keeps `specs/` from re-freezing what S1 unfroze.
 *
 * Measured 2026-10-12: eight spec files under `packages/opencode/specs` stated live inventory in
 * prose — a `makeRuntime` call-site count naming three files that no longer existed, a feature flag
 * deleted from `src`, tool lists naming removed tools. Every number was true the day it was typed,
 * nothing re-checked it, and a reader could not tell a fresh number from a stale one.
 *
 * The rule: **a number that can rot is either replaced by the command that recomputes it, or
 * generated.** So a line carrying BOTH a count and an inventory noun must also name the instrument
 * that recounts it — or sit below the generated marker, where a renderer owns it.
 *
 * What this does NOT check is whether a number is RIGHT — no scanner can see that. What it checks is
 * that no line claims a count while offering the reader no way to verify it. The countermeasure for
 * a class of defect is a check, not another editing pass (@KAIZEN).
 */

const SPECS_DIR = path.join(import.meta.dir, "../../specs")
/// The master map's convention: everything below this belongs to a renderer, not to an author.
const GENERATED_MARKER = "<!-- generated below -->"
/// A count followed by an inventory noun. Deliberately narrow — a wide rule cries wolf and dies.
const INVENTORY_CLAIM =
  /(?:^|[\s`])\d[\d\s,]*\s+(?:`[^`]*`\s+)?(?:call[- ]sites?|files?|matches?|routes?|handlers?|tools?|tables?|specs?)\b/i
/// How a line discharges the claim: name the instrument, or say it is recomputed.
const RECOUNT = /\brg\b|\bgrep\b|\bSELECT\b|\bdbread\b|\bcodegraph\b|recomput|recount|\bwc -l\b/i

async function specFiles() {
  const found: { rel: string; text: string }[] = []
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith(".md"))
        found.push({ rel: path.relative(SPECS_DIR, full), text: await fs.readFile(full, "utf8") })
    }
  }
  await walk(SPECS_DIR)
  return found.sort((a, b) => a.rel.localeCompare(b.rel))
}

describe("spec inventory integrity", () => {
  test("the scan finds the corpus (control that MUST match)", async () => {
    // A mis-pathed or empty scan must fail HERE, not pass as «no offenders».
    expect((await specFiles()).length).toBeGreaterThan(5)
  })

  test("no spec line claims a count without naming the command that recounts it", async () => {
    const offenders: string[] = []
    for (const file of await specFiles()) {
      let generated = false
      file.text.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(GENERATED_MARKER)) generated = true
        if (generated) return
        if (!INVENTORY_CLAIM.test(line)) return
        if (RECOUNT.test(line)) return
        offenders.push(`${file.rel}:${index + 1}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(offenders).toEqual([])
  })

  test("the rule is fallible — a frozen count MUST be caught, a discharged one MUST pass", () => {
    // The exact line this guard was written against: a count, no way to check it.
    const frozen = "- `src/` has 5 `makeRuntime(...)` call sites total."
    expect(INVENTORY_CLAIM.test(frozen)).toBe(true)
    expect(RECOUNT.test(frozen)).toBe(false)
    // The replacement: the same claim, discharged by the command.
    const discharged = '- `src/` has 5 `makeRuntime(...)` call sites; recount with `rg -n "makeRuntime" src`.'
    expect(INVENTORY_CLAIM.test(discharged)).toBe(true)
    expect(RECOUNT.test(discharged)).toBe(true)
    // A line that claims no count is not the guard's business.
    expect(INVENTORY_CLAIM.test("Practical reference for the current tool-migration state.")).toBe(false)
  })
})
