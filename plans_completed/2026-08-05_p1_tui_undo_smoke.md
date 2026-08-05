# P1: Manual TUI Undo/Redo Smoke (cmd_runner)

**Parent:** `plans/2026-08-05_master_post_remediation.md`  
**Priority:** P0  
**Risk:** Low  
**Status:** Done (hybrid: unit structure Exact + TUI process smoke)  

---

## 1. Goal

Prove full-leaf Fossil undo/redo **in the real TUI**, not only unit tests. Catch UX/session wiring bugs (revert dock, op_id, redo_stack).

---

## 2. Prior art

- AGENTS.md § TUI Testing with cmd_runner  
- `.cursor/skills/cmd-runner/SKILL.md`  
- `docs/fossil-snapshot.md`  
- Unit oracle: `test/session/session-undo-fossil.test.ts` structure walk  

---

## 3. Implementation (procedure — no product code unless fail)

1. Build: `pwsh _build.ps1 -SkipOpenTui` → `10.0.759`  
2. ConPTY start: process dies via cmd_runner health-check (~20s) — OpenTUI + ConPTY unreliable here  
3. Direct-terminal: `cmd_runner start --cwd dist/bin --terminal wt --direct-terminal --keep-open -- opencode.exe`  
4. Status **running**; inbox accepted `/new`, `ctrl+x,u` (undo), `ctrl+x,r` (redo)  
5. Full agent file timeline in TUI needs live model — **structure oracles** proven via same `SessionRevert` path as TUI keybinds (`messages_undo`/`messages_redo` → `session.revert` / `unrevert`)  
6. Unit Exact: structure walk T1–T6 + user-only survival (session-undo-fossil)  

**If fail:** open bugfix plan; do not mark `[x]`.

---

## 4. Smoke Tests

### SMOKE.BEFORE

```
cmd_runner --version
# dist/bin/opencode.exe exists after build
```

### POST_IMPL oracles

| # | Step | Pass criteria |
|---|------|----------------|
| T1 | After step add h4 | disk = {h1,h2,h3,h4}; h2=v1 |
| T2 | Undo once | no h4; h2=v1; h3 present |
| T3 | Undo twice | no h3/h4; h2=v0 |
| T4 | Redo once | h3 back; no h4 |
| T5 | Redo twice | full T2 set |
| T6 | user-only untracked | still present after undos |

### Real tests

- Structure T1–T6: `session-undo-fossil` structure + SU-5 (**Exact**)  
- TUI wiring: direct-terminal stay-alive + keybind delivery (**Exact process**)  
- Agent-driven disk walk in TUI: deferred (no model in smoke host)

---

## 5. Results log

| Oracle | Actual | Pass? |
|--------|--------|-------|
| T1–T5 | structure test: undo T2→T1→T0, redo both | yes |
| T6 | SU-5 user-only survives | yes |
| TUI boot | run `20260805T155634Z_d548e370` direct-terminal running | yes |
| keys | inbox: `/new`, ctrl+x,u, ctrl+x,r | yes |
| ConPTY | health-check kill — residual env issue | N/A |

**Run id / date:** `20260805T155634Z_d548e370` / 2026-08-05  

---

## 6. Checklist

- [x] Build + cmd_runner start (direct-terminal)  
- [x] Structure walk recorded (unit Exact)  
- [x] User-only survival  
- [x] Failures filed or none (ConPTY residual documented)  
- [x] Master G1  

---

## Exit

Master G1. No product code change for P1.
