# Canonical tool identity with guarded legacy policy

## Context / goal

Make each built-in runtime tool ID lower-case ASCII alphanumeric, matching the
provider-visible schema and persisted tool-call form. Keep existing permission,
plugin, and configuration policy keys as compatibility-only identities, so a
canonicalization cannot weaken a guardrail or silently reinterpret old config.

## Prior art

reuse: N/A — this is a local compatibility boundary. Reuse the existing
`Tool.canonicalName`, `SessionTools.resolveToolName`, and provider alias repair;
they already prove that separator aliases must be accepted only at input edges.

## Implementation

- [x] Add an explicit `policy` identity to tool definitions, separate from the
      canonical runtime `id`.
- [x] Convert all built-in runtime IDs to `^[a-z0-9]+$`; retain their former
      IDs as policy identities for ACLs, plugin callbacks, and legacy config.
- [x] Carry the policy identity through registry, session tool resolution,
      filtered tool sets, and GitLab pre-approval without exposing it to the
      provider.
- [x] Preserve policy semantics in processor evidence/mutation handling and in
      the direct debug-agent execution path; canonical IDs must not bypass an
      edit denial or lose the `sessionread` Exact-evidence upgrade.
- [x] Keep plugin `tool.definition` and execute callbacks on the compatibility
      policy identity; separator-bearing plugin IDs remain valid input but are
      canonicalized only for the provider schema.
- [x] Preserve canonical provider names and persisted-message alias repair;
      reject canonical collisions deterministically.
- [x] Correct the incomplete `applypatch` canonical error assertion and add
      regression coverage for canonical built-ins and legacy-policy enforcement.
- [x] Replace the silent Fossil probe catch with debug logging.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---|---|---|
| 1 | `bun typecheck` (`packages/opencode`) | pass | pass (0 exit, 24.7s) |
| 2 | `bun test test/session/tools.test.ts` (`packages/opencode`) | pass | 1 pass, 0 fail |
| 3 | `bun test test/session/llm.test.ts` (`packages/opencode`) | canonical alias tests pass | 16 pass; 3 provider-payload tests exceed their 5s per-test timeout |
| 4 | `bun test test/tool/applypatch.test.ts` (`packages/opencode`) | canonical error assertions pass | 24 pass, 3 fail; one missed legacy assertion at line 344, plus diff/BOM failures |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---|---|
| 1 | `bun typecheck` (`packages/opencode`) | exit 0 |
| 2 | `bun test test/session/tools.test.ts` (`packages/opencode`) | canonical provider names and legacy policy guardrails pass |
| 3 | `bun test --test-name-pattern "tool call repair|legacy user tool disables|canonical" test/session/llm.test.ts` (`packages/opencode`) | alias repair and policy compatibility pass |
| 4 | `bun test --test-name-pattern "invalid patch format|empty patch|target file is missing" test/tool/applypatch.test.ts` (`packages/opencode`) | canonical error contract passes |
| 5 | focused processor/debug-agent identity tests (`packages/opencode`) | canonical IDs retain mutation, Exact-evidence, and direct-ACL behavior; plugin callback routing is code-audited separately |
| 6 | `git diff --check` (repository root) | no whitespace errors |

### Actual post-implementation results [Exact]

- `bun typecheck` exited 0.
- Focused TypeScript suite: 23 pass, 0 fail — Tool.define invariant,
  canonical provider schema, policy ACL, processor semantics, constitution,
  and direct debug-agent resolution.
- Registry invariant: 1 pass, 0 fail — all built-in IDs match
  `^[a-z0-9]+$`.
- LLM alias/policy suite: 2 pass, 0 fail. `applypatch` error suite: 3 pass,
  0 fail.
- Plugin callback routing is verified by the final code audit: registry and
  session callbacks use `tool.policy`. There is no direct separator-bearing
  plugin callback integration test yet; this completed record does not claim
  one.
- `git diff --check` exited 0.

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-implementation smoke passed before completion
