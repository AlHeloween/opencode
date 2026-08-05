# SP-04: Documentation Drift + Tool-Call Defence Hardening

**Parent:** `plans/2026-08-05_master_critical_remediation.md`  
**Date:** 2026-08-05  
**Status:** Ready (can parallel SP-01; land after or with SP-01)  
**Severity:** MEDIUM  
**Risk:** Low  
**Depends on:** none hard; prefer after SP-01  
**Maps findings:** F5 docs drift, F7/F8 defence gaps

---

## 1. Goals

1. Align **live docs** with code after joboutput rename, anyrepair removal, fossil Phase 1/2 language.  
2. Reduce **false-positive** disguised tool-call retries.  
3. Optional: soft log when syntax grammar missing.  

**Non-goals:** rewrite historical `plans_completed/*`; implement fossil SP-02/03.

---

## 2. Prior art

| Item | Location |
|------|----------|
| joboutput tool | `packages/opencode/src/tool/joboutput.ts` |
| jobs API pattern | `packages/opencode/src/jobs/index.ts` |
| background jobs doc | `docs/background-jobs.md` |
| DSML / inline | `packages/opencode/src/util/dsml-normalizer.ts` |
| tool registry names | `packages/opencode/src/tool/registry.ts` + `Tool.canonicalName` |
| Tests | `test/util/dsml-normalizer.test.ts`, `test/jobs/jobs.test.ts` |

---

## 3. Implementation

### 3.1 Docs — `docs/background-jobs.md`

| Change | Detail |
|--------|--------|
| Path | `tool/job_output.ts` → `tool/joboutput.ts` |
| API | Document optional `pattern` (regex filter, full buffer, **does not** advance offset) |
| Tools table | job_output / jobwait / jobkill naming as exposed to model (`canonicalName`) |

Verify names against registry ids:

```
rg "job_output|joboutput|jobwait|jobkill" packages/opencode/src/tool
```

### 3.2 Docs — optional short note in AGENTS.md Fossil section

Only if inaccurate vs Phase 1+:

- undo fails loud on missing hash (not earliest)  
- Fossil is agent snapshot, not project VCS  

Keep short; link to `fossil-undo-redo-fix.md` for details.  
**[KV-CACHE RISK]** if any **runtime** system prompt text changes — SP-04 must **not** edit `prompt/*.txt` / kernel without explicit approval. AGENTS.md is host-local; product kernel stays host-agnostic.

### 3.3 Stamp fossil plan SMOKE

Update `plans/fossil-undo-redo-fix.md` § SMOKE.AFTER typecheck line after SP-01:

- Remove stale “20 errors in deepseek/transform” if fixed  
- Note write fixed by SP-01  

### 3.4 Disguised tool-call allowlist

**File:** `dsml-normalizer.ts` + `processor.ts`

Today: any `name{...}` matching `INLINE_TOOL_RE` triggers retry.

**Target:**

```ts
export function extractInlineToolCalls(
  text: string,
  knownToolIds?: ReadonlySet<string>,
): ExtractedToolCall[] | null
```

- If `knownToolIds` provided: only keep matches where `canonicalName(name)` ∈ set  
- Processor passes set from tool registry for current agent (names model sees)  
- If set empty/unavailable: fall back to current behavior **or** conservative default list of built-ins — **prefer registry** when available

**False positive test cases:**

- Prose: `Use config{ "a": 1 } in the file` → no extract  
- Real: `write{"filePath":"x","content":"y"}` → extract if write in set  

### 3.5 Syntax validator soft log (optional)

On grammar load failure: `log.debug` once per grammar key (module-level Set). No behavior change.

### 3.6 Out of scope

- Expanding grammar list to rust/go  
- Changing JSON repair pipeline  

---

## 4. Smoke Tests

### SMOKE.BEFORE

```
rg "job_output\.ts" docs/
bun test test/util/dsml-normalizer.test.ts
bun test test/jobs/jobs.test.ts
# Record Actual
```

### POST_IMPL

| # | Check | Pass |
|---|-------|------|
| D1 | `Test-Path packages/opencode/src/tool/joboutput.ts` | true |
| D2 | `rg "job_output\.ts" docs/` | no matches (or only historical quotes) |
| D3 | `bun test test/util/dsml-normalizer.test.ts` | pass |
| D4 | `bun test test/jobs/jobs.test.ts` | pass |
| D5 | `bun typecheck` | 0 |

---

## 5. Real tests

### 5.1 dsml-normalizer

| Test | Assert |
|------|--------|
| allowlist rejects unknown name | `extractInlineToolCalls("foo{...}", set("write"))` → null |
| allowlist accepts write | match write |
| normalizeDsmlTokens regression | existing cases still pass |
| detectDisguisedToolCalls with stop + allowlist | integration style unit |

### 5.2 jobs pattern (already exist — verify)

`test/jobs/jobs.test.ts` pattern/grep — must remain green; no code change required unless docs-only.

---

## 6. Checklist

- [ ] background-jobs.md paths + pattern  
- [ ] fossil SMOKE stamp if needed  
- [ ] allowlist wired from processor  
- [ ] unit tests for allowlist  
- [ ] Master G4  

---

## Exit criteria

Master G4. Commit suggestion:

`docs+fix: joboutput paths; allowlist disguised tool-call names`
