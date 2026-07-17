# Plan: git push --no-verify Prohibition + Bug-Before-Push Policy

**Date:** 2026-07-15
**Scope:** `AGENTS.md` only — add two governance rules

## Background

The project already forbids `--no-verify` on **commits** (`packages/docs/ai-tools/claude-code.mdx` line 71: "NEVER use --no-verify when committing"). However, `--no-verify` is still used on `git push` in `script/publish.ts` and `script/beta.ts` (CI/publish scripts, not developer workflows). No rule currently prohibits developers from using `git push --no-verify` during normal development.

Additionally, the existing Bug Policy states "There are NO pre-existing errors" but doesn't explicitly tie this to push operations — bugs must be fixed before pushing, regardless of origin.

## Changes to `AGENTS.md`

### 1. `forbidden_actions` — Add `git push --no-verify`

**Location:** After line 50 (`- Exposing secrets...`), before line 51.

```diff
 forbidden_actions:
 - Exposing secrets (API keys, tokens, passwords, private keys) to git
+- Using git push --no-verify (or any --no-verify variant with git push)
 - Using silent catch {} blocks
```

### 2. `Bug Policy` — Add bug-before-push rule

**Location:** After line 96 (`...each error in tsgo --noEmit output is a deliverable.`), before line 97.

Add a new paragraph:

```markdown
- **Bugs block push.** All bugs — regardless of who introduced them — must be fixed before `git push`. Pre-push hook failures (lint, typecheck, test) are bugs that must be resolved, not bypassed with `--no-verify`. There is no such thing as "someone else's bug" that can be skipped.
```

### 3. (Optional) `invariants` — Mirror the rule

**Location:** After line 47 (`- .opencode/plans/ is prohibited for plan storage`), before line 48.

```diff
 invariants:
 - Default branch is dev — never assume main exists
 - Every catch block must log (debug for expected, warn("bug:...") for unexpected)
 - Silent catch {} is always a bug
 - Plan documents must match actual code state
 - .opencode/plans/ is prohibited for plan storage
+- git push --no-verify is never permitted for developer pushes
```

### 4. (Optional) `acceptance_tests` — Verification criteria

**Location:** After line 62 (`- KV cache fingerprint stable across consecutive turns`).

```diff
 acceptance_tests:
 - git status confirms dev branch
 - No catch {} blocks without log statements
 - Plan files in plans/ match actual code state
 - KV cache fingerprint stable across consecutive turns
+- No git push --no-verify in development workflow
```

## What NOT Changed

- **`script/publish.ts` and `script/beta.ts`** — These are CI/publish automation scripts, not developer workflows. Left as-is.
- **`.github/workflows/generate.yml`** — CI pipeline, not developer workflow.
- **`packages/docs/ai-tools/claude-code.mdx`** — Already has a `--no-verify` rule for commits; no change needed.

## Verification

1. Read `AGENTS.md` and confirm the new lines appear in `forbidden_actions` and `Bug Policy`.
2. `grep "no-verify" AGENTS.md` returns only the new prohibition line (plus the existing claude-code.mdx rule).
3. Run `git diff AGENTS.md` to review the change before committing.
