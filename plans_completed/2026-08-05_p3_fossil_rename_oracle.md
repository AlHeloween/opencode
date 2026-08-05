# P3: Fossil Rename/Move Undo Oracle

**Parent:** `plans/2026-08-05_master_post_remediation.md`  
**Priority:** P1  
**Risk:** Low  
**Status:** Done  

---

## 1. Goal

Prove full-leaf undo after **rename/move + edit** does not leave both old and new paths (file soup).

Scenario:

```
T0: a.txt = "A"
T1: fossil mv a.txt → b.txt; b.txt = "B-edited"
Undo to T0 → only a.txt="A", no b.txt
Redo to T1 → only b.txt="B-edited", no a.txt
```

---

## 2. Prior art

- CLI research in audit: checkout leaves extras; preLs cleanup removes stale tracked  
- `docs/fossil-snapshot.md` §2  
- `session-undo-fossil.test.ts` structure walk (add/modify only)  

---

## 3. Implementation

Extended `test/session/session-undo-fossil.test.ts`:

- track T0 (`a.txt`="A")  
- fs rename → `b.txt`, content `B-edited`, track  
- session `revert` to T0 → only `a`  
- `unrevert` → only `b`  

---

## 4. Smoke Tests

### POST_IMPL

| # | Oracle | Pass |
|---|--------|------|
| R1 | After undo: `a.txt` exists, `b.txt` gone, content A | Exact |
| R2 | After redo: `b.txt` only, content B-edited | Exact |
| R3 | suite green | 0 fail |

Actual: `P3 rename/move: undo leaves only a.txt; redo only b.txt` **pass** (~10s)

---

## 5. Checklist

- [x] Test written  
- [x] R1–R3  
- [x] Master note  

---

## Exit

Commit: `test(snapshot): rename/move full-leaf undo oracle`
