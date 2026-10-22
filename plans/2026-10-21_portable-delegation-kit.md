<!-- intention: delegation-procedure-gitignored-and-host-pinned -> tracked-path-discovering-kit-with-fresh-machine-oracle -->
<!-- workflow: lifecycle ACTIVE -->
<!-- goal_sv: Keywords: portable-delegation-kit 0.30, tracked-not-gitignored 0.20, discovered-paths 0.20, installer-route 0.15, fresh-machine-oracle 0.15
Semantic dominant: Plan how the robot-delegation procedure becomes a tracked, path-discovering kit that installs on another machine and passes its oracles there.
md5: 3f8a2c1d9e047b5a6c7d8e9f0a1b2c3d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
-->
<!-- subgoal: s2-distribution-and-supply-chain — proposed subgoal awaiting the owner's decision; see experiments_history/2026-10-22_subgoal-proposals/PROPOSALS.md §S2 -->
# t120 — portable delegation kit (plan only, no code moves)

Owner, verbatim (2026-10-21): «Баг 4 вся эта процедура должна быть переносимой на другую машину, а тут ни документация ни настройки не этому не соответствуют, кстати задаю "идиотский" вопрос - как наш кернел вообще устанавливается остальным участникам? Сколько проектов в дереве?»

## Measured (Claude 2026-10-21, taken as given; Smit verified what is marked ✓)

- `experiments/2026-10-08_robot-wave/` is GITIGNORED (`./.gitignore:72` `experiments/` ✓ read) — `watch3.py`, `send_note.py`, `dispatch.py`, `fleet.py`, `robot_verified.py`, `hourly-task-prompt.md`, `delegator.json` ride in it. A clone gets none of them.
- `.claude/CLAUDE.md` § Delegation and `.claude/skills/robot/SKILL.md` «Read back» point at those paths (t119 added the watch3 step to both — that fix is host-pinned text, not portability).
- Hardcoded host paths (`C:/Users/Alexander`, `D:/zPython`), counted by grep: watch3 4, send_note 4, dispatch 3, fleet 1, robot_verified 3, hourly prompt 5; Stop gate `~/.claude/hooks/robot_pending_stop.py` 3; `~/.claude/settings.json` 36 (✓ hook-name grep hits `C:/Users/Alexander/.claude/hooks/…` across fold/restore/probe/no-offer/pending-stop entries).
- Hooks live only in `~/.claude/hooks/` (✓ 22 entries listed: fold_capture/restore + handoff pair, hook_probe, measured_peer_message, no_offer_stop, recall, robot_pending_stop, incl. `.bak-*`).
- Kernel distribution: `prompt_kernel` installs only this repo (and `~/.codex`); other projects get the kernel through the ADID lane (`ADID_Python/artefacts` canon → ADIDInstaller → each project's `.claude/`, `.cursor/`, `.codex/skills`, `.opencode/skills`) — ✓ `artefacts/README.md` read whole (regeneration pipeline, four layers, InstallerClaude scope rule). ADID `kernel/candidates.json` copied 2026-10-18 (opencode head `9609dbc1`; ✓ read: claude sha `6367e50b…0bedd`), live kernel here measured 2026-10-21 `ff958dcb…506f` (re-hash before citing — the receivers move with t111).
- Fossil registry (`fossil all list` ✓ read whole): 78 rows, 76 distinct roots.

## Inventory (path | tracked | host paths inside | who reads it)

| Piece | Tracked | Host pins | Readers |
|---|---|---|---|
| `experiments/2026-10-08_robot-wave/watch3.py`, `send_note.py`, `dispatch.py`, `fleet.py`, `common.md`, `queue.md`, `sessions.json`, `delegator.json`, `session_tasks.json` | NO (gitignored dir) | watch3 4, send_note 4, dispatch 3, fleet 1 | robots, hourly check, Claude sends |
| `…/robot_verified.py` (ledger format = contract) | NO | 3 (`C:/Users/Alexander…`, `D:/zPython…`) | hourly check 3b, Stop hook `robot_pending_stop.py` |
| `…/hourly-task-prompt.md` (steps 1-7 + envelope) | NO | 5 (`D:/…` worktree + host recipes) | scheduled-task SKILLs, hourly Claude |
| `scripts/scheduled-tasks/org-watch.md` | YES (tracked) | — (template path, verify at build) | `org-watch` SKILL |
| `~/.claude/scheduled-tasks/{hourly-robot-fleet-check,robot-fleet-hourly,org-watch}/SKILL.md` | NO (outside repo) | `D:\zPython\opencode` + port 4096 (stale, robot-fleet-hourly) | Desktop scheduler |
| `~/.claude/hooks/*.py` (fold_*, hook_probe, no_offer_stop, robot_pending_stop, recall, measured_peer_message) | NO | 3 in Stop gate; `C:/…` in settings entries | `~/.claude/settings.json` blocks |
| `~/.claude/settings.json` hook blocks | NO | 36 hook-path refs | Claude Code runtime |
| `.claude/CLAUDE.md` § Delegation, `.claude/skills/robot/SKILL.md` | YES | 2 refs to gitignored wave paths (t119) | Claude + robots |
| `~/.claude/robots/verified.jsonl` (ledger DATA) | NO, and must stay that way | runtime state | `robot_verified.py`, Stop hook |

Runtime state (`sessions.json`, `queue.md`, `delegator.json`, `verified.jsonl`) is NOT kit code: only their FORMAT ships as contract (as `robot_verified.py` already states).

## Kit design (no moves in this plan — design only)

- **Home.** A TRACKED home per the project layout (AGENTS.md: `scripts/` = build/run/maintenance scripts; `tools/` = binaries + host client; skills live in skill dirs, never loose). Candidates: `scripts/delegation/` (procedures + installer) with the skill docs referencing it; `tools/` stays binaries-only. → Owner decision 1.
- **Discovery, never literals.** Repo root from `git rev-parse --show-toplevel` (fallback: the installer's `--root`); home from the environment (`%USERPROFILE%`/`$HOME`, no `C:/Users/Alexander`); the live host from `tools/opencode_host.py` (already the single header spelling — reuse, do not duplicate). A converter pass rewrites the counted literals (`C:/Users/Alexander` → home, `D:/zPython/opencode` → repo root) at install time; the installed tree must contain neither string (fresh-machine oracle).
- **Hooks as tracked source + idempotent installer.** Hook `.py` files ship as tracked source in the kit home; the installer writes `~/.claude/settings.json` entries with discovered paths, backs the file up first (`settings.json.bak-<ts>`), and re-running it is a no-op when entries already match.
- **ADID fit (do not edit ADID).** The kit needs from the ADID lane one of: (a) a `portable/`-style component (cf. `artefacts` «portable tools package»: declared tools + `MANIFEST.sha256` + smoke per tool) carrying the delegation procedures; (b) skill scaffolds carrying the robot skill; (c) nothing — the kit ships from this repo and ADID only carries the kernel. The plan compares the three and recommends one; ADID files are read, never written. → Owner decision 2.

## Real projects (rule + counts, from the 78-row registry read whole 2026-10-21)

**Rule.** REAL = a `snapshot.fsl` whose root is a top-level project checkout (a direct child of a discipline folder, e.g. `D:/zPython/<name>`), i.e. NOT matching: `Temp/`, `/stand`, `scratch`, `/wt/`, `/probe/`, `sandbox`, `.codegraph`, `*worktrees*`, `/experiments/`, `/experiments_history/`, `/.experiments`, a bare drive `.opencode` root, or a non-`snapshot.fsl` fossil. Sub-roots covered by a parent checkout (`opencode/experiments`, `opencode/experiments_history`) and the nested `.opencode` artefact root (`D:/zPython`) count as covered/artefact, not projects.

**Counts.** 78 rows → 76 distinct roots → **31 real**, 45 scratch/test/artefact. (Claude's 66 is a coarser normalization; this rule is reproducible from the row list above.)

**Kernel per real project** (`.claude/reasoning_kernel.md` sha256, prefix; re-hash before citing; ADID claude candidate `6367e50b…0bedd`, live here `ff958dcb…506f`):

- On the ADID candidate (3): `D:/zPascal/ Projects/ClientSoft`, `D:/zPython/ADID_Python`, `D:/zPython/_proxmox`.
- On another kernel (2, provenance not established): `D:/zPascal/ Projects/RView` (`d305f898…`), `D:/zPascal/XEComponents` (`c6b85b7b…`).
- On the live newest (1): `D:/zPython/opencode`.
- No kernel file (25): `D:/!Project`, `D:/!Smit/Smit2-Beliy`, `D:/!Smit/Smit2-Pasha`, `D:/zPascal/ZCompiled`, `D:/zPython/Accounting_Outsoursing`, `D:/zPython/Aurora_Python`, `D:/zPython/DeepSeek-Reasonix`, `D:/zPython/MakerAi`, `D:/zPython/Smit`, `D:/zPython/Smit_RnD`, `D:/zPython/_1C_Project`, `D:/zPython/_NPZ`, `D:/zPython/_cmd/CloudServiceTamer`, `D:/zPython/_dns`, `D:/zPython/_docx_generator`, `D:/zPython/_noblackout`, `D:/zPython/_trash`, `D:/zPython/_tst_open`, `D:/zPython/debloater`, `D:/zPython/deepseek-harness`, `D:/zPython/hf-tests`, `D:/zPython/miranda-ng`, `D:/zPython/site_link`, `D:/zPython/universal-search`, `E:/…/GoogleChromePortable64`.

So: how many projects in the tree — 31 real checkouts; how the kernel reaches the rest — today it does not (25 carry no kernel file), except through the ADID lane where it is installed.

## Boxes

- [ ] K1 — inventory every procedure piece: path, tracked or not (`git ls-files` vs `.gitignore:72`), hardcoded host paths (grep receipt), who reads it; runtime state listed by format only. <!-- sv: procedure-inventory, tracked-or-not, reader-map -->
- [ ] K2 — kit home + discovery design: TRACKED home per project layout (candidates with the rule each violates/satisfies), every path discovered (git root, env home, `opencode_host`), converter pass for the counted literals. No moves. <!-- sv: kit-home, discovered-paths, no-literals -->
- [ ] K3 — hooks as tracked source + idempotent installer design: source ships, installer writes `settings.json` entries with discovered paths, backup first, re-run is a no-op. No writes. <!-- sv: hooks-source, idempotent-installer, backup-first -->
- [ ] K4 — ADID route fit: what the kit needs from the ADID lane (portable component vs skill scaffolds vs repo-shipped), compared without editing ADID; recommendation + what ADID must change (their lane). <!-- sv: adid-fit, compare-not-edit, recommendation -->
- [ ] K5 — real-project list from the fossil registry with the separation rule and counts (31 real / 45 scratch-test-artefact). <!-- sv: registry-rule, real-count, reproducible -->
- [ ] K6 — per-project kernel table: sha compare vs live (`ff958dcb…`) and ADID candidate (`6367e50b…`), re-hash before citing. <!-- sv: kernel-table, sha-compare, rehash-first -->
- [ ] K7 — fresh-machine oracle: clean clone in a temp dir + HOME redirected to a temp dir, then the installer, then the replay suites pass with no hardcoded host string in any installed file. Predict the result before the run. <!-- sv: fresh-machine-oracle, replay-suites, no-host-strings -->

## Smoke Tests

- K1 oracle: `git ls-files` vs `.gitignore` read-back for every table row + grep counts for the literal batches. Predicted: every wave script + ledger + prompt untracked; `scripts/scheduled-tasks/org-watch.md` tracked; hook dir outside repo; counts match Claude's (4/4/3/1/3/5, 3, 36) or the delta is named.
- K2 oracle: layout-rule check (AGENTS.md project layout + `docs/README.md` + `scripts/` listing) against each candidate home. Predicted: `scripts/delegation/` satisfies all three (tracked, scripts-shaped, skill-docs reference it); `tools/` fails (binaries-only); repo root fails (not a drawer).
- K3 oracle: dry-run installer plan against a copy of a `settings.json` block (no writes): discovered paths substituted, backup named, second run no-op. Predicted: zero literals survive; re-run changes nothing.
- K4 oracle: `artefacts/README.md` regeneration pipeline + layers table read-back. Predicted: exactly one of portable-component / skill-scaffolds / repo-shipped fits without an ADID edit; the other two name the ADID change they would need.
- K5 oracle: re-run of the classification over a fresh `fossil all list` with the stated rule. Predicted: 31 real / the rest scratch-test-artefact; any delta names the row that moved and why.
- K6 oracle: sha256 re-read of the 6 kernel-carrying receivers + `candidates.json`. Predicted: ClientSoft/ADID/_proxmox still `6367e50b…`, opencode still the live receiver; any drift names the installer that moved it.
- K7 oracle: temp clone + temp HOME → installer → `experiments/2026-10-21_fold-hooks/replay.py` + `experiments/2026-10-21_robot-pending-stop/replay.py` → grep for `C:/Users/Alexander` and `D:/zPython` over installed files. Predicted BEFORE the run: installer exits 0, both replays pass (10/10 pattern as in t115), zero host-string hits. A miss is a design error, not a machine error.

## Owner decisions (asked, never assumed)

1. Where the kit lives (`scripts/delegation/` proposed — tracked, scripts-shaped; alternatives recorded in K2).
2. Whether the ADID release carries the kit (portable component vs skill scaffolds vs repo-shipped, K4 recommendation attached).

## Continuation

Next: implement leaves in K1 → K5 → K6 → K2 → K3 → K4 → K7 order (inventory and the project/kernel ground truth first, design on top, oracle last); each leaf closes on its smoke above with the run id / hash / read-back receipt. Residual if any leaf's oracle has no instrument: the leaf stays open with the named missing instrument, never a prose pass.
