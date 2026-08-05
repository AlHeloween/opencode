# Fix: codegraph wildcard permission denied for explore/researcher agents

## Problem

The explore and researcher agents have `"codegraph*": "allow"` in their permission
config (agent.ts:275, 324), but the `codegraph` tool is denied at runtime with:

```
Permission denied: tool "codegraph" is not authorized in explore mode.
```

Confirmed by launching explore agent with a codegraph query — received Tool denied.

## Architecture: Permission Evaluation Flow

```
tools.ts:denied("codegraph")
│
├─ Permission.evaluate("codegraph", "*", input.agent.permission)  ← single ruleset
│   └─ evaluate.ts: rulesets.length === 1 → skip agentDeny guard
│   └─ findLast matching rule → should be "codegraph*": "allow" → NOT denied
│
├─ Permission.evaluate("codegraph", "*", input.session.permission ?? [])  ← session rules
│   └─ session has no codegraph deny → NOT denied
│
└─ returns false → tool should execute
│
▼
codegraph.ts:ctx.ask()  ← INSIDE the tool
│
├─ Permission.merge(input.session.permission ?? [], input.agent.permission)  ← 2 rulesets!
│
└─ evaluate.ts: rulesets.length > 1 → agentDeny guard FIRES
    │
    ├─ agentDeny = rulesets[0].findLast(deny + match)
    │   └─ finds "*": "deny" in agent permissions
    │
    ├─ hasSpecificOverride = rulesets[0].slice(denyIdx+1)
    │       .some(rule => rule.permission === permission)   ← BUG HERE
    │
    │   For "codegraph":
    │     rule.permission = "codegraph*"  (from config "codegraph*": "allow")
    │     permission = "codegraph"        (what we're checking)
    │     "codegraph*" === "codegraph"    → FALSE ❌
    │
    │   For "grep":
    │     rule.permission = "grep"        (from config grep: "allow")
    │     permission = "grep"
    │     "grep" === "grep"               → TRUE ✅
    │
    └─ !hasSpecificOverride → return agentDeny → TOOL DENIED
```

## Root Cause

**File:** `packages/opencode/src/permission/evaluate.ts:26-27`

The `hasSpecificOverride` check uses **exact string comparison** (`===`) instead of
**wildcard matching** (`Wildcard.match`):

```typescript
// Current (buggy):
const hasSpecificOverride = rulesets[0].slice(denyIdx + 1).some(
  (rule) => rule.permission === permission,     // "codegraph*" !== "codegraph" → false
)

// Fix:
const hasSpecificOverride = rulesets[0].slice(denyIdx + 1).some(
  (rule) => Wildcard.match(permission, rule.permission),  // "codegraph" matches "codegraph*" → true
)
```

### Why `grep` works but `codegraph*` doesn't

| Config key | Generated rule.permission | `=== "grep"` | `=== "codegraph"` |
|------------|--------------------------|--------------|-------------------|
| `grep: "allow"` | `"grep"` | ✅ true | — |
| `"codegraph*": "allow"` | `"codegraph*"` | — | ❌ false |

The wildcard `*` in the permission key is a **glob pattern** for `Wildcard.match`,
but `===` treats it as a literal string.

### When this code path is hit

The `hasSpecificOverride` guard runs when `rulesets.length > 1` (multiple rulesets
merged). This occurs in:

1. **`Permission.ask()`** — merges `session.permission + agent.permission` (2 rulesets)
2. **`codegraph.ts:ctx.ask()`** — calls `Permission.merge(input.session.permission ?? [],
   input.agent.permission)` → 2 rulesets → triggers the buggy path
3. **`tools.ts:denied()`** — passes single ruleset (agent.permission only), so the
   guard is SKIPPED here, but the tool's own `ctx.ask()` catches it

The bug is specifically in the multi-ruleset path of `evaluate()`.

## Fix

**File:** `packages/opencode/src/permission/evaluate.ts`

**Change:** Lines 26-27 and 29-30 — replace `===` with `Wildcard.match`:

```diff
-        (rule) => rule.permission === permission,
+        (rule) => Wildcard.match(permission, rule.permission),
```

```diff
-        ruleset.some(
-          (rule) => rule.permission === permission,
-        ))
+        ruleset.some(
+          (rule) => Wildcard.match(permission, rule.permission),
+        ))
```

## Impact

- **Explore agent**: gains access to `codegraph` tool (was denied)
- **Researcher agent**: gains access to `codegraph` tool (was denied)
- **All agents with wildcard permission keys**: e.g. `"codegraph*": "allow"` now
  correctly overrides `"*": "deny"` in multi-ruleset evaluation
- **No regression for exact keys**: `Wildcard.match("grep", "grep")` is true,
  so existing `grep: "allow"` style configs continue to work
- **Plan agent edit scoping**: unaffected — uses `perm === "edit"` check in
  `tools.ts:denied()` (line 89-93), not the evaluate.ts guard

## Tests to Add

**File:** `packages/opencode/test/agent/agent.test.ts`

Add test for explore agent's codegraph permission:

```typescript
test("explore agent allows codegraph via wildcard permission key", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      expect(explore).toBeDefined()
      // Single-ruleset evaluate (tools.ts:denied path)
      expect(evalPerm(explore, "codegraph")).toBe("allow")
      // Multi-ruleset evaluate (ctx.ask path with merged session+agent)
      expect(
        Permission.evaluate("codegraph", "*", [], explore!.permission).action
      ).toBe("allow")
    },
  })
})
```

**File:** `packages/opencode/test/permission/next.test.ts`

Add test for wildcard permission key override in multi-ruleset:

```typescript
test("evaluate - wildcard permission key overrides deny in multi-ruleset", () => {
  const agentRuleset: Permission.Ruleset = [
    { permission: "*", pattern: "*", action: "allow" },
    { permission: "*", pattern: "*", action: "deny" },
    { permission: "codegraph*", pattern: "*", action: "allow" },
    { permission: "grep", pattern: "*", action: "allow" },
  ]
  const sessionRuleset: Permission.Ruleset = []

  // Multi-ruleset: codegraph should be allowed via wildcard key
  const result = Permission.evaluate("codegraph", "*", sessionRuleset, agentRuleset)
  expect(result.action).toBe("allow")

  // Exact key should also work
  const grepResult = Permission.evaluate("grep", "*", sessionRuleset, agentRuleset)
  expect(grepResult.action).toBe("allow")

  // Deny should still work for unmatched permissions
  const editResult = Permission.evaluate("edit", "*", sessionRuleset, agentRuleset)
  expect(editResult.action).toBe("deny")
})
```

## Verification Steps

1. Run `bun test test/permission/next.test.ts` — new wildcard key test passes
2. Run `bun test test/agent/agent.test.ts` — new explore codegraph test passes
3. Launch explore agent, call `codegraph` with query "agent permissions" → expect packed result
4. Launch explore agent, call `grep` with pattern "test" → expect results (no regression)
5. Verify plan agent can still edit files under `plans/` but not elsewhere

## Current Status

- ✅ **Source fix applied** — `evaluate.ts` uses `Wildcard.match` (confirmed via `git diff`)
- ✅ **Tests added** — agent.test.ts + next.test.ts
- ❌ **Runtime verification blocked** — explore agent still reports "Tool denied" because
  the running process hasn't picked up the TypeScript source changes. No compiled JS
  found in `packages/opencode` (grep for `Wildcard.match(permission` returns 0 JS files).
  The app runs TypeScript directly (via bun) but may cache or the current session
  has stale agent state. **A full restart of the app is needed.**

## Second Bug: planexit shows "build" mode but permissions remain "plan"

When `planexit` was called, the system indicated transition to build agent. However,
the session's tool permissions remained in plan mode (edit/write blocked outside
`plans/`). Only after manually toggling in TUI (plan → build → plan → build) did
the permissions correctly switch to build mode.

This is a separate bug in the mode transition path — the permission ruleset is not
updated atomically with the agent name display. Suspect: `planexit` publishes an
event that updates the display but the actual permission switching requires a
separate mechanism that wasn't triggered.

## Smoke Tests

- **S1:** explore agent calls `codegraph` → returns codegraph pack (not "Tool denied")
- **S2:** explore agent calls `grep` → returns results (no regression)
- **S3:** plan agent edits `plans/foo.md` → allowed; edits `src/foo.ts` → denied
