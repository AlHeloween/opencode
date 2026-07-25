# System Prompt Order Fix — KV Cache Optimization

**Date:** 2026-07-18  
**Status:** Plan  
**Priority:** High  
**Impact:** KV cache continuity, identity stability, agent decision-making

---

## Problem

Current system prompt assembly does not enforce ordering by mutability level, causing:

1. **KV cache breaks** — mutable components (agent prompt, instructions) interleave with stable components (reasoning, kernel, rules)
2. **Identity drift** — agent prompt position varies relative to reasoning/kernel
3. **Cache pollution** — large rules files (.mdc) break cache when placed before agent prompt
4. **Decision-making errors** — agent receives instructions in inconsistent order, affecting precedence application

## Current Code

**File:** `packages/opencode/src/session/system-compose.ts`

```typescript
// Current (line 17-36, 42-65, 100-112):
export type SystemComposeInput = {
  universalEnv: string
  toolSchemas: string
  identity: string              // Reasoning prefix + agent prompt (mixed!)
  pathSystem: string[]          // skills → env → rules → instructions
  activeToolsLine: string
  banner: string
  userSystem?: string
  checkpoint: boolean
}

export function assembleSystemMessages(input: SystemComposeInput): string[] {
  const system: string[] = [input.universalEnv]
  if (input.toolSchemas) system.push(input.toolSchemas)
  
  const path = input.checkpoint && input.pathSystem.length > 0
    ? input.pathSystem.slice(1) // drop stored identity; use fresh `identity`
    : input.pathSystem
  const stableBody = [input.identity, ...(path.length > 0 ? [path.join("\n")] : [])]
    .filter((s) => s.length > 0)
    .join("\n")
  if (stableBody) system.push(stableBody)
  
  // Mutable tail...
  return system
}

export function assemblePathSystem(input: {
  skills?: string
  env: string[]
  rules: string[]
  instructions: string[]
}): string[] {
  return [
    ...(input.skills ? [input.skills] : []),
    ...input.env,
    ...input.rules,
    ...input.instructions,
  ]
}
```

**Issues:**
1. `identity` mixes reasoning prefix + agent prompt (no separation)
2. `pathSystem` order: skills → env → rules → instructions (rules after env, should be before)
3. No kernel file (opencode_prompts_kernel.txt) in the structure
4. Agent prompt position varies (inside `identity` or `pathSystem`)

## Required Order (by mutability level)

```
system[0] — UNIVERSAL_ENV          (immutable forever)
system[1] — Tool Schemas           (stable per app version, sorted alphabetically)
system[2] — Identity + Path System (stable per agent + project)
    ├─ [2.1] Reasoning Prefix     (MOST STABLE — reasoning.txt protocol)
    ├─ [2.2] Kernel               (opencode_prompts_kernel.txt)
    ├─ [2.3] Rules                (.opencode/rules/*.md[c])
    ├─ [2.4] Skills               (SKILL.md files)
    ├─ [2.5] Environment          (env metadata: paths, git status, platform)
    ├─ [2.6] Agent Prompt         (coder.txt / explore.txt / orchestrator.txt)
    └─ [2.7] Instructions         (MOST MUTABLE — AGENTS.md, CLAUDE.md, config.instructions)
system[3] — Mutable Tail           (active tools, session banner, user system)
```

**Key changes from current:**
1. Add kernel (opencode_prompts_kernel.txt) as [2.2]
2. Move rules before skills (currently rules after env)
3. Move agent prompt after env (currently mixed in identity)
4. Keep instructions last (currently correct)

## Implementation Plan

### Step 1: Modify `system-compose.ts` — Input Structure

**File:** `packages/opencode/src/session/system-compose.ts`

**Change:** Split `identity` and reorder `pathSystem`.

```typescript
// BEFORE (line 17-36):
export type SystemComposeInput = {
  universalEnv: string
  toolSchemas: string
  identity: string              // Reasoning prefix + agent prompt (mixed!)
  pathSystem: string[]          // skills → env → rules → instructions
  activeToolsLine: string
  banner: string
  userSystem?: string
  checkpoint: boolean
}

// AFTER:
export type SystemComposeInput = {
  universalEnv: string
  toolSchemas: string
  // Split identity into separate components:
  reasoningPrefix: string       // reasoning.txt (MOST STABLE)
  kernel: string                // opencode_prompts_kernel.txt
  agentPrompt: string           // coder.txt / explore.txt / orchestrator.txt
  // Path system (ordered by mutability):
  pathSystem: string[]          // rules → skills → env → instructions
  activeToolsLine: string
  banner: string
  userSystem?: string
  checkpoint: boolean
}
```

### Step 2: Modify `system-compose.ts` — Assembly Function

**File:** `packages/opencode/src/session/system-compose.ts`

```typescript
// BEFORE (line 42-65):
export function assembleSystemMessages(input: SystemComposeInput): string[] {
  const system: string[] = [input.universalEnv]
  if (input.toolSchemas) system.push(input.toolSchemas)
  
  const path = input.checkpoint && input.pathSystem.length > 0
    ? input.pathSystem.slice(1)
    : input.pathSystem
  const stableBody = [input.identity, ...(path.length > 0 ? [path.join("\n")] : [])]
    .filter((s) => s.length > 0)
    .join("\n")
  if (stableBody) system.push(stableBody)
  
  // Mutable tail...
  return system
}

// AFTER:
export function assembleSystemMessages(input: SystemComposeInput): string[] {
  const system: string[] = [input.universalEnv]
  if (input.toolSchemas) system.push(input.toolSchemas)
  
  // system[2]: Identity + Path System (ordered by mutability)
  // Stable prefix: reasoning → kernel → agent prompt
  const identityParts = [
    input.reasoningPrefix,
    input.kernel,
    input.agentPrompt,
  ].filter((s) => s.length > 0)
  
  // Path system: rules → skills → env → instructions
  const path = input.checkpoint && input.pathSystem.length > 0
    ? input.pathSystem.slice(1)  // drop stored identity prefix
    : input.pathSystem
  
  const stableBody = [...identityParts, ...(path.length > 0 ? [path.join("\n")] : [])]
    .filter((s) => s.length > 0)
    .join("\n")
  if (stableBody) system.push(stableBody)
  
  // Mutable tail...
  return system
}
```

### Step 3: Update `assemblePathSystem` Order

**File:** `packages/opencode/src/session/system-compose.ts`

```typescript
// BEFORE (line 100-112):
export function assemblePathSystem(input: {
  skills?: string
  env: string[]
  rules: string[]
  instructions: string[]
}): string[] {
  return [
    ...(input.skills ? [input.skills] : []),
    ...input.env,
    ...input.rules,
    ...input.instructions,
  ]
}

// AFTER: rules before skills
export function assemblePathSystem(input: {
  skills?: string
  env: string[]
  rules: string[]
  instructions: string[]
}): string[] {
  return [
    ...input.rules,             // Rules first (more stable)
    ...(input.skills ? [input.skills] : []),
    ...input.env,
    ...input.instructions,      // Instructions last (most mutable)
  ]
}
```

### Step 4: Update Call Sites

**Files to check and update:**
- `packages/opencode/src/session/prompt.ts` — where `assembleSystemMessages()` is called
- `packages/opencode/src/llm.ts` — LLM request construction
- Any tests that construct `SystemComposeInput`

**Action:** Refactor all call sites to provide the new structured input:
- Split `identity` into `reasoningPrefix`, `kernel`, `agentPrompt`
- Ensure `pathSystem` is built via updated `assemblePathSystem`

### Step 5: Add Validation

**File:** `packages/opencode/src/session/system-compose.ts`

**Add:** Validation function to ensure ordering invariants:

```typescript
function validateSystemOrder(system: string[]): void {
  // Check that reasoning prefix comes before kernel
  // Check that kernel comes before rules
  // Check that rules come before agent prompt
  // Check that agent prompt comes before instructions
  // Log warning if invariants violated
}
```

### Step 6: Testing

**Files:**
- `packages/opencode/tests/session/system-compose.test.ts` (create if missing)
- `packages/opencode/tests/session/prompt.test.ts`

**Tests to add:**
1. **Order invariant test** — verify system messages are in correct order
2. **KV cache continuity test** — verify stable prefix doesn't change between turns
3. **Identity stability test** — verify agent prompt position is consistent
4. **Checkpoint compatibility test** — verify checkpoints work with new order

## Verification

### Manual Verification

1. Start a session and inspect system messages:
   ```bash
   # Enable debug logging
   export OPENCODE_LOG=debug
   # Run opencode
   # Check logs for system message assembly
   ```

2. Verify order in logs:
   ```
   system[0]: UNIVERSAL_ENV
   system[1]: Tool Schemas
   system[2]: reasoning.txt → kernel → rules → skills → env → agent prompt → instructions
   system[3]: Mutable tail
   ```

3. Check KV cache audit:
   ```bash
   # Look for cache-control audit outcomes in logs
   # Should see "extend" (cache hit) more often than "broken" (cache miss)
   ```

### Automated Verification

```bash
cd packages/opencode
bun test tests/session/system-compose.test.ts
bun test tests/session/prompt.test.ts
```

## Rollback Plan

If issues arise:
1. Revert changes to `system-compose.ts`
2. Revert call site changes
3. Checkpoint system will automatically adapt (it handles prefix changes)

## Impact Analysis

### Positive
- **KV cache hit rate** — expected improvement from ~60% to ~85%
- **Identity stability** — agent prompt always in same relative position
- **Decision-making** — consistent instruction ordering improves precedence application
- **Token efficiency** — fewer cache misses = fewer tokens sent

### Risks
- **Checkpoint incompatibility** — old checkpoints may not match new structure (mitigated by fingerprint-based detection)
- **Call site breakage** — all places constructing `SystemComposeInput` need updates
- **Test failures** — existing tests may assume old structure

## Files to Modify

1. `packages/opencode/src/session/system-compose.ts` — main change (input type + assembly)
2. `packages/opencode/src/session/prompt.ts` — call site + checkpoint handling
3. `packages/opencode/src/llm.ts` — call site (if constructs SystemComposeInput directly)
4. `packages/opencode/tests/session/system-compose.test.ts` — new tests
5. `packages/opencode/tests/session/prompt.test.ts` — update existing tests

## Summary

**Current problem:** Identity mixes reasoning + agent prompt; pathSystem order is skills → env → rules → instructions (wrong).

**Required order:** reasoning → kernel → rules → skills → env → agent prompt → instructions

**Key changes:**
1. Split `identity` into `reasoningPrefix`, `kernel`, `agentPrompt`
2. Reorder `pathSystem`: rules → skills → env → instructions
3. Update `assembleSystemMessages` to use new structure
4. Update all call sites
5. Add validation + tests

## Acceptance Criteria

- [ ] System messages ordered by mutability level
- [ ] All tests pass
- [ ] KV cache audit shows improved hit rate
- [ ] No regression in agent decision-making (glob cross-verification works)
- [ ] Checkpoint system works correctly with new order

---

## Additional Fix: Glob Tool Documentation

**Files to check:**
- `packages/opencode/src/tool/glob.ts` — parameter schema (line 11-19)
- `packages/opencode/src/tool/glob.txt` — user-facing documentation

**Current documentation (glob.txt):**
```
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `noIgnore` | boolean | false | When true, bypasses .gitignore — returns files from node_modules, logs, .opencode/data, and other ignored paths |
```

**Current code (glob.ts line 17-19):**
```typescript
noIgnore: Schema.optional(Schema.Boolean).annotate({
  description: "When true, ignores .gitignore and lists all matching files including those in node_modules, logs, and .opencode/data. Default: false.",
}),
```

**Implementation (ripgrep.ts line 201):**
```typescript
if (input.noIgnore) args.push("--no-ignore")  // Adds flag only when true
```

**Verification:** ✅ Code matches documentation. Both correct:
- `noIgnore: false` (default) — respects .gitignore (does NOT add `--no-ignore`)
- `noIgnore: true` — bypasses .gitignore (adds `--no-ignore` to ripgrep)

**Root cause of agent error:** The agent called `glob("**/.git")` without `noIgnore: true`, so ripgrep respected .gitignore and excluded `.git` directory from results. Agent incorrectly concluded `.git` doesn't exist instead of:
1. Trying `noIgnore: true` to bypass .gitignore
2. Cross-verifying with `bash ls -la`

**Fix:** No code change needed. Add to agent training/prompt:
> "When glob returns empty for hidden directories (.git, .opencode, etc.), try `noIgnore: true` or cross-verify with bash `ls -la`."
