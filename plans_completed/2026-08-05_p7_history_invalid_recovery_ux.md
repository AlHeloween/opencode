# P7: HISTORY_INVALID Recovery UX (Optional / Product Decision)

**Parent:** `plans/2026-08-05_master_post_remediation.md`  
**Priority:** P3  
**Risk:** Medium  
**Status:** Cancelled — product chose C (document-only)  

---

## 1. Goal

Today after corrupt fossil reinit:

- Backup `snapshot.fsl.bak.*`  
- `HISTORY_INVALID.json`  
- Undo **fails loud**  

Missing: operator path to **clear marker** / restore from backup without hand-editing files.

---

## 2. Decision

| Option | Behavior |
|--------|----------|
| **C** | Document-only recovery — **chosen** |

Documented in `docs/fossil-snapshot.md` § Troubleshooting:

1. stop opencode  
2. copy `snapshot.fsl.bak.<ts>` → `snapshot.fsl`  
3. delete `HISTORY_INVALID.json`  
4. restart  

CLI recover (A) deferred until production hits.

**cancelled: product chose C / deferred**

---

## 5. Checklist

- [x] Product pick C  
- [x] Document-only  
- [x] SP-05 marker block still Exact  

---

## Exit

Docs-only; no CLI/TUI recover command.
