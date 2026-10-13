/**
 * AGENTS.md size guard (2026-10-13 split): the rules stay in AGENTS.md, prose lives in docs/.
 * Run by `.husky/pre-commit`. Fails when AGENTS.md exceeds its post-split size + 15%
 * (50 482 B on disk -> 58 055 B budget).
 *
 * AGENTS_MD_BUDGET overrides the budget so the failure path is provably fallible
 * (experiments/2026-10-13_agents-md-split/guard_proof.ts); the normal flow never sets it.
 */
import { statSync } from "fs"

const budget = Number(process.env.AGENTS_MD_BUDGET || 58055)
const size = statSync("AGENTS.md").size
if (size > budget) {
  console.error(`❌ AGENTS.md is ${size} B — over the ${budget} B budget by ${size - budget} B. Move prose to docs/ (keep rules + a Details: pointer).`)
  process.exit(1)
}
console.log(`✅ AGENTS.md ${size} B within the ${budget} B budget`)
