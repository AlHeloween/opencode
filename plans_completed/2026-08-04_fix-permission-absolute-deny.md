# Fix: planexit + codegraph Denied — Permission.evaluate Absolute Deny Bug

## Root Cause

`src/permission/evaluate.ts:13-31` — first-ruleset deny rules are **absolute** and
cannot be overridden by subsequent rulesets. The comment explains:

> "When multiple rulesets are provided (agent + user config), agent denies are absolute
> — user config cannot override them."

But this also prevents agent-specific configs from overriding defaults!

### Example: planexit

```
defaults:              plan_exit: "deny"    ← ABSOLUTE deny
plan agent config:     plan_exit: "allow"   ← IGNORED (different ruleset)
```

`evaluate()` finds `plan_exit: "deny"` in defaults (first ruleset). Checks for
override in same ruleset — none. Returns **deny**. Plan agent's `"allow"` in
third ruleset is never consulted.

### Affected tools (all four mode transitions):

| Tool | Defaults | Agent override | Result |
|------|----------|----------------|--------|
| `plan_enter` | deny | build: allow | **DENIED** ❌ |
| `plan_exit` | deny | plan: allow | **DENIED** ❌ |
| `reasoning_enter` | deny | build: allow | **DENIED** ❌ |
| `reasoning_exit` | deny | reasoning: allow | **DENIED** ❌ |

All mode-transition tools are broken by this algorithm!

### codegraph (separate issue — requires rebuild verification)

Explore agent: `"codegraph*": "allow"` (our fix). Defaults don't deny. Should work.
If still denied after rebuild, there's another mechanism blocking MCP tools.

## Fix

Remove all four mode-transition denies from `defaults` and add explicit denies
to agents that should NOT have them:

### 1. `agent.ts:108-111` — remove from defaults

```diff
-          question: "deny",
-          plan_enter: "deny",
-          plan_exit: "deny",
-          reasoning_enter: "deny",
-          reasoning_exit: "deny",
+          question: "deny",
```

### 2. `agent.ts:125-141` — add to build agent

Build agent already explicitly allows `plan_enter` and `reasoning_enter`.
No need to add explicit denies (build agent's `"*": "allow"` from defaults
would allow them, but we DON'T want that — but build agent's config
already overrides with specific allows, and without defaults denies,
those allows work correctly now).

Wait — build agent has `plan_enter: "allow"` and `reasoning_enter: "allow"`.
With defaults denies removed, `"*": "allow"` from defaults would make
`plan_exit` and `reasoning_exit` ALLOWED for build agent. Need explicit denies:

```diff
  build: {
    permission: Permission.merge(
      defaults,
      Permission.fromConfig({
        question: "allow",
        plan_enter: "allow",
        reasoning_enter: "allow",
+       plan_exit: "deny",
+       reasoning_exit: "deny",
        "ai-call": "allow",
      }),
      user,
    ),
```

### 3. Reasoning agent already has `"*": "deny"` — safe

### 4. Plan agent already has `plan_exit: "allow"` — will now work

## Files

| File | Change |
|------|--------|
| `src/agent/agent.ts:108-111` | Remove plan_enter/plan_exit/reasoning_enter/reasoning_exit from defaults |
| `src/agent/agent.ts:132-133` | Add plan_exit: deny, reasoning_exit: deny to build agent |

## Smoke Tests

1. Rebuild
2. Plan agent: call `planexit` → "Switch to build?" dialog appears → Yes → build mode
3. Build agent: `planexit` should NOT be callable (agent permission denies)
4. Explore agent: call `codegraphcodegraphsearch` → works
