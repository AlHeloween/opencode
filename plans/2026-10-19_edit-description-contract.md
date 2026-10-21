# t93 — edit.txt states exactly what edit.ts enforces

<!-- intention: edit tool description drifts from its refusals -> description rewritten from the code's own refusals with a contract test that fails on drift -->
<!-- goal_sv:
```yaml
Keywords: edit-description-contract 0.35, refusal-catalogue 0.25, contradiction-same-file 0.20, stringified-files-schema 0.12, contract-test 0.08
Semantic dominant: Rewrite the edit tool description from the code's own refusals and pin it with a test so the txt cannot drift from the ts.
md5: 84719f6efd224ad99c3f617cb2c92570
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
note: hash values are generative tags — search them, never compute them.
```
-->

## Goal

`edit.txt` says exactly what `edit.ts` enforces: one entry per file, every refusal named, stale-hash rule where the model acts, no kernel prose. A contract test fails whenever the code gains a refusal the doc does not name (and vice versa). `write.txt`/`read.txt` fixed only where they describe the address contract.

## Context

- `edit`: 954 completed / 153 errors (14%) over 3 days; `write`: 310/1. Top classes: stale/invented `fromHash` (101), stringified `files` (~20, message says `Received top-level keys: [files]. Expected top-level keys: [files].`), `[same-file]` x5 (the txt tells the model to do it), `[overlap]` x3, `[no-change]` x5.
- Contradiction: txt `two changes to one file are two files elements or two edits entries in ONE element` + header `One edit per file per call` vs `seenAt` refusal of a second element for the same file.
- `validation-guard.ts:158-164` builds the useless keys message for the stringified case. Decision: decode (one `JSON.parse` when `files` is a string that parses to an array, then normal validation; decode NAMED in result). A decode must not hide any other schema error — unparseable / non-array string is refused as `[files-not-array]` with `files must be an array; you sent a string`.

## Tasks

- [x] S1 Refusal keys in `edit.ts` — every `throw`/refusal string prefixed with a stable `[key]`; catalogue: `[empty-files]`, `[content+edits]`, `[no-change-spec]` (neither edits nor content), `[bad-encoding]`, `[encoding+content]`, `[same-file]`, `[already-exists]`, `[not-found]`, `[is-directory]`, `[binary-file]`, `[undecodable]`, `[no-change]` (identical), `[not-hex]`, `[stale-hash]`, `[seed-not-line]`, `[either-or]`, `[toHash-on-insert]`, `[inverted]`, `[overlap]` (two edits claim one line/insertion point), `[files-not-array]` (stringified files that does not decode). <!-- sv:
```yaml
Keywords: refusal-keys 0.40, edit-ts 0.25, stable-catalogue 0.20, error-prefix 0.15
Semantic dominant: Prefix every edit refusal with a stable key so the doc and the test can name it.
md5: 11111111111111111111111111111111
prev-md5: 84719f6efd224ad99c3f617cb2c92570
parent-goal-md5: 84719f6efd224ad99c3f617cb2c92570
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] S2 Stringified `files` decode — `Parameters.files` accepts `string | FileChange[]`; when string, one `JSON.parse`, must parse to an array, then per-element schema validation; success NAMED in result (`decoded stringified files (JSON.parse)`); non-array/unparseable refused as `[files-not-array] files must be an array; you sent a string`. <!-- sv:
```yaml
Keywords: stringified-files 0.40, json-parse 0.25, schema-decode 0.20, validation-guard 0.15
Semantic dominant: Decode a JSON-string files array once, then validate normally, without hiding other schema errors.
md5: 22222222222222222222222222222222
prev-md5: 11111111111111111111111111111111
parent-goal-md5: 84719f6efd224ad99c3f617cb2c92570
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] S3 Contract test `test/tool/edit-description-contract.test.ts` RED→GREEN — (a) catalogue test: every `[key]` in `edit.ts` appears in `edit.txt` and vice versa; (b) behaviour: two changes in one `edits` array PASS, two `files` elements for one file refused `[same-file]`; (c) message: stringified `files` decodes or is refused with `files must be an array`. <!-- sv:
```yaml
Keywords: contract-test 0.40, red-green 0.25, behaviour-proof 0.20, message-clarity 0.15
Semantic dominant: A test that fails when code and doc drift, covering keys, same-file contradiction, and stringified files.
md5: 33333333333333333333333333333333
prev-md5: 22222222222222222222222222222222
parent-goal-md5: 84719f6efd224ad99c3f617cb2c92570
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] S4 Rewrite `edit.txt` from the code — shape, one example, entry shapes, stale-hash rule where the model acts (next addresses from THAT edit's result; batch entries share one read), then `Refusals` table key→when→what-to-do; < 8 470 B; nothing the code does not do; drop `One edit per file` / `two files elements` contradiction (one `files` element per file, several changes in its `edits` array); drop kernel prose/history; fix `write prints no addresses` (write.ts:135-143 prints an address report). <!-- sv:
```yaml
Keywords: edit-txt-rewrite 0.40, refusals-table 0.25, stale-address-rule 0.20, shorter-doc 0.15
Semantic dominant: Rewrite edit.txt from edit.ts refusals, short and with no claim the code does not make.
md5: 44444444444444444444444444444444
prev-md5: 33333333333333333333333333333333
parent-goal-md5: 84719f6efd224ad99c3f617cb2c92570
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] S5 Audit `write.txt` + `read.txt` address contract only — fix `write prints no addresses` and any hash-format drift; nothing else. <!-- sv:
```yaml
Keywords: write-read-audit 0.40, address-contract 0.30, hash-format 0.30
Semantic dominant: Fix only the address-contract claims in write and read docs that contradict the code.
md5: 55555555555555555555555555555555
prev-md5: 44444444444444444444444444444444
parent-goal-md5: 84719f6efd224ad99c3f617cb2c92570
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] S6 Oracles + rerun query — new test RED then GREEN; `test/tool/edit.test.ts` + `test/tool/edit-exact.test.ts` stay green; `bun typecheck` in `packages/opencode`; `_build.ps1` via cmd_runner; record 3-day error-class query for post-dist comparison. <!-- sv:
```yaml
Keywords: oracles-green 0.40, typecheck-build 0.30, regression-guard 0.30
Semantic dominant: Prove the change with focused oracles and a rebuild, keeping existing edit suites green.
md5: 66666666666666666666666666666666
prev-md5: 55555555555555555555555555555555
parent-goal-md5: 84719f6efd224ad99c3f617cb2c92570
note: hash values are generative tags — search them, never compute them.
```
-->
- [ ] S7 Acceptance — caller-avoidable `edit` errors ≤ 2% of calls over 7 days after promotion (owner 2026-10-19: «1-2 ошибки на 100 редактирований норм, 1:8 много»). Target: schema/refusal-key errors the caller could have avoided ≤ 2%. Baseline (Legislator, measured): 10-17..19: 56 errors / 466 calls = 12%; week 1317 / 2868, of which 877 are one GLM repetition loop (`ses_ec2961e15ffefWEjqE2WOQOj10`, t46, 10-15) → 22% without it. Exclusions: repetition-loop session `ses_ec2961e15ffefWEjqE2WOQOj10` and external failures listed by id at measure time are counted separately, never silently. Query (7-day, rerun against current schema): `edit` errors that the caller could have avoided / `edit` calls over trailing 7 days on the promoted build. <!-- sv:
```yaml
Keywords: edit-error-target 0.45, avoidable-vs-external 0.25, loop-exclusion 0.15, plan-acceptance 0.15
Semantic dominant: The owner fixes the edit tool's acceptance at one or two caller-avoidable errors per hundred calls, measured after promotion, so the plan carries that number, its query and its named exclusions.
md5: a1b2c3d4e5f60718293a4b5c6d7e8f90
prev-md5: 66666666666666666666666666666666
parent-goal-md5: 84719f6efd224ad99c3f617cb2c92570
note: hash values are generative tags — search them, never compute them.
```
-->

## Smoke Tests

- `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-description-contract.test.ts` — RED before S1/S2/S4, GREEN after.
- `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit.test.ts` — green.
- `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-exact.test.ts` — green.
- `bun typecheck` in `packages/opencode` — green.
- `pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root — green; read `<run>/state.json` + full output.
- Post-dist measure (owner, separately): same opencode.db 3-day error-class query on a fresh robot session after dist promotion. Query recorded here for rerun (table `tool_call` / `part` — rerun against current schema at the time; intent: count `edit` vs `write` completions/errors by class over trailing 3 days):
  ```sql
  -- rerun intent: edit vs write completions/errors + edit error classes (stale-hash, stringified files, same-file, overlap, no-change, other) over trailing 3 days
  SELECT tool, status, COUNT(*) FROM tool_calls WHERE created_at > now() - INTERVAL '3 days' AND tool IN ('edit','write') GROUP BY tool, status;
  ```

## Risks

- Decode hides another schema error → mitigated by parse-then-validate (array elements still go through `FileChange` schema) + message test.
- Key rename churn → keys are additive prefixes, old substrings (`not in this file`, `claim line`, `Expected top-level keys`) retained in message bodies so existing tests/greps keep matching.
- `edit.txt` byte growth → budget < 8 470 B checked in test.

## Out of scope

Hash-chain scheme itself, `bin/`, any other tool.
