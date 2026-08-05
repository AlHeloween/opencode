# P6: Disguised Tool-Call Allowlist from Live Registry

**Parent:** `plans/2026-08-05_master_post_remediation.md`  
**Priority:** P2  
**Risk:** Medium  
**Status:** Done  

---

## 1. Goal

Today: `DEFAULT_KNOWN_TOOL_IDS` static set in `dsml-normalizer.ts`.  
Plugin/MCP tools not in the set won't trigger disguised-tool retry (false negative).

Target: processor passes **live tool ids** for the current turn when available.

---

## 3. Implementation

1. `knownToolIdsForTurn(tools)` in `dsml-normalizer.ts` — DEFAULT ∪ live keys  
2. `SessionProcessor` ctx.knownToolIds; set in `process()` from `streamInput.tools`  
3. `detectDisguisedToolCalls(..., ctx.knownToolIds)`  
4. Tests: custom id only when live  

**[KV-CACHE]:** no system prompt changes.

---

## 4. Smoke Tests

| # | Pass |
|---|------|
| unit: custom id in set extracted | yes |
| unit: custom id not in set ignored | yes |
| typecheck | 0 |
| dsml-normalizer suite | green |

---

## 5. Checklist

- [x] Wire toolIds from process stream tools  
- [x] Tests  
- [x] Done  

---

## Exit

`fix(defence): disguised tool allowlist from session tools`
