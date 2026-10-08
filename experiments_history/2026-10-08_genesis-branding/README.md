# t11-genesis-branding — init.py applies branding.sql, verified by read-back

<!-- intention: branding applied by hand -> branding applied by init.py on every run, idempotent -->

Owner's brief: `experiments/2026-10-08_robot-wave/t11-genesis-branding.md` (robot wave, task t11).
The org's branding and its two report formats (Active tasks, Delegation tree) were applied to the
live org.fossil by hand on 2026-10-08; a new machine must get them from genesis. The change:
`scripts/org-genesis/init.py` gains one step after the Protocol wiki step — apply `branding.sql`
and verify it landed; the installed copy at `%USERPROFILE%/.org/genesis` carries both files.

## Instrument

`check_branding.py` — black-box, scratch org only (fresh `ORG_HOME` + `FOSSIL_HOME` under the probe
dir; never the live `~/.org`). Runs `init.py` twice from a skeleton copy of `scripts/org-genesis`
(real fossil.exe beside it), reads config/reportfmt straight from the scratch org.fossil (sqlite3,
read-only), and checks that the live home stayed untouched. `--genesis-src` pins the code under test
(the before-run uses the pre-change `init.py` obtained via `git show HEAD:`).

`install_genesis.py` — copies `init.py` + `branding.sql` into `%USERPROFILE%/.org/genesis` and
confirms with a sha256 compare (the t13 install rule).

    python check_branding.py [--tag before|after] [--port 18089] [--genesis-src PATH]
    python install_genesis.py            # files: init.py branding.sql

## Evidence (cmd_runner run ids, 2026-10-08 UTC)

| # | run | what | result |
|---|---|---|---|
| 1 | `20261008T100547Z_89b340df` | first baseline on HEAD; B7 then asserted an exit code that does not exist | 4/8, exit 1 |
| 2 | `20261008T100749Z_67561546` | baseline, B7 fixed to the measured truth | 5/8, exit 1 — B2/B3/B5 the predicted reds |
| 3 | `20261008T100850Z_18c93a94` | post-change | 8/8, exit 0 |
| 4 | `20261008T100932Z_7fe93fb8` | + B9 mutation check; B6 red — real `_fossil` mtime moved during the run (foreign writer, see Findings 3) | 8/9, exit 1 |
| 5 | `20261008T101212Z_b3738490` | B6 reworked to a content criterion | 9/9, exit 0 |
| 6 | `20261008T101330Z_39b6d8d8` | canonical BEFORE — final probe vs `before-src` (HEAD init.py) | 5/9, exit 1 — reds B2/B3/B5/B9 |
| 7 | `20261008T101344Z_cad67a3b` | canonical AFTER — final probe vs working tree | **9/9, exit 0** |
| 8 | `20261008T101410Z_2057cdd3` | install into `%USERPROFILE%/.org/genesis` | exit 0, sha256 MATCH (init.py `4a2e6786…`, was `35a073f7…`) |
| 9 | `20261008T101419Z_19592ac4` | live `init.py` on `~/.org/org.fossil` | exit 0, normal line, `tickets=10` unchanged |

Live proof the step EXECUTED (not merely that the org was already branded): config + reportfmt row
mtimes moved to 1791454460 — the second the live init ran — counts stayed 4 config names / 1+1
report formats, tickets 10 before and after.

## Findings that changed the design

1. **`fossil sql` exits 0 even when a statement fails.** `cmd_sqlite3` is a void command: the sqlite3
   shell returns `errCnt>0` and nothing reads it (`sqlcmd.c:431`; measured — run 1 B7). A broken
   `branding.sql` therefore cannot be caught by an exit code, and the file-argument form is no better
   (a missing/empty `.sql` argument falls through to "execute the path as SQL"). The step feeds via
   stdin (exactly as `branding.sql`'s own header documents) and verifies by READ-BACK of the artifact:
   4 config names + 'Active tasks'/'Delegation tree' counts. Run 6→7 proves the guard is fallible in
   the right direction — B9 (a no-op `branding.sql`) is red on HEAD (`rc=0`, no guard) and green
   after (`rc=1`, `genesis: branding failed its read-back: counts ['0', '0', '0'], want ['4', '1', '1']`).
2. **B6's original mtime criterion was not ours to assert.** The real fossil global config
   (`%LOCALAPPDATA%\_fossil`, db.c:2366) is a shared machine resource — any process's `fossil all add`
   moves its mtime (run 4 caught one at 10:09:35 while isolation was intact by content). B6 now
   asserts: live org mtime unchanged; NO row of the real config names this probe; the scratch config
   is the one that got the repo entry.
3. **The probe leaked a process in its own red path:** on pre-change code B9's init ran to completion
   and started an orgd. Run 6's cleanup collected and killed it (`killed [26384, 18024, 27732]`).

## Residual

- `plans/2026-10-08_org-portable-home.md` line 106 still calls `branding.sql` "(cosmetic, not
  referenced by init)" — stale since this change; that plan belongs to another session (S9 open),
  left for its owner.
- B6 pins the string `genesis-branding` (this directory's name): a re-run from a renamed directory
  needs that needle updated.
