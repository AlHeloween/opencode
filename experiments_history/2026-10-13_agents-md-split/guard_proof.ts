/**
 * Fallibility proof for the AGENTS.md size guard (`.husky/agents-size-guard.mjs`, run by `.husky/pre-commit`).
 *
 * Runs the guard itself twice:
 *   - default budget    -> must pass (exit 0, "within the … budget")
 *   - AGENTS_MD_BUDGET=1 -> must FAIL (exit 1, names the overflow and "Move prose to docs/")
 *
 * Usage (from repo root, via cmd_runner):
 *   cmd_runner start --cwd . -- bun run experiments/2026-10-13_agents-md-split/guard_proof.ts
 */
const hook = await Bun.file(".husky/pre-commit").text()
if (!hook.includes("agents-size-guard.mjs")) throw new Error("pre-commit does not call the guard")

const run = (budget?: string) => {
  const env = { ...process.env } as Record<string, string>
  if (budget === undefined) delete env.AGENTS_MD_BUDGET
  else env.AGENTS_MD_BUDGET = budget
  const p = Bun.spawnSync(["bun", ".husky/agents-size-guard.mjs"], { env, stdout: "pipe", stderr: "pipe" })
  return { code: p.exitCode, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() }
}

const ok = run(undefined)
console.log(`default:    exit=${ok.code} out=${ok.out}`)
const bad = run("1")
console.log(`override=1: exit=${bad.code} err=${bad.err}`)

if (ok.code !== 0 || !ok.out.includes("within the")) throw new Error("positive path failed")
if (bad.code !== 1 || !bad.err.includes("Move prose to docs/")) throw new Error("negative path failed")
console.log("GUARD_FALLIBILITY_OK")
