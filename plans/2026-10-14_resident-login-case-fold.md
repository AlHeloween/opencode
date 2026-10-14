# Resident login — one identity per project, case-folded

<!-- intention: a resident login derived from a case-preserving path on a case-insensitive filesystem forks one project into two identities (smit-ADID_Python next to smit-adid_python) -> the login is canonical lowercase, an existing login matching case-insensitively is reused instead of created, and every verb that derives or matches a login (delegate, claim, inbox, wake) does so case-insensitively -->

<!-- goal_sv: resident-login, case-fold, canonical-identity, cross-handoff, wake-routing -->

- **plan_id:** 2026-10-14_resident-login-case-fold
- **revision:** 1
- **state:** COMPLETE (closed 2026-10-14, commit names this plan)
- **reported:** owner, 2026-10-14: «папка у нас такая, так что агента обвинять не в чем. Но с case надо что-то сделать.»
- **measured (claude, forum thread 396b2f9428; re-measured here):** `org.py delegate --assignee smit-adid_python --worktree "D:\zPython\ADID_Python"` printed «resident smit-ADID_Python (created)»; the org repo holds BOTH logins. The ticket (fdc399c09c) is assigned to the lowercase one; the hand-off derived the resident from the path's letter case.
- **class:** an identity derived from a case-preserving path on a case-insensitive filesystem — inbox, lease and wake routing can split between two spellings of one project.

```yaml
Keywords: resident-login 0.30, case-fold 0.24, canonical-identity 0.18, cross-handoff 0.16, wake-routing 0.12
Semantic dominant: A resident login derived from a case-preserving path is canonical lowercase, and an existing login matching case-insensitively is reused everywhere a login is derived or matched, so one project never forks into two identities.
md5: 3f8a2c7e91d4b6a08c5e2f7d3140ab92
prev-md5: 6c1d0a4f8b2e97d350a1c6e4f7290b8d
parent-goal-md5: 00000000000000000000000000000000
```

## Evidence (each line carries its instrument)

- ✓ read `scripts/org-genesis/org.py:304-312` (`ensure_resident`): `login = f"smit-{Path(worktree).resolve().name}"` — no case fold; existence via `SELECT 1 FROM user WHERE login = ?` (exact).
- ✓ read `org.py:404` (`cmd_delegate`): `SELECT 1 FROM user WHERE login = ?` on `--assignee` (exact) — a case variant of an existing login is refused, and the ticket records the caller's spelling.
- ✓ read `org.py:467` (`cmd_claim`), `:262` (`guard_lease`), `:270` (`guard_delegator`): `owner != user` / `delegator != user` — exact comparisons.
- ✓ read `org.py:563-566` (`cmd_inbox`): `WHERE assigned_to = ?`; `:341` (`watching`): `WHERE watcher = ?` — exact.
- ✓ read `orgd.py:179` (`assignee_session`): `parts[1] == assigned_to` — the wake's PRESENCE match is exact; `norm(worktree)` two lines below already folds the path's case.
- ✓ `fossil help user` + in-tree source `external/fossil/fossil-src-2.28/src/user.c:351` («Users can never be deleted»): **the CLI has no `user delete`** — deletion exists only in the web setup (`src/setupuser.c:496`, `DELETE FROM user WHERE uid=`). The stray login must be removed by the same statement via `fossil sql`, with the user list read back.
- ✓ live org read-back (fossil sql, 2026-10-14): `smit-ADID_Python` holds NOTHING — 0 rows in `ticket` for assigned_to/lease_owner/watcher/delegated_by, 0 in `event.user`, 0 in `chat.xfrom`; repository default user is `Alexander`.
- ✓ installed genesis vs repo: `org.py`/`orgd.py`/`init.py`/`orgcfg.py`/`opencode_host.py`/`Protocol.md`/`ticket-schema.sql`/`branding.sql` byte-identical (sha256[:16] compare); only the test files live in the repo alone — installation copies runtime files.
- ✓ `test_cross_handoff.py` harness (read): scratch `ORG_HOME` + scratch worktrees, real Fossil repo, verbs as subprocesses, assertions read the repository back.

## Tasks

- [x] **T1 — one canonical derive.** New `canon_login(name)` (strip + lowercase) and `resolve_login(name)` (the org's existing login matching case-insensitively, canonical spelling first) in `org.py`; `ensure_resident` derives `smit-<project>` through `canon_login` and RETURNS an existing case-insensitive match instead of creating a second login. Binding: `scripts/org-genesis/org.py`. Oracle: S1/S6. ✓ 2026-10-14 — run `20261014T123443Z_b4d836df` S6 green; live read-back `ensure_resident(r"D:\zPython\ADID_Python") -> ('smit-adid_python', False)` on the real org.
- [x] **T2 — matching folds the case everywhere a login is matched.** `cmd_delegate` resolves `--assignee` through `resolve_login` (records the org's real spelling; still refuses an unknown login); `cmd_claim`, `guard_lease`, `guard_delegator` compare through `canon_login`; `cmd_inbox` (`assigned_to`) and `watching` (`watcher`) match with `lower(...) = lower(?)`; `orgd.assignee_session` matches the PRESENCE login case-insensitively. Binding: `scripts/org-genesis/org.py`, `scripts/org-genesis/orgd.py`. Oracle: S2-S5, S7. ✓ 2026-10-14 — S8 forced one more site: fossil itself matches a login EXACTLY (`no such user: SMIT-STAND-CASE`), so `need_user` now resolves the caller's spelling to the org's (`resolve_login(user) or user`); run `20261014T123443Z_b4d836df` S7/S8 green.
- [x] **T3 — the test moves with the behaviour.** `test_cross_handoff.py` gains S6 (a mixed-case worktree path derives the canonical lowercase login, created exactly once — no second spelling appears), S7 (an existing login in the OTHER case is reused, never duplicated — the incident replayed in both directions), S8 (inbox/claim/heartbeat and the orgd wake match the assignee across case). Binding: `scripts/org-genesis/test_cross_handoff.py`. Oracle: RED on HEAD, GREEN after T1-T2; the queue/wiki/forum suites stay green. ✓ 2026-10-14 — RED `20261014T123114Z_3bb97998` (S6 `resident smit-Stand-Case (created)` + `no such user 'smit-stand-case'`; S7/S8 same class, 3 failures); GREEN `20261014T123443Z_b4d836df` Ran 8 tests OK; regressions queue `20261014T123533Z_1832b39f` 8/8, wiki `20261014T123554Z_3c2b7509` 15/15, forum `20261014T123616Z_b627a038` 11/11.
- [x] **T4 — the stray login goes.** `smit-ADID_Python` holds nothing (measured above): remove it via `fossil sql` (the CLI has no `user delete`; the statement is the one the web setup runs) and read the user list back. If any reference had existed, report and stop — none does. Binding: live `~/.org/org.fossil`. Oracle: S9. ✓ 2026-10-14 — references before delete: 0; `DELETE FROM user WHERE login='smit-ADID_Python'` rc 0; the list now holds `smit-adid_python` and `smit-opencode` only (S9 green).
- [x] **T5 — install the changed genesis and close.** Copy the changed runtime files into `$ORG_HOME/genesis` (byte-compared against HEAD first, the way the 2026-10-13 install did), run `init.py`; commit the plan's paths only; reply in forum thread 396b2f9428 with the commit and the test pass line. Binding: `C:\Users\Alexander\.org\genesis`, git. Oracle: S10/S11. ✓ 2026-10-14 — installed `org.py`/`orgd.py`/`Protocol.md` (installed==repo sha256 true for each); `init.py` rc 0 (`fields present; forum caps present; check-out present; orgd pid 19500`); ticket fdc399c09c's own login is the reused canonical one.

## Smoke Tests

All commands run through `cmd_runner` (one file per call); every prediction is made BEFORE the run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass.

| # | command | prediction |
|---|---|---|
| B1 | `cmd_runner start --cwd scripts/org-genesis -- python -X utf8 test_cross_handoff.py` on the PRE-change scripts + the new S6-S8 | RED — S6: the mixed-case path creates `smit-Stand-Case` instead of the canonical `smit-stand-case`; S7: a second login is created next to the pre-existing one; S8: the cross-case inbox/claim/wake do not match |
| B2 | same file on the PRE-change scripts, S1-S5 only | PASS (baseline of the existing cases) |
| S1 | green run of the whole file after T1-T2 | PASS — S6: exactly one `smit-stand-case` row (no case variant); S7: the pre-existing spelling is reused, still one row; S8: inbox/claim/heartbeat/wake match across case |
| S2 | `python -X utf8 test_queue_contract.py` (regression: delegates, leases, verdicts) | PASS |
| S3 | `python -X utf8 test_wiki_put.py` (regression: login-capped writes) | PASS |
| S4 | `python -X utf8 test_forum_post.py` (regression: login-capped posts) | PASS |
| S5 | live: `ensure_resident(r"D:\zPython\ADID_Python")` against the real org | `("smit-adid_python", False)` — the existing lowercase login is found, nothing created |
| S9 | live: remove `smit-ADID_Python` via `fossil sql`, then `fossil user list` | the stray login is gone from the list; `smit-adid_python` remains; tickets untouched |
| S10 | copy the changed files to `$ORG_HOME/genesis` (byte compare first), then `python $ORG_HOME/genesis/init.py` | install sha == HEAD sha; init exits 0 (idempotent) |
| S11 | `cmd_runner start --cwd <repo root> -- pwsh -NoProfile -File _build.ps1` | exit 0 per `state.json` |
| R | S1's file + S2's file re-run after every further edit | unchanged PASS |

## Residuals

- Fossil's CLI cannot delete a user (only deny access) — the removal uses `fossil sql` with the statement the web setup itself runs; recorded here so the next cycle does not look for a `user delete` verb.
- Case-insensitive matching covers the login STRING; a login that differs from another by more than case stays a separate identity (nothing to fix until a filesystem proves otherwise).
- `init.py`'s `grant_forum_caps` walks the actual user list and needs no folding; a stray login would still get caps — that is why the stray is removed rather than denied.

## Out of scope

- Renaming or merging any login that already holds work (none does for the stray).
- The web-setup path for user administration.
- Any change to `packages/opencode` sources.

## Rollback

`git revert` of the plan's commit restores the exact-match behaviour; the stray login's removal is not undone by it and is recorded here with its read-back (it held nothing, so nothing is lost — recreating it would be `fossil user new smit-ADID_Python robot <secret>`).
