# fixture — an UNLINKED plan: its SV names no goal (32 zeros)

<!-- intention: fixture -> fixture -->

```yaml
Keywords: fixture-nolink 1.0
Semantic dominant: a plan that names no master-plan goal.
md5: 33333333333333333333333333333333
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```

## Tasks

- [ ] **S1** — tighten the parser in `packages/opencode/src/x/parser.ts:42`. Oracle: `bun test test/x/parser.test.ts` → 0 fail.

## Smoke Tests

- `bun test test/x/parser.test.ts` — PASS today.
