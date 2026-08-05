# Fix: Permission.evaluate Absolute Deny — Cross-Ruleset Override

## Root Cause

`src/permission/evaluate.ts:13-31` — when first ruleset has a deny, it checks for
override ONLY within the same ruleset. Agent-specific configs in later rulesets
are invisible:

```tsx
// Only checks rulesets[0] (defaults), ignores rulesets[1] (user) and rulesets[2] (agent config)
const hasSpecificOverride = rulesets[0].slice(denyIdx + 1).some(
    (rule) => rule.permission === permission,
)
if (!hasSpecificOverride) return agentDeny  // ← ABSOLUTE deny
```

`Permission.merge(defaults, user, agentConfig)` creates 3 rulesets:
```
[defaults, user, agentConfig]
```

Agent-specific overrides (e.g. `plan_exit: "allow"` for plan agent) land in
ruleset[2], invisible to the check.

## Fix (1 file, 4 lines)

**`src/permission/evaluate.ts:26-29`** — extend override check to all subsequent rulesets:

```diff
       const denyIdx = rulesets[0].lastIndexOf(agentDeny)
       const hasSpecificOverride = rulesets[0].slice(denyIdx + 1).some(
         (rule) => rule.permission === permission,
-      )
+      ) || rulesets.slice(1).some(ruleset =>
+        ruleset.some(
+          (rule) => rule.permission === permission,
+        ))
       if (!hasSpecificOverride) return agentDeny
```

### Why this is safe

The override check uses **exact** permission match (`rule.permission === permission`),
not wildcard. A user's `"*": "allow"` does NOT count as override for `plan_exit`.
Only an explicit `plan_exit: "allow"` does. This preserves the security property:
user config cannot silently override agent denies with broad wildcards.

### What this fixes

| Tool | Before | After |
|------|--------|-------|
| `plan_exit` (plan agent) | defaults deny → DENIED | planConfig allow found → last-match-wins → ALLOWED |
| `plan_enter` (build agent) | defaults deny → DENIED | buildConfig allow found → last-match-wins → ALLOWED |
| `reasoning_enter` (build) | defaults deny → DENIED | buildConfig allow found → last-match-wins → ALLOWED |
| `reasoning_exit` (reasoning) | defaults deny → DENIED | reasoningConfig allow found → last-match-wins → ALLOWED |

### Existing same-ruleset override (explore agent) still works

```
exploreConfig: "*": "deny" + "codegraph*": "allow"
→ rulesets[0].slice(denyIdx+1) finds "codegraph*": "allow" → override found → OK
```

## Files

| File | Lines | Change |
|------|-------|--------|
| `src/permission/evaluate.ts` | 26-29 | Add `|| rulesets.slice(1).some(...)` |

## Smoke Tests

1. Plan agent: call `planexit` → "Switch to build?" → Yes → build mode
2. Build agent: call `planenter` → "Switch to plan?" → Yes → plan mode
3. Explore sub-agent: call `codegraphcodegraphsearch` → works
4. User config `"*": "allow"` does NOT override agent `plan_exit: "deny"` (security property preserved)
