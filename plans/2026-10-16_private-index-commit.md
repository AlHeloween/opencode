<!-- intention: robots share ONE .git/index, so one robot's commit sweeps another's staged work -> each robot commits through its own private index, so a commit carries only its own paths -->
<!-- goal_sv: private-index-commit 0.45, shared-index-isolation 0.30, hook-still-runs 0.15, attribution-precondition 0.10 -->
# Private-index commit route (t66)

**Status:** ACTIVE

Measured 2026-10-16 (docs/robot-protocol-log.md row ce1671ca): t50 staged its 4 closure
paths, t59 ran `git commit` without a pathspec in the same window, so `5ae331f221`
carries t50's archive + plan move under t59's message, and t50's log line rode t63's
`dd465eab33`. Content intact, authorship wrong. «Stage by path» in a brief cannot
isolate a shared index. Owner, same day (plans/2026-10-15_dais-peer-trust-reward.md):
proof of one's own act is layer 1 of peer trust.

## Prior art (REUSE.BEFORE)

- Repo search: no commit helper exists (`scripts/` holds build/test/org-genesis only;
  `GIT_INDEX_FILE` appears nowhere in tracked source) — nothing to reuse, build the one route.
- Git's own primitive is the authority: `GIT_INDEX_FILE=<private> git <add|read-tree|...>`
  redirects all index operations to the private file; the shared `.git/index` is never
  opened. `git commit-tree` + `git update-ref <ref> <new> <old>` is the atomic
  compare-and-swap for the ref update (rebase-free retry, never a force).
- Hook: `core.hooksPath=.husky/_` (confirmed via `git config --get`); `.husky/pre-commit`
  = `bun install` peer-dep check + `AGENTS.md` size guard (`agents-size-guard.mjs`).
  It inspects no index content, so it behaves identically under a private index — but it
  must still RUN on every route commit (never `--no-verify`). `git commit-tree` does NOT
  run hooks, so the route invokes the hook explicitly between staging and commit-tree
  and aborts when it fails.
- `.opencode/skills/**` mention commits nowhere (grep: only opentui renderer refs) —
  robots today commit by the one brief line in `experiments/2026-10-08_robot-wave/common.md`
  («Commit ONLY your own paths»), plus AGENTS.md § JOB FAILED ("one plan, one commit
  naming it", canon: docs/plan-maintenance.md).

## Design (DISAS — one route)

`scripts/commit_own.py --session <id> -m <msg> -- <paths>`:

1. Private index `.git/index-<session>` (`<id>` restricted to `[A-Za-z0-9_-]+`, no
   separators — never writes outside `.git`). A stale file from a crashed run is
   removed first (it is ours by name); seed with `GIT_INDEX_FILE=<priv> git read-tree --reset HEAD` (index-only, worktree untouched).
2. Stage exactly the given pathspec, whole-file: `GIT_INDEX_FILE=<priv> git add -A -- <paths>`
   (`-A` bounded by the pathspec, so renames/deletions of own paths are covered).
3. Refuse when nothing is staged (`git diff-index --quiet --cached HEAD` fails the quiet
   check) — an unmodified path is an error, never an empty commit. Require a branch
   (refuse detached HEAD).
4. Run the hook (`git hook run pre-commit`, needs git >= 2.36; fallback: run the resolved
   hook file directly). Hook failure aborts, private index removed.
5. `tree = git write-tree` (private index), `new = git commit-tree <tree> -p <head> -m <msg>`,
   then atomic `git update-ref refs/heads/<branch> <new> <head>`. If it fails, HEAD moved
   meanwhile: re-seed from fresh HEAD, re-add, rewrite, re-commit (bounded retries, default 5),
   never `--force`, never `--amend`.
6. Remove the private index on success AND on failure. The shared index is never opened
   with write intent by the route (every git index command carries `GIT_INDEX_FILE=<priv>`).
- Hunk-level staging is OUT OF SCOPE: `git add -p` against an alternate index works
  (`GIT_INDEX_FILE=<priv> git add -p -- <path>`) but is interactive and cannot run
  unattended in robot sessions. The one shared file (`_progress_log.md`) is append-only:
  whole-file add after a HEAD-moved retry stages only lines not yet in HEAD, which is
  exactly the robot's own entry when each robot commits its entry promptly in its closure
  commit. A concurrent uncommitted append by another robot to the same file remains a
  content race (not an index race) and is documented, not solved, here.
- Test-only seam: `COMMIT_OWN_RACE_HOOK` (a shell command run after `write-tree`, before
  `update-ref`) lets the race test advance HEAD deterministically. Not for production use.

## Implementation steps

- [x] T1 Tests first (RED): `packages/opencode/test/git/private-index-commit.test.ts` — 4 cases
  (isolation vs staged A, hook ran, HEAD-moved retry, unmodified-path refusal); RED `20261016T022926Z_1547a8fd` exit 1, 0 pass / 4 fail (`can't open file 'scripts/commit_own.py'`).
- [x] T2 Route: `scripts/commit_own.py` as designed above; GREEN `20261016T023058Z_40ca69d5` exit 0, 4 pass / 0 fail (19 expects) + strengthened-race GREEN `20261016T023237Z_c534de4f` exit 0, 4 pass / 0 fail.
- [x] T3 Docs: one line in `experiments/2026-10-08_robot-wave/common.md` + one line in
  `docs/plan-maintenance.md` (§ JOB FAILED) pointing to the route. No kernel edit.
- [x] T4 Live oracle: route + test + docs landed via the route as `37841fae12` (private index, hook ran, shared index untouched — verified in ancestry); this tick rides the route too in the close-out commit. `_progress_log.md` entry updated. `_build.ps1` skipped per task bounds (no `packages/**` source change — test-only file + script + docs; two robots co-work in this tree).

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `cmd_runner start --cwd packages/opencode -- bun test test/git/private-index-commit.test.ts` | RED (route missing: script not found) | RED `20261016T022926Z_1547a8fd` exit 1, 0/4, `can't open file 'scripts/commit_own.py'` [Exact] |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | same bun test file | 4/4 pass: B's commit lists only B's paths; A's staged names+blob-hashes (`git ls-files -s`) byte-identical before/after; both commits in log; hook marker appended once; HEAD-moved retry lands both commits on fresh parent; unmodified path exits non-zero with no new commit and no leftover private index |
| 2 | `git status --short` after route self-commit | only intended paths moved; no `.git/index-*` remains |
| 3 | `pwsh -NoProfile -File _build.ps1` (repo root, cmd_runner) | exit 0 receipt in state.json (no `packages/**` touched, so build is a formality) |

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

```yaml
Keywords: private-index-commit 0.45, shared-index-isolation 0.30, hook-still-runs 0.15, attribution-precondition 0.10
Semantic dominant: Each robot commits through its own git index so a commit carries only its own paths.
md5: 7f3a9c1e4b5d6a8091627384950fedcb
prev-md5: 00000000000000000000000000000000
parent-goal-md5: d60d355a279f2b3a68ef063f1392a36f
```
