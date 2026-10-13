# 2026-10-13 — AGENTS.md split: results (lossless move + size guard)

Plan: `plans/2026-10-13_agents-md-split.md` (owner brief 2026-10-13: «agents.md раздулся, отправь робота разрулить и раскидать по документации с индексацией»).

## Numbers

| | value |
|---|---|
| OLD AGENTS.md | 1 303 lines, 96 896 B (git blob, LF) / 98 199 B on disk (CRLF) |
| NEW AGENTS.md | 745 lines, 49 737 B (git blob) / 50 482 B on disk (CRLF) — 51 % smaller |
| Moved to docs/ | 9 new topic docs + 8 extended docs |
| Paragraphs checked (oracle) | 449; **NOT FOUND = 0** |
| Guard budget | ceil(50 482 × 1.15) = **58 055 B** (`.husky/agents-size-guard.mjs`) |

## Oracle — `lossless.py` (paragraph-level, whitespace-normalized)

Every paragraph of `git show HEAD:AGENTS.md` (unit = blank-line block, split at top-level list items; an item is atomic) must be found in the new `AGENTS.md` or under `docs/**`.

| run | command | result |
|---|---|---|
| positive control (pre-change) | `python experiments/2026-10-13_agents-md-split/lossless.py` | NOT FOUND: 0 (449 paragraphs) |
| negative control (pre-change) | `python .../lossless.py --no-agents` | NOT FOUND: 424 → the checker can fail |
| post-change | `python .../lossless.py` | NOT FOUND: **0** |

One intermediate miss (Search-instruments pointer split a block fused with the CodeGraph markers, L1289-1291) was found by the oracle and repaired: pointer moved before the block.

## Guard — `.husky/pre-commit` → `.husky/agents-size-guard.mjs`

Proof of fallibility (the guard's own code, both paths) — `guard_proof.ts`:

```
cmd_runner run 20261013T130554Z_78fd5ffa  (pwsh-wrapped bun — see residual)
default:    exit=0  ✅ AGENTS.md 50482 B within the 58055 B budget
override=1: exit=1  ❌ AGENTS.md is 50482 B — over the 1 B budget by 50481 B. Move prose to docs/ (keep rules + a Details: pointer).
GUARD_FALLIBILITY_OK
```

`AGENTS_MD_BUDGET` exists only so the failure path is provable; nothing in the normal flow sets it.

## Residual — cmd_runner payload defect (recorded, not fixed here)

Class: **the ConPTY payload writer mangles `.cmd` targets** — `cmd_runner start -- bun …` (bun resolves to `bun.cmd`) writes `payload.ps1` as `& ''C:\…\bun.cmd'' ''run'' …` (doubled quotes), PowerShell rejects it at char 3, the child never starts. Observed 2026-10-13 on the repo-root `cmd_runner.exe` (PATH-first, dated 2026-05-13). Targets that are real executables are unaffected (`cmd /c echo` ran; `pwsh -NoProfile -Command …` ran). `--raw` finishes by health-check with `pid absent`, 0 bytes. `tools\cmd_runner.exe` (2026-10-11 build) fails differently here: `Cannot start independent host (WinError=5); the parent Job may forbid breakaway`.

Workaround used: wrap the real command in `pwsh`: `cmd_runner start -- pwsh -NoProfile -Command "bun run …"`. This is a route around a broken tool — the residual for the next cycle; a later session should diff `tools\cmd_runner.exe` vs the root copy and repin, or fix the payload escaping.
