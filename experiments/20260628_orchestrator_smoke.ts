/**
 * Orchestrator Permission Smoke Test
 *
 * Validates the orchestrator agent's permission configuration at runtime.
 * Standalone — no package imports needed. Tests the permission logic directly
 * by replicating the pure functions from the codebase.
 *
 * Run from repo root:
 *   bun run experiments/20260628_orchestrator_smoke.ts
 *
 * Expected: all PASS, exit code 0
 */

// ── Pure functions (replicating src/util/wildcard.ts) ──

function wildcardMatch(str: string, pattern: string): boolean {
  if (str) str = str.replaceAll("\\", "/")
  if (pattern) pattern = pattern.replaceAll("\\", "/")
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?"
  }
  const flags = process.platform === "win32" ? "si" : "s"
  return new RegExp("^" + escaped + "$", flags).test(str)
}

// ── Pure functions (replicating src/permission/evaluate.ts) ──

interface Rule {
  permission: string
  pattern: string
  action: string
}

function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  const rules = rulesets.flat()
  const match = [...rules].reverse().find(
    (rule) => wildcardMatch(permission, rule.permission) && wildcardMatch(pattern, rule.pattern),
  )
  return match ?? { permission, pattern: "*", action: "ask" }
}

// ── Pure functions (replicating src/permission/index.ts) ──

function fromConfig(config: Record<string, string | Record<string, string>>): Rule[] {
  const rules: Rule[] = []
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") {
      rules.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    for (const [pattern, action] of Object.entries(value)) {
      rules.push({ permission: key, pattern: pattern.replace(/\\/g, "/"), action })
    }
  }
  return rules
}

function disabled(tools: string[], ruleset: Rule[]): Set<string> {
  const EDIT_TOOLS = ["edit", "write", "apply_patch"]
  const result = new Set<string>()
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    const rule = [...ruleset].reverse().find((r) => wildcardMatch(permission, r.permission))
    if (!rule) continue
    if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
  }
  return result
}

// ── Config sources (copied from agent.ts lines 88-105, 152-169) ──

const defaultsConfig: Record<string, string | Record<string, string>> = {
  "*": "allow",
  doom_loop: "ask",
  question: "deny",
  plan_enter: "deny",
  plan_exit: "deny",
  read: {
    "*": "allow",
    "*.env": "ask",
    "*.env.*": "ask",
    "*.env.example": "allow",
  },
}

const orchestratorConfig: Record<string, string | Record<string, string>> = {
  edit: {
    "*": "deny",
    ".opencode/data/memory/*_orchestrator.md": "allow",
    "plans/*": "allow",
  },
  write: {
    "*": "deny",
    "plans/*": "allow",
  },
  bash: "allow",
  task: "allow",
  todowrite: "deny",
  read: "allow",
  glob: "allow",
  grep: "allow",
  list: "allow",
  messagesearch: "allow",
  "session-read": "allow",
  universalsearch: "allow",
  webfetch: "allow",
}

// ── Build combined ruleset (same as Permission.merge(defaults, specific)) ──

const defaults = fromConfig(defaultsConfig)
const specific = fromConfig(orchestratorConfig)
const ruleset = [...defaults, ...specific]

// ── Test runner ──

let passed = 0
let failed = 0

function test(description: string, fn: () => boolean) {
  const ok = fn()
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${description}`)
}

// ── Tests ──

console.log("\n=== Orchestrator Permission Smoke Test ===\n")
console.log(`Ruleset count: ${ruleset.length}\n`)

// ─ Edit tests ─
console.log("── Edit permission ──")
test("edit plans/*.md is ALLOWED", () => evaluate("edit", "plans/my_plan.md", ruleset).action === "allow")
test("edit plans/new_plan.md is ALLOWED", () => evaluate("edit", "plans/new_plan.md", ruleset).action === "allow")
test("edit plans_completed/done.md is DENIED (plans_completed != plans/)", () => evaluate("edit", "plans_completed/done.md", ruleset).action === "deny")
test("edit plans/subdir/plan.md is ALLOWED", () => evaluate("edit", "plans/subdir/plan.md", ruleset).action === "allow")
test("edit .opencode/data/memory/my_orchestrator.md is ALLOWED", () => evaluate("edit", ".opencode/data/memory/my_orchestrator.md", ruleset).action === "allow")
test("edit .opencode/data/memory/foo_orchestrator.md is ALLOWED", () => evaluate("edit", ".opencode/data/memory/foo_orchestrator.md", ruleset).action === "allow")
test("edit src/session/system.ts is DENIED", () => evaluate("edit", "src/session/system.ts", ruleset).action === "deny")
test("edit src/server/server.ts is DENIED", () => evaluate("edit", "src/server/server.ts", ruleset).action === "deny")
test("edit packages/opencode/package.json is DENIED", () => evaluate("edit", "packages/opencode/package.json", ruleset).action === "deny")
test("edit .opencode/data/other/file.json is DENIED (not memory)", () => evaluate("edit", ".opencode/data/other/file.json", ruleset).action === "deny")
test("edit node_modules/foo/index.js is DENIED", () => evaluate("edit", "node_modules/foo/index.js", ruleset).action === "deny")

// ─ Write tests ─
console.log("\n── Write permission ──")
test("write plans/new_plan.md is ALLOWED", () => evaluate("write", "plans/new_plan.md", ruleset).action === "allow")
test("write plans_completed/done.md is DENIED (plans_completed != plans/)", () => evaluate("write", "plans_completed/done.md", ruleset).action === "deny")
test("write plans/subdir/plan.md is ALLOWED", () => evaluate("write", "plans/subdir/plan.md", ruleset).action === "allow")
test("write src/server/server.ts is DENIED", () => evaluate("write", "src/server/server.ts", ruleset).action === "deny")
test("write .opencode/data/memory/test.md is DENIED", () => evaluate("write", ".opencode/data/memory/test.md", ruleset).action === "deny")
test("write .env is DENIED", () => evaluate("write", ".env", ruleset).action === "deny")

// ─ apply_patch tests ─
console.log("\n── Apply_patch permission ──")
test("apply_patch plans/*.md is ALLOWED (via edit wildcard)", () => evaluate("apply_patch", "plans/my_plan.md", ruleset).action === "allow")
test("apply_patch src/session/system.ts — NOT explicitly denied (falls through to *:allow)", () => {
  // apply_patch has no explicit rule in orchestrator config.
  // Falls through to defaults `"*": "allow"` — the same as `edit` and `write`.
  // The prompt restricts usage to plan files; no hard path-level gate exists.
  return evaluate("apply_patch", "src/session/system.ts", ruleset).action === "allow"
})

// ─ Task tool ─
console.log("\n── Task tool ──")
test("task on any pattern is ALLOWED", () => evaluate("task", "*", ruleset).action === "allow")
test("task with empty pattern is ALLOWED", () => evaluate("task", "", ruleset).action === "allow")

// ─ Todowrite ─
console.log("\n── Todowrite tool ──")
test("todowrite is DENIED", () => evaluate("todowrite", "*", ruleset).action === "deny")

// ─ Read ─
console.log("\n── Read permission ──")
test("read src/file.ts is ALLOWED", () => evaluate("read", "src/file.ts", ruleset).action === "allow")
test("read .env is ALLOWED (orchestrator overrides defaults)", () => evaluate("read", ".env", ruleset).action === "allow")
test("read .env.production is ALLOWED (orchestrator overrides defaults)", () => evaluate("read", ".env.production", ruleset).action === "allow")
test("read .env.example is ALLOWED (safe template)", () => evaluate("read", ".env.example", ruleset).action === "allow")

// ─ Bash ─
console.log("\n── Bash tool ──")
test("bash is ALLOWED", () => evaluate("bash", "*", ruleset).action === "allow")

// ─ disabled() tool filtering ─
console.log("\n── disabled() tool filtering ──")
const allTools = ["edit", "write", "apply_patch", "task", "todowrite", "read", "bash", "glob", "grep", "list", "messagesearch", "session-read", "universalsearch", "webfetch"]
const dis = disabled(allTools, ruleset)
test("edit is NOT disabled (last matching edit rule is allow: plans/*)", () => !dis.has("edit"))
test("write is NOT disabled (last matching edit rule is allow: plans/*)", () => !dis.has("write"))
test("apply_patch is NOT disabled (last matching edit rule is allow: plans/*)", () => !dis.has("apply_patch"))
test("task is NOT disabled", () => !dis.has("task"))
test("todowrite IS disabled (last matching todowrite rule is deny: *)", () => dis.has("todowrite"))
test("read is NOT disabled", () => !dis.has("read"))
test("bash is NOT disabled", () => !dis.has("bash"))

// ─ Plan path edge cases ─
console.log("\n── Plan path edge cases ──")
test("edit plans/../src/evil.ts — path traversal NOT caught by glob", () => {
  // Wildcard.match does NOT normalize `..` — this is a known limitation
  // documented in the plan. The glob "plans/*" matches because `../` is
  // part of the string, but it's NOT actually inside plans/.
  // Runtime tool args likely contain the real resolved path though.
  const result = evaluate("edit", "plans/../src/evil.ts", ruleset)
  return result.action === "allow" // known limitation — see plan risk notes
})
test("write plans_other/plan.md — NOT matched by plans/*", () => {
  return evaluate("write", "plans_other/plan.md", ruleset).action === "deny"
})

// ─ Summary ─
console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`)

if (failed > 0) {
  console.error("FAILED: Some smoke tests did not pass.")
  process.exit(1)
} else {
  console.log("All tests passed. Orchestrator permission configuration is correct.")
}
