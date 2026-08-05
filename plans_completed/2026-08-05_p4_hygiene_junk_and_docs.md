# P4: Hygiene — Junk File, Unpushed Commits, Doc Drift Check

**Parent:** `plans/2026-08-05_master_post_remediation.md`  
**Priority:** P1  
**Risk:** Low  
**Status:** Done  

---

## 1. Goal

1. Remove accidental untracked junk:  
   `packages/opencode/i+1).join(String.fromCharCode(10)))`  
2. Push local commits when user wants (`ahead N` on Local_Development).  
3. Spot-check AGENTS constitution table vs `constitution.ts` (no new drift).  

---

## 3. Implementation

- Junk deleted (`Test-Path` false)  
- Drift: git ls-files / where / findstr / echo ALLOWED; cmd_runner send split+brutal — matches code  
- Push deferred to end of program with product commits  

---

## 4. Smoke Tests

| # | Check | Pass |
|---|-------|------|
| H1 | junk path absent | yes |
| H2 | intentional untracked plans only until commit | yes |
| H3 | constitution table review | no known drift |

---

## 5. Checklist

- [x] Junk deleted  
- [ ] Push (with program commit)  
- [x] Drift review  
- [x] Master G4  

---

## Exit

Junk was untracked-only → no separate commit.
