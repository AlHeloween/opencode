# P5: Route `run` Tool Through AST Constitution (Optional Polish)

**Parent:** `plans/2026-08-05_master_post_remediation.md`  
**Priority:** P2  
**Risk:** Medium  
**Status:** Cancelled — option B documented  

---

## 1. Goal

`bash`/`cmd` use TreeSitter + `enforceDestructiveShellFromAst`.  
`run.ts` still uses legacy `enforceDestructiveShell` → `guardCommand` (token path).

---

## 2. Decision

**B (chosen):** `run` is always pure binary+args (see `run.txt`). Not a shell; no pipelines.  
Keep legacy first-token guard. Documented in:

- `packages/opencode/src/tool/run.txt`  
- `packages/opencode/src/tool/shell-constitution.ts` header  

Regression: `enforceDestructiveShell('git commit -m "fix(fossil): …"')` does not FOSSIL_MUTATE — covered in `shell-constitution.test.ts`.

**cancelled: product uses run for binary argv only; AST reserved for bash/cmd**

---

## 5. Checklist

- [x] Call-site survey (`run.txt` + `run.ts` argvLine)  
- [x] Choose B  
- [x] Document (no code path flip)  
- [x] Tests (legacy false-positive guard)  

---

## Exit

`docs: run tool stays legacy guard (not shell)`
