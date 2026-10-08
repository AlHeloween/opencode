<!-- intention: hidden test-only ORG_HOME/ORG_PORT in three copies + PATH-first fossil + fossil-CLI reads -> one shared resolver as SUPPORTED settings, bundled fossil outranking PATH, reads through org.py verbs only, documented in Protocol and the kernel add-on (plan 2026-09-30_robot-installer.md B1f) -->

# Org portable home — `$ORG_HOME`/`$ORG_PORT` as supported settings

- sv: { keywords: { org-portability 0.30, org-home-port 0.22, protocol-wake-contract 0.18, fossil-resolution 0.16, read-verbs 0.14 },
        dominant: "The organization becomes portable: ORG_HOME/ORG_PORT supported through ONE resolver, a bundled fossil outranking PATH, reads through org.py verbs only, documented in Protocol and the kernel add-on." }
- Owner, 2026-10-08: «вся наша корпорация агентов была переносимой». Requested by the Installer session for
  `plans/2026-09-30_robot-installer.md` box B1f (component `org` = `scripts/org-genesis/**`).
- Requested by: Installer session (t14-org-portable-home). Kernel part STOPS before `--install`: Claude reviews
  the kernel diff and decides.

## Premises (grounded in code, 2026-10-08)

- `init.py:28/31`, `org.py:53/56`, `orgd.py:44` each resolve `HOME = $ORG_HOME or ~/.org` and `PORT = $ORG_PORT or 8079`,
  commented «test fixtures only» — three copies, no shared source.
- `init.py:36-40` `find_fossil`: explicit -> `$FOSSIL` -> PATH (no beside candidate). `org.py:61-65` / `orgd.py:62-66`:
  `$FOSSIL` -> PATH -> beside. Reversed from the requirement: a bundled fossil beside the scripts loses to PATH.
- This host: `C:\Windows\fossil.exe` on PATH; no fossil beside the scripts today; the real server already binds
  127.0.0.1:8079 (+[::1]) via `--localhost` (`main.c:3282` «Listen on 127.0.0.1 only»).
- `fossil wiki export PAGE ?FILE?` with no FILE writes the page to stdout (`wiki.c:2205/2345`, trimmed + "\n");
  `fossil sql` executes `.shell`/`.system`/`.output` even under `--readonly`, and `wiki export PAGE FILE` writes FILE
  (installer's measurement, fossil 2.28, 2026-10-08) — so agents must read through org.py only.
- A fresh fossil repo has NO `chat` table until the first `chat send` (`chat.c:328` `chat_create_tables`);
  `orgd.assignee_session` reads `chat` unguarded -> crash on a born-empty org.
- Kernel caps (tests, not to be raised): G0+G1 section <= 6_800 B (`test_render.py:487`), product render <= 8_200 tok
  (`test_dedup.py:183`), codex <= 8_250 (`test_addons_codex.py:116`), cursor <= 8_400 (`test_addons_cursor.py:91`),
  claude <= 8_350 (`test_addons_claude.py:135`). `VCS_ROLES` must stay byte-identical across the four registries
  (`test_variant_parity.py:40`). Headroom today: ~99 B / ~26 tok — the edit must be ~neutral in size.
- `init.py:134-137` commits the wiki page `Protocol` from `GENESIS/Protocol.md` on every run — the wiki page update
  path is: edit the file, run init (never `fossil wiki commit` by hand).

## Tasks

- [x] **S1 — `scripts/org-genesis/orgcfg.py` (new): the ONE resolver.** `HOME`/`ORG`/`PORT`/`GENESIS` + `find_fossil(explicit=None)`
  with order `explicit | $FOSSIL -> beside these scripts (fossil.exe, fossil) -> PATH`, `None` when absent; docstring
  states the settings are supported (portable install: `<install>/org`, born empty), not fixtures.
- [x] **S2 — `init.py` imports orgcfg.** Local `HOME/ORG/GENESIS/PORT` + `find_fossil` deleted; `--fossil` still first;
  every run prints the fossil binary it chose (requirement 2). `ROBOTS` gains `claude-worker`, `codex-worker`
  (idempotent user creation, random password never printed, caps `Cnrwcjfkm`). Docstring updated to `$ORG_HOME`/`$ORG_PORT`.
- [x] **S3 — `org.py` imports orgcfg.** `find_fossil` order from orgcfg. New read verbs (the agent allowlist needs only
  `"<python>" "<ORG_HOME>/genesis/org.py" *`):
  `inbox [--json] [--no-presence]` (JSON = one document on stdout; `--no-presence` skips session discovery and posts
  NO chat line), `chat --since <msgid>` (chat table, tolerant of the table not existing yet), `wiki <page>` (text to
  stdout via `fossil wiki export PAGE` — no FILE argument), `protocol` = `wiki Protocol`. No raw-SQL/pass-through verb;
  no verb writes a caller-named path.
- [x] **S4 — `orgd.py` imports orgcfg**; `assignee_session` guards the missing `chat` table (born-empty org must not
  crash the heartbeat; the `why` string flows into the existing once-per-change log).
- [x] **S5 — `Protocol.md`** (+wiki via init): new "Where it lives (settings)" section (`ORG_HOME` default `$HOME/.org`,
  `ORG_PORT` default 8079, server binds 127.0.0.1 only, `FOSSIL` precedence, portable install born-empty); login taxonomy
  (`claude`/`codex`/`antigravity` interactive, `smit-<project>` resident, `<runtime>-worker` subscription workers; a worker
  never takes the interactive login; poll-only logins never post PRESENCE); wake contract by host kind (resident woken by
  orgd via PRESENCE; a worker without a host API polls `inbox --user X --json --no-presence` ~10 min and orgd never tries
  to wake it); read verbs + security note (why `fossil sql`/`fossil wiki export` are not for agents); rule 4 port named as
  `$ORG_PORT (default 8079)`; page sv updated.
- [x] **S6 — kernel `VCS_ROLES` x4** (`addons.py`, `addons_claude.py`, `addons_codex.py`, `addons_cursor.py`, byte-identical):
  name `$ORG_HOME (default $HOME/.org)` + `127.0.0.1:$ORG_PORT (default 8079)`; read Protocol via
  `python $ORG_HOME/genesis/org.py protocol`. Size ~neutral. `python -m pytest prompt_kernel/tests/ -q`;
  update the five cap comments with the measured values (caps NOT raised). **STOP honoured — `--install` NOT run; gated on Claude's review (S9).**
- [x] **S7 — oracle harness** `experiments/2026-10-08_org-portable-home/smoke.py` + README: runs the scripts from a
  scratch copy (genesis + real fossil beside) against a scratch `ORG_HOME`, decoy fossil first on PATH; asserts the
  cases in § Smoke Tests; prints the real `~/.org/org.fossil` mtime before/after; kills the scratch server/orgd it started.
- [x] **S8 — run + record:** baseline (pre-change, expected red on the new-feature cases — predictions in § Smoke Tests),
  post-change green; `_progress_log.md` entry; commit naming this plan; install genesis copy to
  `%USERPROFILE%/.org/genesis` + run init there (wiki page + worker logins) ONLY after the oracle passes.

- [ ] **S9 — kernel `--install` (production, claude, codex, cursor) + receiver refreshes — GATED** on Claude's review verdict
  on the kernel diff (the declared stop of S6; the task: «STOP before --install»). Lift: the verdict arrives; then re-run
  `pytest prompt_kernel/tests/` — expect fully green — and re-stamp/install the four receivers.

## Smoke Tests

Harness = `experiments/2026-10-08_org-portable-home/smoke.py` (black-box: subprocesses only). Predictions per case
(trader's rule — an off-prediction outcome is a divergence, logged):

| # | case | pre-change prediction | post-change prediction |
|---|------|----------------------|------------------------|
| C1 | scratch init creates org.fossil under scratch `ORG_HOME`; server answers on 127.0.0.1:scratch port | PASS (env already works) | PASS |
| C2 | netstat shows 127.0.0.1:port only (no 0.0.0.0/[::]) | PASS | PASS |
| C3 | init prints the chosen fossil; with decoy first on PATH and one beside -> the beside one | FAIL (nothing printed) | PASS |
| C4 | control: beside renamed away -> decoy (PATH) is chosen (fixture bites) | FAIL (no print) | PASS |
| C5 | `$FOSSIL` outranks beside | FAIL (no print) | PASS |
| C6 | `inbox --json --no-presence` returns the READY ticket as JSON; chat row count unchanged | FAIL (no flags) | PASS |
| C7 | `chat --since` on a fresh org answers empty (no table yet); after heartbeat returns the line | FAIL (no verb) | PASS |
| C8 | `wiki Protocol` == Protocol.md content; `protocol` alias same | FAIL (no verb) | PASS |
| C9 | `.shell`/`.system`/`.output` as arguments: exit non-zero/2, no command runs, no file appears | PASS (vacuous — no verbs to abuse) | PASS |
| C10 | init twice -> `claude-worker`+`codex-worker` exist exactly once | FAIL (not created) | PASS |
| C11 | orgd alive ~20 s after a READY ticket lands on the born-empty org (missing chat table) | FAIL (crash) | PASS |
| C12 | real `~/.org/org.fossil` mtime unchanged across the whole scratch phase | PASS | PASS |

## Risks

- R1: kernel size caps -> trim the new wording, never raise a cap (owner's call).
- R2: after the kernel edit the three receiver-staleness guards are red BY CONSTRUCTION until the reviewed
  `--install` runs (`.claude/reasoning_kernel.md` is tracked; `dist_codex`/`dist_cursor` stamps are local).
  Reported as such; not hand-edited.
- R3: scratch runs leave `fossil all add <scratch>` in the user's fossil config and a scratch server/orgd — harness
  kills both; the `all` residue is named if not removable.
- R4: if C12 goes red the oracle stops — the real org was touched and must be investigated before anything else.
- R5: `init.py` on the real org after the oracle is REQUIRED (wiki page + workers) and is the sanctioned idempotent
  path (AGENTS.md); it rewrites ~/.org/org.fossil's wiki page — deliberate, after the mtime window.

## Out of scope

- The installer's B7 scheduler registration (`b7` logins/ticked hosts) — this plan only guarantees init.py creates the
  worker logins idempotently; a login with no worker is inert.
- `opencode_host.py` (vendored, unchanged), `ticket-schema.sql`, `branding.sql` (cosmetic, not referenced by init).
- Kernel `--install` for any variant (production/opencode/claude/codex/cursor) — gated on Claude's review (S9).

## Evidence (run ids, 2026-10-08)

- smoke: first baseline 20261008T053212Z_c4622ac3 (fixture bug: delegate authored as a non-existent login), fixed
  baseline on HEAD scripts 20261008T053446Z_b3d80b32 (**4/12**, the predicted reds incl. the orgd crash on the missing
  chat table), post-change 20261008T053856Z_13279496 (**12/12**, `smoke-results.json`).
- pytest: baseline 20261008T053148Z_7c248f9e 145 passed; post-edit 20261008T053550Z_136ddf9b **3 failed / 142 passed**,
  all three the install-gated receiver guards (production prompt, .claude, .cursor); caps measured by
  `measure_caps.py` (product 8_048 tok / G0+G1 6_730 B; claude 8_326; codex 8_210; cursor 8_395).
- install: 8 files sha256-verified into `%USERPROFILE%/.org/genesis`; `init.py` there run 20261008T054008Z_8a5e816d
  (exit 0, idempotent); `org.py protocol` on the live org serves the new text (8 917 B); `claude-worker`/`codex-worker`
  ×1 in the live user list.
