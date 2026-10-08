intent:
Root AGENTS.md — project-wide governance and conventions for opencode.
Paradigm, agent rules, coding standards, KV cache, backup, testing.

state:
  default_branch: Local_Development
  upstream: none — total divergence, measured 2026-09-17 against a local copy of
    opencode 1.18.29: 190 source files share a name and ZERO are byte-identical;
    365 upstream files vs 612 ours; 90 upstream-only, 234 ours-only. There is no
    merge surface. Model data comes from models.dev plus our own provider-sync,
    not from upstream, so upstream has no functional role at all.
  paradigm: outer-loop fractal prior + continuous memory + reuse + smoke

scope:
- project paradigm
- agent governance
- coding standards
- security
- bug policy
- KV cache continuity
- checkpoint system
- plan maintenance
- style guide
- backup & restore
- fossil snapshots
- path architecture
- testing
- TUI testing (cmd_runner)
- auto-generated code
- dependency catalog
- agent inventory

constraints:
- See `prompt_kernel/` for the reasoning kernel (`source.py`)
- Default branch is Local_Development, NOT main (dev has architectural divergence)
- Never expose secrets to public git
- Silent catch {} blocks are bugs — every catch must log
- Plan-to-code gaps are bugs — correct immediately
- When behavior moves, its test suite moves in the SAME change — a stale or red suite left behind is a collected defect, not history («код меняем, тесты не правим, говно собираем», owner 2026-09-21; the fossil swap 2026-07-04 shipped without its test file and snapshot.test.ts sat red for 2.5 months)
- KV cache must be byte-stable across session turns
- **Never run neural networks on the CPU** — this host has a GPU. Pin the device explicitly
  (`device="cuda"`, `torch.cuda`); a launcher quirk (a broken `torch.distributed` probe, no default
  device) is a reason to pass the device BY HAND, never a reason to fall back to CPU. Owner,
  2026-09-22, verbatim: «у нас GPU есть, добавь в agents.md - никогда не ранать нейронки на
  процессоре.» An embedding run that takes minutes on cores and seconds on the GPU is not a slow
  probe, it is a misconfigured one — and it was a misconfigured one here, broken by an explicit
  `device="cpu"` written to dodge an unrelated torch error.
- **Never edit source with a direct, UNVERIFIABLE script — and before the edit, ask codegraph what it touches.** Source
  changes go through `edit` / `write`, by hand, and the hand is informed: call
  `codegraph` (impact / explore) FIRST to confirm the blast radius, so the change is bounded by
  evidence and not by the two files the author happened to have open. After the edit the oracle
  answers the same question with runtime evidence — the two are not interchangeable, and neither
  replaces the other. Owner, 2026-09-22, verbatim: «Руками блин.», «Добавь в agents.md - никогда не
  редактируй код скриптами.», «Более того перед правкой надо вызывать codegraph чтобы подтвердить
  что ничего не полетело это тоже в agents.md.» A script that rewrites source carries its own anchors,
  computes its own diff and reports its own success: nobody reads the seam, a stale anchor is
  indistinguishable from a fresh one, and the read-before-edit that makes a change reviewable never
  happens. Measured the same day, which is where the rule comes from: a 75-line `cut.py` removed ~400
  lines of dead sidecar machinery by anchor and saved nothing — the seam still had to be re-read by
  hand afterwards, while the edit itself had been withheld from review in the meantime. The second
  precedent, and the one that shows what «unverifiable» costs: an agent wrote Python scripts to rewrite
  source — no syntax check before the write, no backup — corrupted the files and recovered by rolling
  back from git, which returns the WHOLE file to the last commit and takes every uncommitted change in it
  along (owner, 2026-09-29). Scripts stay
  for READING and MEASURING (a probe over the DB, a log analysis) — never for writing source.
  **ADM update descriptors are NOT scripts in this sense** (owner, 2026-09-29, verbatim: «запрещает
  редактирование исходников прямыми unverifable скриптами, adm — это другое»). An `updates/*.xml`
  descriptor (`D:\zPython\ADID_Python\updates\` is the corpus; `src/adm/` the engine) answers each
  objection above by construction: every payload is an `<update_md5_…>` block carrying its own md5 and
  size, and the md5 IS the tag name (`<update_md5_<hash>>…<content_md5_<hash>>…</content_md5_<hash>>`); the
  parser locates the payload by those raw open/close tokens, not by XML escaping
  (`src/adm/manager_methods/_stream_md5_wrapped_updates.py:113`), and an unclosed block, a duplicate content
  block or content outside an update raises (same file, lines 44/64/67/76 — read in code, not run).
  **Measured 2026-09-30 on adm 5.0.6** (`experiments/2026-09-30_adm-binary-smoke/`, both runs): the md5 is
  a change detector FOR THE REPORT, by design (owner: «это для отчёта»), not a refusal — `--apply`
  re-stamps the descriptor before parsing (`apply_descriptor.py:20-22`), a payload altered after stamping
  is applied, and `--dry-run` shows the mismatch («MD5=auto-corrected, expected … actual …»). The gap: the
  NON-dry-run report does not show it («MD5 match … no adjustments required»), so read the dry-run audit
  when the question is «was this descriptor touched». The PROCESS itself, run on an existing file: a missed
  `<find_text>` anchor aborts with the target untouched (✓); apply writes a `.baseline`, a timestamped
  backup, an in-file `ADID_ROLLBACK` block (backup/new hash, goal_id, semantics, restore command), a
  `<file>.adid.log.jsonl` ledger and the integrity report (✓); `--list-diff` shows the hunk with the
  semantics as its `Reason` (✓); `--replay-updates` prints the intent AND a semantic vector per mutation
  with an MD5 chain (✓); `--rollback` restored the file byte-identical and re-verified its hash (✓). Raw bytes between the tags: the descriptor is read as
  strict UTF-8, so a byte ≥ 0x80 fails loudly with `UnicodeDecodeError` and nothing is written (✓ safe, but
  only UTF-8-valid content passes raw). And the `binary-overwrite` template's base64 path wrote the base64
  TEXT itself (388 B) instead of the 291 decoded bytes — md5/size are computed over the text, not «on decoded
  bytes» as the template says (✗, an ADM defect to fix in `ADID_Python`); a `replace` names its exact anchor
  in `<find_text>`, so a moved anchor fails instead of landing elsewhere; `<semantics>` states the intent
  in the descriptor itself; `adm --apply` writes atomically with a baseline snapshot, rotating backups, a
  rollback block and a ledger entry, and `adm --rollback <file>` restores and RE-VERIFIES; the edit is
  never withheld from review — `adm --replay-updates [--unified-diff]` shows the intent and the exact
  hunks, `adm --list-diff <file> N` the history of one file, and `--rag` indexes the descriptors as exact
  history records keyed by `goal_id` + `target_file` (`src/adm/rag/adid_history.py`). The requirement
  that does NOT go away: the descriptor is authored after reading the code and asking codegraph what it
  touches — a verifiable mutation of the wrong thing is still the wrong thing.
- No .opencode/plans/ — only plans/ and plans_completed/
- **A plan hand-off is JOB FAILED** when any of these is true: a box its code has earned is still unconfirmed, the plan is still in `plans/` after its last item closed, or the plan's work has no commit that names it (owner, 2026-09-22) — details and rationale in § Plan Maintenance
- After plan changes, run explore agent to validate
- Tests cannot run from repo root — run from package dirs
- Avoid mocks in tests — test actual implementation
- **Run `_build.ps1` after tests and after changes — mandatory** (owner, 2026-10-03: «запуск _build.ps1 после тестов и изменений обязателен. Темп 80гиг это слишком»). It cleans `.temp/test/` and `dist/` and builds the candidate into `dist/` — never `bin/`. See § Build after tests and changes
- **Never run a full package test suite** (`bun test` with no path) — measured 2026-09-22: `packages/opencode` ran 18 minutes with `bytes_written: 0` and ~5 GB RSS, indistinguishable from a stall; name a file or a directory instead. If one was started anyway, every error in its log is RED and needs the owner's explicit clearance — see § Full package test suite (owner, 2026-09-22)
- **"Don't litter in .opencode folder"** — instruments live in `experiments/<ISO-date>_<name>/` while in use and move to `experiments_history/` when the finding is recorded; runtime data lives under `.opencode/data/`. `.opencode/` is NOT a drawer: no `.ps1`, `.mjs`, `.ts` or scratch `.json` is written there (owner, 2026-09-20: «почем каждый придурок срет в папке .opencode без резонного обоснования, вместо того чтобы использовать папку experiments или этого нет в правилах» — it was NOT in the rules; this is the rule)
- A measure and its threshold must share a SPACE (content vs request) and a SCOPE (slice vs whole window) — two spaces under one name is how a threshold silently changes meaning (2026-09-19)
- A skipped test must state WHY, and `test.todo` is NOT a test (bun never runs its body) — a bare skip hides a defect, which is a bug
- Heavy test files carry a FILE-level timeout (`setDefaultTimeout(20_000)`), never per-test whack-a-mole — bun's 5 s default turns a loaded machine into a red that says nothing about the code
- Reach every provider from the HIGHEST surface down: newest API version first, then h3 -> h2 -> http/1.1
- Tool names ARE wire ids: lowercase ASCII alphanumerics only — `_` and `-` are refused and the tool fails to load at `Tool.define`; the same spelling must appear in the registry, its `builtin` list and `util/dsml-normalizer`, or a DeepSeek-emitted call is never recognised (2026-09-19, restating 2026-08-26: `canonicalName` strips non-alphanumerics — `multi_edit`→`multiedit`, `session-read`→`sessionread`). WHY it is a prohibition and not a taste: a second spelling of a TOOL NAME is a generation bug, not a validation one — the model emits whichever variant association hands it (`-` and `_` are its standard separator habits) and the mismatch is silent, because a validator can see a typo and cannot see an association. SCOPE: tool names ONLY. This is not a naming rule for fields, keys or internal identifiers — a tool name is the one identifier the model must reproduce itself for the call to be routed (2026-09-19).

forbidden_actions:
- **Never touch `bin/` without explicit owner permission** — no edits, no replace/rename/move/copy into it, and no launching executables from it (including a version check like `bin\opencode.exe --version`). WHY: `bin/` is the owner's LIVE runtime — the running TUI executes from that folder, and in-session "bin surgery" (move-aside + copy to dodge a locked exe) on 2026-09-24 mixed 10.0.1106/10.0.1107 and broke the owner's session. Build candidates belong in `packages/opencode/dist/**`; promoting a candidate into `bin/` happens ONLY on an explicit owner request, by the owner's own procedure. Owner, 2026-09-24, verbatim: «любые правки в bin папке и запуски оттуда без конкретного разрешения - запрещены». **The one standing exception** (owner, 2026-10-03, «Разрешить sync из bin/»): `codegraph sync` and `codegraph status`, launched through `bin\codegraph.cmd` — the CodeGraph CLI exists only there. Nothing else in `bin/` is launched, and nothing there is ever edited.
- Exposing secrets (API keys, tokens, passwords, private keys) to git
- Using git push --no-verify (or any --no-verify variant)
- Using silent catch {} blocks
- Labeling errors as "pre-existing" — every error is a deliverable
- Planning from .opencode/plans/ directory
- Breaking KV cache continuity (system prompt must be byte-stable)
- Running tests from repo root
- Running the full package test suite (`bun test` with no path) — see § Full package test suite
- Changing Global.Path.home from worktree to os.homedir()
- Hand-editing ADID framework receivers — change only via kernel SPECS or ADM pipelines
- Reopening the SDK/upstream/regeneration question — see the STOP section; run the diff instead
- Regenerating packages/sdk/js/src/v2/gen or src/gen — hand-maintained source, add fields by hand
- Fetching instructions over the network — `config.instructions` URLs are ignored by design: a fetched body lands in the system prompt with instruction authority, i.e. prompt injection, and the well-known remote config can chain into such a URL. Inherited from upstream opencode; removed 2026-09-19
- Adding a new JSON file as a home for runtime state — a new surface gets a KEY NAMESPACE in the store (see § Storage Paradigm)
- Reintroducing a read-time inheritance or parent walk — a missing value is FILLED, never resolved on read
- Treating `bun run packages/sdk/js/script/build.ts` exit 0 as success — it deletes ~7100 of our lines
- Pinning a provider to a legacy API version or transport when it publishes a newer one
- Rewriting an OpenAI-compatible `/v1` path to `/v3` — that suffix is a dialect marker, not a version
- Probing the version/transport descent per request instead of recording the winning rung

invariants:
- Default branch is Local_Development — never assume main or dev exists
- Every catch block must log (debug for expected, warn("bug:...") for unexpected)
- Silent catch {} is always a bug
- Plan documents must match actual code state
- .opencode/plans/ is prohibited for plan storage
- git push --no-verify is never permitted for developer pushes
- Every provider's recorded version rung and transport rung name the probe that established them
- **Absence of an oracle reads as FALSE** — for the user a missing indicator means "it does not work": a status surface must always render a value (the policy value, e.g. `auto`, or an explicit `unknown`), never nothing. Measured 2026-09-24: the sidebar protocol row went blank for one restart and was read as «все не работает». Owner, 2026-09-24, verbatim: «для пользователя отсутствие оракула означает - false».

acceptance_tests:
- git status confirms Local_Development branch
- No catch {} without log statements
- Plan files in plans/ match actual code state
- KV cache fingerprint stable across consecutive turns
- No git push --no-verify in development workflow
- **Answer in the user's language — reasoning included, not only the final text.** An answer in another language is a failed UNDERSTAND and returns the session to G0.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `Local_Development`.
- Prefer automation: execute requested actions without confirmation unless blocked by safety/irreversibility.
- This is **not a branch of anything** — it is a separate project that shares an
  ancestor. Never port upstream architecture in, never "sync with upstream", and
  never treat an upstream diff as mergeable: the same identifier names a
  different system on each side (Hono vs Effect server, Fossil vs git snapshots,
  per-worktree vs central state). Measured 2026-09-17: of 190 same-named source
  files, zero are byte-identical.

## Language — the user's, always (auto-return to G0)

The user's input language is the language of the work: the reasoning, the reports, and the plan text written for them. A reply in a different language is **not** a style slip — it means the model drifted off the user's frame, which is exactly what G0 (UNDERSTAND) exists to establish.

**Consequence: an answer in a language other than the user's automatically returns the session to G0** — restate the Digital Intention in their language before any further planning, decomposition or mutation. Owner, 2026-09-22, verbatim: «ответ на языке отличном от языка пользователя автоматически перемещает в G0».

**Why a language slip resets the whole loop and not just this rule.** G0 already carries the phrase («Always think and respond in the user's input language — reasoning included»), so a reply in another language is not a defect *of the language rule* — it is evidence that **the kernel is not executing**: the gate that was supposed to be in force at step zero was skipped, and everything built on it (decomposition, plan, envelope, closure) was built on a skipped gate. That is why the move is to G0 and not a correction in place. Owner, 2026-09-22, verbatim: «в G0 есть фраза про язык, если она не выполняется — значит кернел не выполняется».

Reasoning is part of the answer: a report in the user's language over an English chain of thought is still a violation — and it is the one that hides, because only the final text is visible.

Technical identifiers, commit subjects, code and quoted log lines stay in English; the prose around them does not.

---

## STOP — the SDK/upstream question is CLOSED. Do not reopen it.

**This question has been raised and re-answered three times (latest 2026-09-17).
Every time, the cost was hours spent theorising instead of one diff. Read this
section and move on.**

### If you are about to think about upstream, regeneration, or "syncing"

Run the diff. That is the whole procedure. It takes one command and it settles
every version of this question:

```bash
diff -rq external/opencode-1.18.29/packages/opencode/src packages/opencode/src
```

Measured result, 2026-09-17: **190 source files share a name and ZERO are
byte-identical.** 365 upstream `.ts/.tsx` against 612 ours; 90 upstream-only,
234 ours-only. There is no merge surface, no shared file, nothing to align to.

### The conclusions — do not re-derive these

1. **`packages/sdk/js/src/v2/gen` and `src/gen` are OURS.** Hand-maintained
   source. Not generator output. **There is nothing to regenerate.** Missing a
   field? Add it by hand, like any other source file.
2. **Upstream has no functional role whatsoever.** Not architecture (Hono vs
   Effect, Fossil vs git, per-worktree vs central state — same identifiers,
   different systems). Not the model catalog either: that is `models.dev` plus
   our own `provider-sync`. Nothing in the tree fetches from upstream.
3. **`bun run packages/sdk/js/script/build.ts` regenerates with `clean: true`.**
   It exits 0 and DELETES ~7100 lines of our source. Exit 0 is not success here.
4. **`packages/sdk/openapi.json` is an orphan.** The generator writes its own
   spec to `packages/sdk/js/openapi.json` from the live server and removes it
   again; the committed file one directory up is never read by anything.
5. **`bun typecheck` cannot validate a regeneration.** Live code references the
   hand-maintained types, so a *correct* regeneration fails typecheck. If you
   find yourself using typecheck as the gate, you have already lost the thread.

### Why the gap exists, so nobody goes hunting for a missing flag

The API is described **twice**, and the generator reads the half that carries no
description: 46 `describeRoute` entries against 275 route registrations, while
108 `HttpApiEndpoint` declarations across 17 files carry **149
`OpenApi.annotations` that nothing reads** — `OpenApi.fromApi` has zero call
sites despite shipping in the installed `effect`. The Effect half enters Hono as
opaque pass-throughs (`routes/instance/index.ts:29`). That is why a regeneration
loses 422 exported types and 233 typecheck errors collapse to 12 symbols.

Completing that spec is a real project. Until someone decides to do it
deliberately, **the hand-maintained folder is the answer, not a workaround.**

### The two upstreams are NOT the same relation — do not confuse them

| | `external/opencode-1.18.29` | `external/opentui-0.5.11` |
|---|---|---|
| Ours | `packages/opencode` (612 files) | `packages/opentui` — **re-based on their 0.5.11 tree (2026-09-20)** |
| Relation | **separate project, nothing to take** | **the base of our fork; our modules are the patches** |
| Rule | never port, never sync, never regenerate | merge module by module under tests; park, never silently drop |

The prohibition above is about **opencode** upstream: there is no merge surface, so there is nothing there to
want. OpenTUI is the opposite case — and since 2026-09-20 it is no longer "reach in selectively": the
**re-base was decided and executed**.

Owner: «Может нам вообще зиг обновить выдрать наши модули из нашей версии и впихнуть в их, 0.16 это
серьёзный архитектурный сдвиг», then «Делаем как ты говоришь». Their 0.5.11 tree (Zig **0.16.0**) is now the
base of `packages/opentui/**` in the working tree; our modules are the patches. Full record:
`plans_completed/2026-09-20_rebase-on-opentui-0.5.11.md` (S0–S4, evidence per step).

The old warning named a real hazard, so it survives as the RESIDUAL LIST — parked, never silently dropped,
each entry naming where the thing went:

- **Raster/Sixel stack + the app's `rasterViewport`** — parked (git history +
  `experiments/2026-09-20_rebase-stage/pre-swap/`); it returns only when a pixel oracle proves a behaviour
  needs it. Our sixel payload cache is subsumed by their per-placement sixel cache.
- **Keymap is still our 0.4.x copy** while core/solid are 0.5.11 — a live mismatch (nothing imports it; their
  packages declare it only as a workspace devDep). Reconcile it or remove it.
- **The swap is UNCOMMITTED** and `bin/opencode.exe` still runs the old engine. "A version bump deletes it and
  nothing in CI would notice" is exactly why the commit and the calibrated-graphics pixel oracle
  (sixel/mermaid/images on the re-based lib) are named as completion criteria, not assumed.

For anything that plan does not cover, the 2026-09-17 directive still stands: "дергать без разбору лучше не стоит."

---

## Project Paradigm — Outer-Loop Continuous Development

Ship behavior by **installing priors as process** on a general cosine-native transformer, not by re-initializing weights. The inductive bias lives in the runtime outer loop: planning grammar, memory handles, working-copy impact, search, and oracles.

```
Goal → fractal task lattice → REUSE.BEFORE → implement → SMOKE.BEFORE → continuous memory → iterate
```

**No big untestable jobs.** Every unit must be searchable, doable, and smoke-testable. Advanced projects emerge from **many proven medoids**, not one cathedral plan.

| Layer | Mechanism | Kills |
|-------|-----------|-------|
| **1. Task geometry** | Fractal lattice + cosine filter + k-medoids → `CENTRAL_TASKS` | Monolith plans; goal drift |
| **2. Prior art** | `universalsearch` web/code/hybrid; local codegraph | Reinvention; guesswork |
| **3. Oracles** | Baseline [Exact] before edit; post-impl pass before `[x]` | "Works on vibes" |
| **4. Conversation memory** | Mechanistic compaction → `message*`; never delete | Memory soup |
| **5. Working-copy memory** | Fossil snapshots + CodeGraph folder-scoped impact | "What did we change?" |
| **6. Direction lock** | SV / decisions preserved; re-cluster against original goal | Silent mission creep |

Full details: [docs/architecture.md](docs/architecture.md), [docs/compaction.md](docs/compaction.md), [docs/agi-workflow.md](docs/agi-workflow.md)

### The product is a CLOSED loop — closure and safety are one property (2026-09-30)

Owner, verbatim: «любая тема должна быть экономически целесообразной и достаточно замкнутой чтобы не трахать
мозги обслуживающему персоналу», and on the statement below: «обвести в рамку и повесить на стенку».

> Closure and safety are not in tension — they are the same property. A loop that proves its own results
> and cannot leave its envelope needs neither a supervisor nor a prompt engineer standing next to it. What
> industry buys is not a clever model but a stated price per verified task and near-zero human touches.

Safety here is MECHANICS, not warnings: the envelope, an oracle per task, rollback, one store arbiter. A
loop is judged by three measured numbers per verified task — Claude/verifier tokens, robot $, and **owner
touches** (answers, restarts, manual fixes); the last one → 0 for the routine class is what «closed» means.
Sizing and blockers: [plans/2026-09-30_robot-delegation-and-orchestration.md](plans/2026-09-30_robot-delegation-and-orchestration.md) § Scaling.

### Agent obligations

- Prefer **small, named, testable** tasks over epic single-shot implementation.
- **REUSE.BEFORE** non-trivial invent; re-search on stuck failure.
- **SMOKE.BEFORE** implementation; baseline then post-impl before `[x]`.
- Treat summaries as **Inferred handles**, not Exact — recover via session-read / fossil / codegraph.
- Do not hand-edit ADID receivers; kernel + ADM own framework surfaces (why both canons exist: [docs/two-canon-protocol.md](docs/two-canon-protocol.md)).

---

## Storage Paradigm — two planes by access pattern; no ad-hoc state files (2026-09-19)

**Rule: runtime state has exactly TWO homes, chosen by ACCESS PATTERN.** Not "a relational
database plus a growing pile of JSON files per feature": SQLite for long/relational queries, LMDB
for fast keyed state. Every new piece of state goes to one of them under a declared key namespace —
never to a new file.
Owner, 2026-09-19: «мы с дуру обновились на effects вместо нормального разделения хранилищ:
sqlite для долгих запросов, lmdb для быстрых. Это принесло много неприятностей, снижения
быстродействия, крашей, и гонки эффектов.» and earlier «jsons -> lmdb с чётким разделением
ключей, ленивое обновление обратно если реально редактируем пользовательские настройки… это не
просто хранилище, оно нам развяжет все гонки по effects.»

**This is a concurrency decision, not a taste one.** Every JSON file written by more than one
effect is a race with no arbiter: two writers, two read-modify-write cycles, one lost update. A
transactional store has exactly ONE writer, serialized by the engine, so the race is *absent* —
not merely unlikely. That is the property being bought, and it is why "which file does this live
in" must never again be answered by adding a file.

### The four rules

1. **Two planes, by access pattern.** LMDB is the FAST plane: small, hot, keyed state read on the
   interactive path (settings layers, TUI KV, plugin meta, gateway store) — 0.71 µs/read and
   100 000 reads in 70.7 ms measured on this host. SQLite is the RELATIONAL plane: long queries,
   joins, history (sessions, messages, parts, jobs, balance, sync, codegraph). A new state surface
   gets a key namespace in the plane that matches its ACCESS PATTERN — it does not get a file, and
   it does not go to one engine merely because that engine happened to be closer.
2. **Strict key separation.** Namespaces are explicit and flat — `session:<id>:agent:<name>`,
   `worktree:<scope>:agent:<name>`, `global:agent:<name>` — and a reader addresses ONE key. No
   prefix scan to reconstruct a value that should have been materialised, and no reader walks a
   parent chain (rule 4).
3. **Lazy write-back.** The store is the authority for reads of committed state; the
   user-authored on-disk config is written back ONLY when the user actually edits it. Generated
   state never rewrites a hand-written config just because a process started.
4. **Fill, do not resolve.** A layer that lacks a value is FILLED from its source once, at the
   moment the layer is created; reads are then a plain lookup. `global -> new worktree ->
   session`, materialised, no inheritance at read time — see
   [plans/to_be_confirmed/2026-09-19_fill-every-settings-layer.md](plans/to_be_confirmed/2026-09-19_fill-every-settings-layer.md).

**Scope: ALL runtime state, not just settings.** Owner, 2026-09-19: «Я не про только agents — у нас
соплей море, вылезло — туда, ещё вылезло — опять туда.» Every "where does this live" answered by
creating a file is the growth this rule exists to stop. The measured inventory — including
`{state}/model.json`, which three modules already write — is in
[plans/to_be_confirmed/2026-09-19_fill-every-settings-layer.md](plans/to_be_confirmed/2026-09-19_fill-every-settings-layer.md) §7.

**The wrong turn, recorded so it is not repeated.** Owner, 2026-09-19: the storage split was NOT
done, and the effort went into adopting the effect runtime instead — «это принесло много
неприятностей, снижения быстродействия, крашей, и гонки эффектов.» Take that as the account of
what happened. The codebase's own signal corroborates the shape of the problem: ten floating
`slog.*` effects sit un-yielded in `session/prompt.ts` (lines 345, 368, 383, 817, 821, 828, 838,
985, 1028, 1252). The lesson is not "effects are bad" — it is that a concurrency story built on a
runtime framework, with no single arbiter underneath it, has nothing to serialize against. The
store is that arbiter; the framework is not.

**Accepted cost, on the owner's ruling.** LMDB keeps its file mapped, so on Windows `rmSync` of a
store directory throws `EBUSY` until the env is closed. Owner, 2026-09-19: «шанс на ebusy намного
ниже чем шанс на гонку effects.» Accepted and bounded: tests close the env. It is not a reason to
keep the JSON files. *(Re-confirmed live 2026-09-19, outside LMDB entirely: deleting the probe
directory failed `EBUSY` on an **empty** directory because a live process held it as its cwd — the
same Windows handle class, so treat `EBUSY` as "somebody still holds it", not as an LMDB trait.)*

### The engines — decided and measured, do not re-argue

**SQLite** (`bun:sqlite` + `drizzle-orm`) — the RELATIONAL plane, already installed: schema files
(`src/storage/schema.sql.ts`, `session.sql.ts`, `balance.sql.ts`, …), migrations
(`src/storage/migration.ts`), **92 call sites** across sessions, messages, jobs, balance, sync and
codegraph. It does not change.

**LMDB** (`lmdb@3.5.6`, MIT, Node-API) — the FAST plane, DECIDED 2026-09-19 for hot keyed state.
Measured on this host under Bun/win32-x64: `bun add` fetches its prebuild
(`download-lmdb-prebuilds11`) so no compiler is needed; three DBs live in ONE environment via
`openDB` and read back independently; **100 000 sync reads in 70.7 ms (0.71 µs/read)** straight from
mmap with no I/O; one `transaction()` spans two DBs; footprint `data.mdb` 262 144 B + `lock.mdb`
8 128 B.

**Native addon + `bun --compile` — MEASURED 2026-09-19.** This was the one open risk under the whole
migration; it is now measured, and the answer has two halves. `lmdb` resolves its `.node`
*dynamically*, and a compiled executable runs in Bun's virtual root (`B:\~BUN\root`), resolving such
a path against the **cwd** — so the addon is **not found even with `node_modules` sitting beside the
exe**. A **static ESM `import`** of the `.node`, by contrast, is visible to the bundler and is
**embedded into the executable**: proven by running that exe from an empty directory with the addon
file **physically deleted from disk** (`STATIC_IMPORT_OK`), while the dynamic build failed in the
same conditions — and corroborated independently by bytes, `87 000 064 − 86 087 168 = +912 896 B`
against `912 925 B` for `node_modules/@lmdb/lmdb-win32-x64`.
⇒ The fast plane **is** deployable, but only through a small per-platform import shim naming the
platform package literally, and `lmdb` also drags `@msgpackr-extract`'s addon (225 736 B). The shim
is **not yet written** and the real `bin/opencode.exe` has **not** been built with it — that is the
remaining step, not an assumption. Details: plan §8b.

Migration order (see the plan §7 inventory): `{state}/model.json` FIRST — it is the only entry with
three writers, so moving it retires a real lost-update race on its own.

## Debugging Paradigm — read state before adding a log (2026-09-19)

Owner, 2026-09-19: «раньше можно было работать грепом и всё было ок, сейчас у нас codegraph и
этого мало, трёхъярусные смоки… дебаг неудобен, **логи приходится прописывать на каждом углу
вместо того чтобы прочитать state**.»

**Measured before writing it down:** `packages/opencode/src` carries **924** `log.(debug|info|warn|
error)` call sites and **124** `bug:` markers — roughly 1.5 logs per source file. That is 924
pre-committed hypotheses about what will go wrong.

**And the evidence that they do not cover the real one — all from 2026-09-19:**

| what was found | how it was found |
|---|---|
| `jobs.db` had no `pid` column | reading state |
| fossil leaves missing after a boundary | reading state (`snapshot.fsl`) |
| window is 236 280 / 23 %, not "exhausted" | reading state (`checkstate`) |
| **`{state}/model.json` is written by THREE modules** | **no log exists at all** |

The last row is the verdict on the approach: the only genuine lost-update race in the inventory is
logged **nowhere**, because nobody anticipated a *silent* write. Logs cover the anticipated; readable
state answers questions nobody asked. That is precisely «читать state вместо логов».

**The rule.** A log may record only what STATE CANNOT SHOW:

1. **Time and rate** — latency, TTFB, a stall that has no key to live under.
2. **An external system's failure** — a provider, `fossil`, `rg`, a spawned process; the state plane
   cannot see outside itself.
3. **A transition with no key yet** — a one-shot during boot, before any namespace exists.

Everything else: **if the event has a key, it is STATE.** State is durable, two-way and queryable;
a log is ephemeral, one-way, and must be pre-placed where someone guessed the problem would be. Read
it with `dbread` / `checkstate` instead of grepping for a line you hoped would be there.

**Corollary — logging is not a fix.** «Every catch must log» still stands (a silent `catch {}` is a
bug), but it is a floor, not a licence: the 124 `bug:` markers are 124 defects wearing a log. Most of
them should be **removed by deleting the catch**, not kept as a written-down shrug. A `bug:` marker
that survives a release is an unfixed defect with a receipt.

## Hashing is NEVER the suspect — measured, do not re-litigate (2026-09-29)

Owner, 2026-09-29, verbatim: «пропиши в agents.md таким злостным образом чтобы больше ни один умник
не говорил про хеш». Written because a search cycle was spent on "maybe SHA-256 is slow" while a
20–36 s stall was on the table — and the answer was one smoke away.

| operation | data | time | throughput |
|---|---|---|---|
| `sha256`, one buffer, one digest | 100 MB | **301.1 ms** | **332 MB/s** |
| `sha256`, streamed in 64 KB chunks | 100 MB | 292.4 ms | 342 MB/s |
| `sha256`, 582 separate blocks (our block-map shape) | 100 MB | 296.1 ms | 338 MB/s |
| `JSON.stringify` | 134.3 MB | 158.9 ms | 845 MB/s |
| `sha256` of that JSON string | 134.3 MB | 469.1 ms | 286 MB/s |

Instrument: `experiments/2026-09-29_fossil-boundary-cost/sha256_100mb.mjs` — bun + `node:crypto`, the
runtime the product actually ships. Run `20260929T172314Z_b55137cf`. **Re-run it only if the HOST or
the runtime changed, and then update this table** — re-running it to re-argue the question is the
churn this section exists to stop.

**The arithmetic that ends the argument.** At 332 MB/s a stall of 20 s needs **≈6.6 GB** hashed; 36 s
needs **≈12 GB**. This repository's entire session store is 9.7 MB of part JSON and 1.09 MB of text —
hashing all of it costs **≈29 ms**, three orders of magnitude below the stall. And "but it hashes
every block" is already in the table: 582 blocks of our block map measured 296 ms at TEN TIMES our
data volume. There is no version of "the hash is the bottleneck" that survives these two lines.

**The general rule this section is really about:** **a stall of seconds over megabytes is a WAIT, not
a count.** Throughput work scales with the data; a wait does not. When the data is small and the stall
is large, the cause is a lock, a socket, a timeout, an MCP handshake, a plugin, or a branch that
sleeps — never a loop over data that small. Reach for a phase timer, not for the primitive.

**Also excluded in the same hunt, each by measurement — do not re-suspect these either:**
fossil at the turn boundary (`changes` 0.144 s, `addremove -n` tree walk 0.644 s over 10,913 tracked
files); the status-note plan scan (`planFiles` + `collectPlanState` + `planDebt` + `criticalRisks` =
~10 ms); the status-note window functions (`couplingFindings` 7.0 ms, `statusMarks` 0.3 ms,
`statusVector` 0.1 ms, `JSON.parse` of 9.7 MB = 44 ms); the checkpoint disk path (`decryptBaseline`
of 0.94 MB = 5.8 ms, `JSON.parse` of 950 117 chars = 11.3 ms, `reusablePrefixLength` over 588
messages = 0.1 ms); the provider itself (`ttftMs` 51 ms). Full numbers and probes in
`experiments/2026-09-29_fossil-boundary-cost/`.

## Granularity — every mechanism gets the scale it serves, and nothing finer (2026-09-29)

Owner, 2026-09-29, verbatim: «Fossil кстати тоже, мы его четко вызываем только для снапшота и он
гранулирован началом хода, и все ну и перед undo чтобы можно было сделать redo. Тулы должны работать
сами. Как говорится можно успеть секунда в секунду - только вопрос - ради чего, средний ход 10 минут,
64к токенов это 20 минут. Вот тут опять вспоминается Lean and DISAS.»

**The scale: a turn ≈ 10 minutes; a 64k-token summary window ≈ 20 minutes.** Every mechanism is granted
the granularity of the scale it serves, and nothing finer. The rules that follow are binding:

1. **A tool runs at its own cadence and is asked only when its ANSWER is needed.** «Тулы должны работать
   сами» — a call placed on the turn's critical path "to keep the tool fresh" is hand-holding, and
   hand-holding is the defect. Measured case: the codegraph MCP touch costs **2.4 s** and sat on every
   commit, while the value it produced is consumed by the **summary**, twenty minutes later.
2. **Granulate by the thing you serve.** **fossil is the worked example and the standard**: called
   deliberately for the snapshot, granulated by the **START OF THE TURN**, plus before undo so redo has a
   base — not per command, not per message. A mechanism serving the summary syncs on the summary cadence;
   **nothing syncs per commit merely because a commit happened.**
3. **±10 s against a 20-minute window is noise.** Precision below the scale is not a feature to build, not
   a property to verify, and never a reason to act. «Можно успеть секунда в секунду — только вопрос — ради
   чего.»
4. **What IS worth hunting is the scale of the work.** A 20–36 s stall is a visible fraction of a
   10-minute turn and is hunted with the phase timer (`turn.prepare`) and counters. 0.144 s, 7 ms and
   332 MB/s are not hunted — measuring them is the churn this section exists to stop.

## Content Lifecycle — self-cleaning content (2026-09-19)

Owner, 2026-09-19: «здесь не просто экономия токенов здесь самоподчистка контента, то что человек
делает автоматом и то что в большинстве агентных систем отсутствует на прочь, это сильно снижает
эффективность размазывая внимание нерелевантной информацией». The attended window must hold what the
CURRENT task needs; released content stays reachable without occupying it. Full design:
[docs/content-lifecycle.md](docs/content-lifecycle.md).

| verb | mechanism |
|---|---|
| **acquire** | a tool result arrives (`read` / `webfetch` / `codegraph` / …) |
| **hold** | resident until the request goes out — the rendering is a PURE FUNCTION of the part, so it never changes after it is sent |
| **release** | `> 8 000` chars → an ID-addressed placeholder in EVERY request; or `recall(…, keep: true)` → only the chosen slice |
| **re-acquire** | `recall(id, range, pattern)` returns the stored result by its address |

**Invariants — each one cost a defect to learn:**

1. **Never reduce without printing an address.** A drop with no way back is a loss, and "re-read or
   re-run the tool" is not a way back: a `task` result cannot be reproduced and re-running `bash`
   re-applies its side effects.
2. **A reduction must never blank content.** Both guards are required — the producer refuses a
   selection that selects nothing, AND the consumer treats an empty selection as no selection.
3. **Release replaces on the wire; it never deletes.** The full text stays stored and stays reachable —
   `keep` narrows what replays, it does not shrink the record.
4. **The status with no release path is the one that grows without bound.** Errors had no size gate at
   all, so `keep` matters most there.
5. **A narrowed selection carries a `reason`** — narrowing history without a motive is a silent edit.

**Corollary — verify a reduction where it LANDS.** `keep` was reported "shipped and verified" and had
never written a byte: a part's identity lives in the `part` table COLUMNS, the lookup read only `data`,
and an `as` asserted the missing `sessionID` into existence. `bun typecheck` exit 0 and three green
suites missed it; **one live call against the real database found it**. A cast in a write path is a
disabled oracle — type the value; and a fixture's schema must match production's, or it cannot observe
the wrong query.

**Shipped 2026-09-30:** attachments ARE re-acquirable — a released `file` part names its own id on the
wire and `recall` returns its payload (commit `18fe82c426`); `keep` is refused for one, since an
attachment is a single payload and a kept slice would send the provider a truncated data URL. **Still
planned, not shipped:** nothing counts a lifetime for an attachment, and the actualizer and its ledger
are unbuilt. The generalisation to
*temporary data acquisition* is in [plans/to_be_confirmed/2026-09-19_temporary-data-acquisition.md](plans/to_be_confirmed/2026-09-19_temporary-data-acquisition.md):
a document, a set of sources, a screenshot — acquire, hold for a declared span, release, and let the
recorded diffs be the report's evidence.

## Continuity Paradigm — the invariant the project exists for (2026-09-19)

Owner, 2026-09-19: «у нас очень важное размышление которое раскрывает суть проекта - максимально
возможная агентная непрерывность - AGI в идеале.» The outer loop installs priors as process, and every
prior is only as good as the agent's continuity across a boundary: a plan whose evidence was folded
away, a decision whose reason went unrecorded, an edit whose call left no trace — each forces a fresh
grounding pass, and the passes are what an agent spends its life on. **Maximum continuity is not
"remembering more"; it is being able to act without re-deriving** — the difference between a long
session and a session that keeps restarting.

Three rules, each bought by a defect the agent could not diagnose about itself:

1. **The tail is INVIOLATE.** «32к токенов хвоста должны быть неприкосновенны иначе это ломает тему…
   если edit write был - значит был… если это корректировать то мы нарушаем chain of thoughts.»
   Compression belongs in `memory` and in summaries-with-diffs. In the tail: nothing compressed,
   nothing dropped, and BOTH halves of every tool exchange kept — the result AND the call.
2. **The tail is CONTIGUOUS with what the summaries COVER.** «все сообщения до предыдущего summary
   если оно где нибудь не вызвалось надо забрать весь контент до него. Чтобы не было s..s..s xxxxx
   (what happened there) xxx 32k tokens?» 32k is a floor that reaches further BACK; the boundary is
   the newest COVERED message, so a late summary cannot leave a hole — and `m*` names one if it exists.
3. **Nothing hidden without representation, and the representation is CHECKABLE.** `m*` closes with a
   range accounting (summaries `#a..#b`, tail `#b+1..#c`): `no gap` — with the rows the selector omits
   by design NAMED, never counted as holes — or a `GAP` with its count. A decision carries its reason:
   `compact`'s `reason` is required and echoed into the tool's own output.

**Falsifier:** if you have to go and CHECK what your own window held, the boundary broke continuity.
The saving is a token; the cost is a recall turn. Full design:
[docs/compaction.md](docs/compaction.md) § "Continuity is the invariant this file exists to serve".

## Bug Policy

- No such thing as an "unimportant" bug. Every bug degrades the tool — fix it.
- **There are NO pre-existing errors.** Every typecheck/test failure is a deliverable.
- **Bugs block push.** All bugs must be fixed before `git push`. No `--no-verify`.
- Silent `catch {}` blocks are bugs — must log (debug for expected, warn for unexpected).
- **The direction of change is one-way: tests adapt to the functionality, never the reverse.**
  Owner, 2026-09-30, verbatim: «Ты только смотри не вздумай подстраивать функционал под тесты.
  Тесты подстраиваются под функционал, а не наоборот иначе в них пропадает какой либо смысл.»
  A red test is a question about the TEST only against the REQUIREMENT — never a licence to soften
  the assertion or the behaviour. When the requirement itself moves, the test moves in the SAME
  change WITH its provenance and is re-pinned at least as tightly as before. Measured 2026-09-30
  while fixing `grep`'s output contract: an existing assertion `toContain("Line 2: line2")` was
  replaced by `toContain("Line 2")` + `toContain("line2")` so the suite would go green — the reverse
  direction, and it dropped the contract, since `"Line 2"` is satisfied by `"Line 20"` and stays
  green when the col/offset fields vanish entirely. Corrected to the exact new string
  `"Line 2, col 1, offset 6: line2"`.
- **A test that can silently assert nothing is not a guard.** `test/tool/registry.test.ts` carried
  `if (!planTool) continue // tool only in build (e.g. edit/write vs applypatch)` — a loop whose
  comparison skipped every tool the other catalogue lacked, while the same file asserts three tests
  above that the two catalogues have identical fingerprints. A conditional `continue`/`return` inside
  an assertion loop, an `if (!x) return` before a check, a bare `test.skip` without its reason: each
  turns a red into a green that says nothing, and the comment next to it reads like a justification.
  **Replace the condition with the assertion it was standing in for** (here: compare the key sets), so
  divergence FAILS. Found 2026-09-30 while trimming the tool catalog, where the same `applypatch` the
  comment excused turned out to be measured-dead — `plans/2026-09-30_tool-catalog-trim.md`.
- **A tool's documented contract is a claim, and it is falsifiable — test it, never inherit it.**
  `multiedit` promised «if any edit fails … none are applied — the file is rolled back» while
  implementing no rollback at all: it ran one `edit` per entry and `edit` writes immediately, so a
  later failure left the earlier edits on disk and the report named only the failing entry. Found
  2026-09-29, hit again 2026-09-30 — and the response to the *first* occurrence was a habit («read
  STATE after any edit, never the report»), which @KAIZEN forbids repeating. Repaired the same day:
  every entry is now resolved against an in-memory buffer first and the file is written **once**, so a
  failure writes nothing; the matcher is imported from `edit.ts` rather than re-spelled. Guard:
  `test/tool/multiedit.test.ts` (the tool's FIRST test), proven fallible by a mutation check —
  `plans/2026-09-30_multiedit-atomic-application.md`,
  `experiments/2026-09-30_multiedit-partial-apply/`. The rule, generalised: when a tool's description
  makes a safety promise, an untested promise is a defect waiting for its second occurrence; the
  countermeasure is a test that fails without the guarantee, plus the honest report.
- Plan-to-code gaps are bugs — correct immediately.
- **Write-path oracles inspect the artifact.** Any change to a PERSISTENT_WRITE path (config/file/DB writers) is verified by reading back what was written (artifact shape / end-to-end), never by typecheck or resolver unit tests alone — a green oracle pointed at the wrong layer is how the duplicate routing writers shipped (2026-09-02). User-reported defects in deterministic, testable classes are process failures, not service events.

---

## KV Cache Continuity

System prompt is **byte-stable** across all turns — no dates, no counters, no mutable markers. SHA256(system prompt) → prefix cache hits → minimum recomputation.

**Before modifying prompt/system code:** assess KV cache impact. If risk exists, flag with `[KV-CACHE RISK]` and provide cache-safe alternative.

Key files: `src/session/system.ts`, `src/session/prompt.ts`, `src/provider/transform.ts`, `src/session/llm.ts`, `src/session/compaction.ts`

Full details: [docs/architecture.md](docs/architecture.md) § KV cache, [docs/compaction.md](docs/compaction.md)

---

## Conversation Checkpoint System

Per-model encrypted checkpoints eliminate per-turn prompt assembly. Path system frozen until compact — AGENTS.md/skills/rules edits mid-session do not rebuild system prefix. Checkpoint removed on compact; next turn saves fresh.

Full details: [docs/architecture.md](docs/architecture.md) § Checkpoint, [docs/compaction.md](docs/compaction.md)

---

## Plan Maintenance

### The DIRECTION lives in `plans/MASTER_PLAN.md` — read it before the first edit of a session

This file says **how** to work; [`plans/MASTER_PLAN.md`](plans/MASTER_PLAN.md) says **what is being worked on
and why, right now**. It lives WITH the plans because that is where a reader looks — «master plan должен быть
в планах, а не в корне иначе его никто читать не будет» (owner, 2026-09-30) — and it is canon, not a plan: the
plan scanner skips it by name (`NON_PLAN_FILES`) so neither the status nor `reconcilePlans` can ever file the
map of all work into `plans_completed/`. It is the entry point for any agent — this repo's, or a different
environment that simply read the repository — and it must be readable by an agent that has never seen this
session, without guessing:

- **every** active plan carries its own SV (keywords + dominant): «sv для каждого субплана, таска или линка
  обязателен, чтобы было четко ясно — нафига это все и с чем это коррелирует» (owner, 2026-09-29);
- every in-flight task carries its manifest: sv, plan ref, `eta_turns`, state, oracle;
- a number there that disagrees with a plan file means the plan file wins and `MASTER_PLAN.md` is regenerated.

**The renderer WORKS — RUN IT, never hand-maintain the body.** `svm render` (plan S4) rewrites everything below
the `<!-- generated below -->` marker from the plan files + the SVM store, and preserves the hand-owned head
verbatim. **Measured 2026-10-01:** two consecutive renders reported the same 27 595 B, and the second one's own
`gapsBefore` was `[]` where the first had NAMED two unmapped plans — the run closed the gap and the check
confirmed it closed, which is why the coverage claim is two-sided and not a silence. `planstatus` prints that
coverage line whether it is clean or not («Master plan: every plan under plans/ is named in
plans/MASTER_PLAN.md.»), by design: a check whose silence cannot be told from its absence is not a check.
**What is still open is the VECTOR AUTHORING, not the renderer** — a render prints `MISSING` where a source has
none, and as of 2026-10-01 that is 2 plan SVs, 65 task SVs and 94 manifests. Those are authored in the plan
files and the SVM store, never here; the map only PRINTS them.
*(History: this pointer did not exist until 2026-09-30 — AGENTS.md never mentioned `MASTER_PLAN.md`, so the
"any agent picks it up on autopilot" property held only for an agent that happened to list the repo root.)*

### The rest

- Active plans in `plans/` (repo root). Completed → `plans_completed/`.
- **Never use `.opencode/plans/`.**
- After implementation, audit `plans/*.md` — mark `[x]` if code confirms done.
- **PRE_FLIGHT smoke gate:** plan must have `## Smoke Tests` (or `smoke: N/A`) before any edit.
- Plan-to-code gaps are bugs.
- Use `messagesearch` to verify task completion before implementing.
- After moving to `plans_completed/`, scan active plans for stale references.

Tool: `packages/opencode/src/util/plan-status.ts` — `reconcilePlans()` auto-moves completed plans. See [docs/agi-workflow.md](docs/agi-workflow.md).

### JOB FAILED — a plan is not finished by shipping code

A unit of work is **JOB FAILED** — not "mostly done", not "code landed" — when any of these is true at hand-off:

1. **No confirmed box.** The plan still carries `- [ ]` for work that is actually done, or `[x]` for work that is not. Both are the same lie in opposite directions, and both make the plan unreadable to the next cycle. A confirmed box means **the acceptance declared in the plan was run and passed** — never that the code "looks right".
2. **The plan is still in `plans/`.** After the last open item closes, the file moves to `plans_completed/` **in the same change**. Tool: `reconcilePlans`. Known blindness: `collectPlans` is flat (no recursion), so a plan inside `plans/emergency/`, `plans/futures/` or any archive subdirectory is **invisible** to the mover and must be moved by hand — that is not an excuse, it is part of the job.
3. **No commit for the plan.** One plan's work lands as one coherent commit (or a short series that names the plan), so plan and diff can be read together. Work spread over unrelated commits with no reference to the plan is indistinguishable from a lost job.

Owner, 2026-09-22, verbatim: «Отсутствие подтвержденной галки в плане, не перемещение в plans_completed или отсутствие общего коммита на план — считается **JOB FAILED**.»

**Why this is a failure and not bookkeeping.** A plan whose boxes, folder and commit disagree with its code has to be re-derived from scratch by the next cycle — the cost is paid again at every hand-off. Measured 2026-09-22: the project's own status footer read `152/181 plans 395/576 tasks (84%) misplaced:23` while **181 tasks sat open in the visible set alone**, ~121 archived plans were outside the count entirely, and 23 files contradicted their own placement. That footer is what "eternal DRAFT" looks like from the outside.

### A commit is NOT closure

A commit — however green its oracle — is **not by itself grounds for G9**. To close a unit of work the commit must be accompanied by one of:

1. a **confirmed box** in the plan, earned by an **artifact** (a run id, a hash, a rehearsal log) — never by the code "looking right"; or
2. the plan's **move to `plans_completed/`**, and only when the plan is **fully complete**.

Owner, 2026-09-22, verbatim: «коммит не сопровождаемый подтвержденной артефактом галкой в плане или перемещением плана в plans_completed, при условии полной завершенности — поводом для G9 не считается.»

**Why.** A commit is a change to the TREE; closure is a statement about the PLAN. Taking the first for the second is exactly how a session lands a dozen commits and leaves every plan open — the "eternal DRAFT" measured the same day above. When reporting, name the box and its artifact; if there is no box, the work is not closed, whatever the commit says.

---

## Style Guide

Follow [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) and [MetaMask TypeScript Guidelines](https://raw.githubusercontent.com/MetaMask/contributor-docs/372c7b31e951ffec2f71a706099b3df68e4b5f7a/docs/typescript.md).

```python
STYLE_RULES = {
    "general": [
        "Keep things in one function unless composable or reusable",
        "Avoid try/catch where possible",
        "Avoid the 'any' type",
        "Use Bun APIs when possible (Bun.file())",
        "Rely on type inference; avoid explicit annotations unless needed for exports",
        "Prefer functional array methods over for loops",
        "Use type guards on filter to maintain type inference",
    ],
}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

---

## Backup & Restore

`edit` tool auto-creates `.bak` backups in `{worktree}/.opencode/data/backups/<sessionID>/`. Max 50 per session. To restore: copy `.bak` over original.

---

## Fossil Snapshot System

Agent snapshot / undo-redo timeline only. **Git** is project VCS.

- Repo: `{data}/fossil/{projectID}/snapshot.fsl`
- Binary: `external/fossil/fossil.exe` or `tools/fossil.exe`
- **The snapshot backend is Fossil — git/jj are NOT alternatives.** `test/snapshot/snapshot.test.ts` was written for the git backend (`864041ba3f`, 2025-09) and the Fossil port (`63e088ff7d`, 2026-07-04) shipped without it: its reds were a stale SPEC of git, not a defect list of the code. Re-baselined 2026-09-21 to the Fossil contract. A red test there is never a reason to move code back to git — decide which side is right, record the decision, then move ONE side with evidence.
- **The pinned Fossil source is in-tree**: `external/fossil/fossil-src-2.28/` — version-matched to the shipped `fossil.exe` (2.28). `www/` is the docs, `src/` is the mechanism (e.g. the 15 s SQLite busy timeout at `src/db.c:2208`). Reach for it BEFORE fossil-scm.org — the web is the fallback, not the first stop.
- Undo/redo: full leaf checkout (`revertTo`), not per-file hash mix
- **Four boundaries, all BEFORE the thing they cover** (2026-09-17): the start of
  a user turn, before a sidecar summary, before an undo, before a redo. No
  decision about *whether* to snapshot and no inspection of what a turn did —
  `track(undefined)` runs `addremove`, so it catches whatever changed regardless
  of who wrote it. Fossil has no autotrack; that call is the automatic tracking.
  The redo boundary uses `track([])`: an empty *explicit* list records tracked
  modifications without conscripting untracked user files.
- Deciding from per-tool evidence instead cost shell mutations their undo
  coverage for a week: `bash`/`run`/`task`/`pipeline` emit no `filediff`
  metadata, so "zero changed files" could not tell `bun --version` from a
  command that had just created a file.

Not the same as: Git (VCS), jj (TUI detection), TUI indicator (fossil green / jj blue / git red).

Canonical docs: [docs/fossil-snapshot.md](docs/fossil-snapshot.md), [docs/startup-bootstrap.md](docs/startup-bootstrap.md)

---

## opencode Paths

Fully portable — all data under `{worktree}/.opencode/data/` (gitignored).

| Path | Target |
|------|--------|
| `Global.Path.data` | `{worktree}/.opencode/data` |
| `Global.Path.config` | executable-adjacent |
| `Global.Path.log` | `{worktree}/.opencode/data/log` |
| `Global.Path.cache` | `{worktree}/.opencode/data/cache` |
| `Global.Path.state` | `{worktree}/.opencode/data/state` |
| `Global.Path.home` | `{worktree}` (NOT `os.homedir()`) |

**TUI path display:** normalize `\` → `/` before `split("/")`. The `~:branch` format is a single display unit — do not split on `:`.

---

## Shell Command Restrictions

Runtime constitution hard-blocks shell **directory/file enumeration** and routes to product tools.

| Shell command | Status | Product equivalent |
|---------------|--------|--------------------|
| `ls`, `dir`, `tree` | ❌ BLOCK | `list` |
| `find`, `fd`, `rg --files` | ❌ BLOCK | `glob` |
| `Get-ChildItem`, `gci` | ❌ BLOCK | `list` / `glob` |
| `type`, `cat`, `more` | ❌ BLOCK | `read` |
| `for … *` globs | ❌ BLOCK | `glob` / `list` |
| `findstr` | ⚠️ ALLOWED when the real binary passes its needle smoke (2026-10-05); non-ASCII paths fail to open | `grep` (preferred fallback) |
| `echo`, `printf` | ✅ ALLOWED | stdout, not enumeration |
| `git ls-files` | ✅ ALLOWED | VCS oracle |
| `where`, `which` | ✅ ALLOWED | PATH lookup |
| `start <blocking-app>` | ❌ BLOCK | `cmd_runner start -- <app>` (background job) |
| `nssm` | ✅ ALLOWED | Permanent Windows service only — never ad-hoc detached start |
| `bun`, `tsc`, `cargo`, `make` | ⚠️ cmd_runner only | `cmd_runner start -- <binary>` |
| `cmake`, `gcc`, `g++`, `clang` | ⚠️ cmd_runner only | same |
| `rustc`, `dotnet`, `msbuild` | ⚠️ cmd_runner only | same |
| `ninja`, `go` | ⚠️ cmd_runner only | same |

**Crash-prone binaries MUST run through `cmd_runner`:**
```
✅ cmd_runner start -- bun run script/build.ts
❌ bun run script/build.ts  # crashes TUI
```

**Unknown apps are crash-prone too (owner, 2026-10-06):** «Любой экзешник кроме известных тулов из бина - crash prone.» Any executable FILE that is not a known tool (`bin/**` utilities + `git`/`python`/`node`/`pwsh`/`cmd`) is auto-wrapped into `cmd_runner start -- …` by the `run`/`bash`/`cmd` tools; without `cmd_runner` it is refused (fail-closed). A freshly built app can crash OR hang — a bare hang takes the TUI and its logs with it («TUI зависла то и логов никаких»). Bare command words (`ping`, `Get-Date`) and builtins keep the ordinary permission flow.

Override: `OPENCODE_ALLOW_DESTRUCTIVE=1` or `bypass_constitution`.

---

## Type Checking

Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

---

## Build after tests and changes — mandatory (owner, 2026-10-03)

Owner, verbatim: «запуск _build.ps1 после тестов и изменений обязателен. Темп 80гиг это слишком.»

- **When:** after any test run and after any source change, before the work is reported done.
- **How:** `cmd_runner start -- pwsh -File _build.ps1` from the repo root (a build is crash-prone in the agent shell —
  § Shell Command Restrictions); read the run's own state file for the exit code, never a tail.
- **What it does** (read in `_build.ps1`, 2026-10-03 ✓): removes `.temp\test\` (lines 69-74, 131-136) — where test
  runs leave their scratch; clears `dist/` content except a running build's state (lines 143-158); builds and stages
  the candidate into `dist/` (`dist\bin\opencode.exe`). It writes **only** `dist/` and `.temp/` — never `bin/`;
  promotion into `bin/` stays the owner's act.
- **Why it is a rule:** the cleanup lives in the build, so a session that tests and never builds leaves its scratch
  behind — `.temp` reached 80 GB (owner). A build that fails still ran its cleanup first, so run it even when the
  candidate itself is not wanted.
- **The cleanup reports honestly since 2026-10-03.** The first mandated run printed «.temp/test/ cleaned» while
  50.2 GB / 4.07 M files of 62.7 GB stayed (measured): the old block was `Remove-Item -ErrorAction SilentlyContinue`
  plus an unconditional «cleaned». Now `Clear-ScratchDir` removes entry by entry and names every survivor with its
  reason (fixture: 3 entries, one locked → 2 removed, the locked one named; the old block said «cleaned» over it).
  A `[WARN] … still in use` line is not noise: a live process holds that test dir.
- **Where the mass comes from (✓ measured 2026-10-03):** every test dir under `.temp\test\` carries its own
  `.opencode\node_modules` (24–26 MB, ~2.5 k files: zod, effect, @ai-sdk…) and is not removed when the test ends —
  1 731 dirs from one day ≈ 43 GB. The build only sweeps it; the leak is in the test harness and is open.

---

## Full package test suite — forbidden (owner, 2026-09-22)

**Never launch the full suite** — `bun test` with no path. Owner, verbatim: «полный bun test никогда не
запускать… чтобы больше не палил комп за зря, а потом с соплями типа нуууу то 50000 строк кода.»

Measured 2026-09-22 in `packages/opencode`: **18 minutes, `bytes_written: 0`, ~5 GB RSS, no progress
signal of any kind** — the run cannot be told apart from a stall, and killing it is the only way to
learn that. Two consequences, both load-bearing:

1. **`bytes_written: 0` after minutes means UNKNOWN, never «green»** — read `<run>/state.json`, and
treat a silent instrument as an instrument that has said nothing.
2. **A wall of output is not a report.** 50 000 lines with no address is a haystack: it cannot be read,
cited or turned into a fix, and paying for it twice (machine + context) is the defect.

Always name a path — a file or a directory that owns the claim:
`cmd_runner start --cwd packages/opencode -- bun test test/session/foo.test.ts` (canon:
`plans/README.md` § Testing Convention). The package root is not a path.

**If a full run was started anyway: every error in its log is RED and requires explicit clearance.**
No partial reading — a failure there is never noise, never «pre-existing» (already forbidden), and is
waived only by a named owner decision. An instrument that cannot show its own progress does not get to
colour anything green.

---

## TUI Testing with cmd_runner

Use `cmd_runner.exe` to automate TUI interactions. Launch from `dist/bin` for clean sessions.

Workflow: build (`pwsh _build.ps1`) → start → tail → send text/keys → verify.

**Final tests run from `dist/` after the rebuild, with API-key env vars BLOCKED** (owner, 2026-10-08). The binary
reads provider keys from the environment, so a final test on the owner's env silently runs on his keys and money,
and proves nothing about the configured path. Sequence: `_build.ps1` → start `dist\bin\opencode.exe` in a child
environment with every `*_API_KEY`, `*_TOKEN`, `*_SECRET` variable removed (list the removed NAMES in the run
record, never the values) → run the final checks. `dist/` is for tests only; robot WORK runs from `bin/` in the
main checkout (`.claude/CLAUDE.md` § Delegation).

See cmd-runner skill for full reference.

### Process launch policy (TUI-hang protection)

A bare `start <blocking-app>` in the agent shell **hangs the TUI**: the command
never "exits", the runtime waits forever on an unjoined child process (observed
2026-09-08 while installing a test framework in another project — TUI dialog
froze mid-task).

| Intent | Tool |
|--------|------|
| Temporary run (background job with output capture) | `cmd_runner start -- <app>` |
| Permanent service (survives reboot, own lifecycle) | `nssm install <name> <app>` — never ad-hoc detached start |

Never launch blocking processes (GUI apps, servers, test harnesses, TUI
frameworks) through bare shell `start`/`&`/run tools without a job wrapper.

### cmd_runner as a TUI debugger (and cua for windows)

cmd_runner is not just a job runner — it is a **full TUI debugging surface**:
per-run ConPTY session with an inbox bridge, so you can send text/keys into a
LIVE TUI session and read the rendered output back. This solves most
"TUI is interactive, how do I test it" problems without screenshots.

- Launch TUI: `cmd_runner start -- dist\bin\opencode.exe`
- Send input: write to the session inbox (`logs/cmd_runner/<id>/inbox.jsonl`)
- Read output: `joboutput` / `cmd_runner tail`

**Recursion works**: a TUI → cmd_runner → TUI → cmd_runner → TUI chain is
valid — each level is its own ConPTY instance with its own inbox. Nested
harnesses (agent testing agent testing agent) are supported by design.

**Division of labor with cua** (see [tools-and-sidecars.md §7.1](docs/tools-and-sidecars.md)):
- **cmd_runner** — TUI / terminal-interactive surfaces (ConPTY text in/out).
- **cua** — native windows + browser (background UIA/PostMessage input by
  `(pid, window_id)`, screenshots, `verify_state`, agent cursor overlay for
  user-visible action feedback). cua does not need cmd_runner to act — but
  the cua *daemon* is a long-running process: launch it with
  `cmd_runner start -- bin\cua.cmd serve` (jobkill to stop).
- Node cannot spawn `.cmd` shims (EINVAL, CVE-2024-27980 hardening) — the
  `cua` tool spawns `bin/cua/cua-driver.exe` directly; the shim is for
  interactive shells only.

---

## Auto-Generated Code

| File | Regeneration |
|------|-------------|
| `packages/sdk/js/src/gen/` | **NOT generated on this branch.** `ea7ec60f51` (2025-12-07) repointed `createClient` output to `./src/v2/gen`; eight hand-edit commits landed in v1 afterwards. Hand-maintained — TUI imports `@opencode-ai/sdk/v2`, so v1 is doubly irrelevant. |
| `packages/sdk/js/src/v2/gen/` | **OURS, hand-maintained. Do NOT regenerate.** `bun run packages/sdk/js/script/build.ts` exits 0 and removes ~7100 lines — the generator working *correctly*, because the committed files were never its output: `79c5b4a04e` (2026-07-16, mislabelled `Revert "Regenerate SDK…"`) shrank the spec by 763 lines while growing the two gen files by +7357. Root cause of the gap: **the API is described twice and the generator reads the half with no description.** 46 `describeRoute` entries against 275 route registrations, while 108 `HttpApiEndpoint` declarations across 17 files carry 149 `OpenApi.annotations` that nothing reads (`OpenApi.fromApi` has zero call sites despite shipping in the installed effect); the Effect half enters Hono as opaque pass-throughs (`routes/instance/index.ts:29`). Hence 233 typecheck errors collapsing to 12 missing symbols. Note `packages/sdk/openapi.json` is an ORPHAN — `script/build.ts:12` writes its own spec to `packages/sdk/js/openapi.json` from the live server and deletes it at line 62; the committed file one directory up is never read. `bun typecheck` is not a valid gate here: live code references the hand-maintained types, so a correct regeneration fails it. Add fields by hand. |
| `packages/desktop/src/bindings.ts` | `cargo run -p specta-bindings` |
| `packages/opencode/src/session/prompt/reasoning_prompt.txt` | `python -m prompt_kernel --install` (stamps `prompt_kernel/dist/` and copies runtime `.txt` into production) |

**Kernel sync:** Edit `prompt_kernel/source.py` → `python -m pytest prompt_kernel/tests/ -q` → `python -m prompt_kernel --install` → rebuild the opencode binary.

**Host-local:** This file is host-local (THIS repo only). Product kernel is host-agnostic.

---

## Kernel Development Workflow

1. Define the reasoning kernel in `prompt_kernel/source.py`
2. `python -m pytest prompt_kernel/tests/ -q`
3. `python -m prompt_kernel --install`
4. Rebuild opencode; open a new session (old checkpoints keep the previous system prefix until compact)

Host path bindings and new advisory rules go through `prompt_kernel/addons.py` (gate add-ons, rendered inline inside each gate's `<Gx_RULES>` block) — never through `source.py`. See [docs/gate-addons.md](docs/gate-addons.md).

---

## Dependency Catalog

All shared deps MUST be in root `catalog` (`package.json` → `workspaces.catalog`) and referenced as `"catalog:"`. After changes: `python consolidate_catalog.py --dry-run` → resolve conflicts → apply → `bun install` (zero warnings).

Desktop TS pins `~5.6.2` (Tauri/Electron compat); rest uses `5.8.2` via catalog.

---

## Provider Reach — descend from the highest surface (POSTULATE)

**Always reach a provider from the highest surface it publishes and step down only
on a recorded failure.** Two independent ladders, same rule:

| Ladder | Order |
|--------|-------|
| API version | highest published → … → lowest |
| Transport | `h3` → `h2` → `http/1.1` |

Applies to catalog sync and to inference alike, and to every provider —
openrouter, huggingface, deepseek included.

**Why this is a postulate and not a preference.** Providers migrate to their newest
version and newest transport, and the legacy path then costs them extra: protocol
translation, older connection pools, separate capacity. That path is therefore the
*first* to be rate-limited, deprioritised or simply refused. A legacy surface that
works today is the one that gets throttled first under load — so pinning to it buys
a quiet week and then an outage whose cause looks like "the provider is flaky".
Climbing removes that whole class of intermittent failure instead of diagnosing it
one incident at a time.

### The number is not a constant — read it per provider

Never write a version literal into the rule. As of 2026-09-17:

| Provider | Endpoint | What the number is |
|---|---|---|
| `zai` | `api.z.ai/api/paas/v4` | own API **v4** |
| `novita-ai` | `api.novita.ai/v3/openai` | own API **v3**, then openai dialect |
| `openrouter` | `openrouter.ai/api/v1` | own API v1 |
| `huggingface` | `router.huggingface.co/v1` | router v1 |
| `deepseek` | `api.deepseek.com` | unversioned host; SDK appends the dialect |

A rule saying "use v3" would already have been wrong for Z.AI on the day it was
written.

### Guards — these keep the rule from doing damage

1. **Version ≠ dialect.** Hundreds of catalog entries end in `/v1` because `/v1` is
   the OpenAI-compatible *dialect* path, not a version — those providers have no
   `/v3`. Climb only where the provider versions its OWN API. Blind `/v1` → `/v3`
   rewriting breaks the catalog wholesale.
2. **Descend once, record the rung.** Probing per request pays a failed handshake on
   every call wherever the top rung is dead. The winning rung belongs in the catalog
   `options` — that is exactly what `VERIFIED_NOVITA_OPTIONS = { protocol: "h3" }`
   is, applied across 117 entries in `models/novita-ai.json`, honoured first by
   `resolveGatewayProtocol`. Runtime then falls back only on a live failure.
3. **The transport oracle is `alt-svc`, not a blind probe.** A server that serves h3
   advertises it. Novita does; the `openrouter.ai` and `opencode.ai` zones do not —
   the 2026-09-11 pin returned `HTTP3HandshakeFailed` with no `alt-svc` at all. Read
   the header, then pin.
4. **Record the negative result with the same weight as the positive one.** The only
   reason nobody re-probes openrouter h3 every week is that the failure is written
   down next to the code. An unrecorded "we tried, it didn't work" gets re-tried
   forever.
5. **Step down to the rung that lands, not the next one.** Novita's h3 falls straight
   to `http/1.1`, deliberately skipping h2: Bun's h3 failure modes are
   connection-class, and h1 is the safe landing after any of them.

### Evidence

Novita h3 vs h2, interleaved 6-pair benchmark 2026-09-08: median **2188 ms vs
3294 ms**, tail 2× shorter, zero give-ups, server advertising `alt-svc h3`.
Transport defaults and their probes are recorded in `provider/provider-sync.ts`
above `VERIFIED_H2_OPTIONS`.

A new provider is not finished until both rungs are recorded with the probe that
established them.

---

## Vendor Reasoning Contract — thinking models

**Never assume reasoning-field behavior per vendor.** Read the official model docs
AND run a wire smoke-test (400/200 + `prompt_tokens` A/B) before shipping. Proven
2026-08-28: DeepSeek-direct **400s** on tool turns without `reasoning_content`
(field must exist even when empty); OpenRouter strips reasoning fields entirely
(model never sees them); Z.AI documents only `reasoning_content`. The SDK dialect
(`reasoning` + `reasoning_details`) is OpenRouter client-speak, not vendor API.
OpenRouter is opaque both ways: it rewrites fields AND relays upstream errors/
rhythms un-normalized (MIMO 2.5 Pro case) — direct vs via-OR is not the same wire.

Full contract, vendor matrix, probe recipe: [docs/reasoning-round-trip-contract.md](docs/reasoning-round-trip-contract.md)

---

## Markdown Rendering Flag — DO NOT TOUCH

`OPENCODE_MARKDOWN` must always default to `true`. The OpenTUI `<markdown>` renderable is the correct renderer. Never make the fallback the default.

---

## Completed Research

All findings triaged and resolved — see `plans_completed/`.

---

## Agent Inventory

| Agent | Mode | Prompt | Description |
|-------|------|--------|-------------|
| `build` | primary | provider family prompt | Default full-access development agent |
| `plan` | primary | provider family prompt | Read-only planning (denies edits) |
| `orchestrator` | primary | `prompt/orchestrator.txt` | Autonomous orchestrator for AGI mode |
| `general` | subagent | `prompt/general.txt` | Planning, design, root-cause analysis |
| `explore` | subagent | `prompt/explore.txt` | Fast file/code/conversation search |
| `coder` | subagent | `prompt/coder.txt` | Code implementation (edit/write/bash) |
| `researcher` | subagent | `prompt/researcher.txt` | Read-only research (code+web+history) |
| `media` | subagent | `prompt/media.txt` | Media generation via capability tool |
| `title` | primary (hidden) | `prompt/title.txt` | Session title generation |

Tools: `pipeline` chains subagents sequentially. `capability` looks up model
modalities. `compact` arms a boundary fold of the session window — primaries
only (see [Mechanistic Compaction](docs/compaction.md) § three triggers).

**Per-identity sampling.** Each native subagent declares its own
`temperature` / `topP` / `options.repetition_penalty` in
`src/agent/agent.ts` — verification identities (`explorer`, `coder`) are
sampled tight and unpenalised so their output is reproducible and their
repeated tokens (paths, identifiers) survive; generative ones (`general`,
`media`) are sampled loose so a candidate set actually differs. Model-wide
sampling merges *before* the agent in `session/llm.ts`, so the narrower
declaration wins. `presence_penalty`/`frequency_penalty` are NOT sendable:
the vendor documents both as deprecated no-ops and its endpoint rejects them
beside `repetition_penalty` with a 400, so the pair was removed from the whole
assembly on 2026-09-30 (`plans/2026-09-30_drop-penalty-sampling-params.md`) —
upstream opencode sends neither. Only what the provider honors binds — see the vendor
reasoning contract below.

---

## Documentation Index

All detailed docs live in `docs/`. Here's the quick map:

### Memory / Session
- [Content lifecycle](docs/content-lifecycle.md) — acquire / hold / release / re-acquire; the ID-addressed placeholder and `recall`
- [Mechanistic Compaction](docs/compaction.md) — Layer-1 summary + Layer-2 compact
- [Summary Exact handles](docs/summary-exact-handles.md) — tool filediffs + CodeGraph
- [Session memory graph](docs/session-memory-graph.md) — cadence vs safety (mermaid)
- [Finish-step TX graph](docs/finish-step-tx-graph.md) — `runBatch` / single SQLite TX

### Architecture / Stack
- [Architecture](docs/architecture.md) — prompt system, checkpoint, compaction, agents, KV cache
- [Agent model resolution](docs/agent-model-resolution.md) — the full graph: TUI surfaces → server → the four stores (global jsonc, worktree model.json, session jsonc, kv scope), identity canonicalization, write/read chains, proven contradictions
- [Kernel package](prompt_kernel/README.md) — gate graph, serialization order, source of the runtime prefix
- [Two-canon protocol](docs/two-canon-protocol.md) — ADID 15.3 (untracked, package-rendered) ↔ kernel parity: one protocol, two compilers; why both exist
- [Kernel amendment](docs/kernel-amendment.md) — SELF_MODIFY depths, constitution core, the build procedure that replaces hand editing
- [**Quality doctrine**](docs/kernel-quality-doctrine.md) — **read before changing the kernel**: why an oracle is a third thing, why completion is a two-sided fixed point, where maturity lives, and the craft rules (a rule's position sets its price; a slot beats an imperative; no invented constants)
- [Kernel release 2026-09-24](docs/kernel-release-2026-09-24.md) — the rebuild on the battle-tested 09-17 base, with the three measured regression mechanisms
- [Kernel release 2026-09-27](docs/kernel-release-2026-09-27.md) — closure is no longer the only self-start (ADID 15.3 Mode 2 triggers restored), the priced exits reverted, and the premise declares the reward: divergence shrunk by evidence, accumulated as maturity
- [Kernel release 2026-09-29](docs/kernel-release-2026-09-29.md) — tool readiness before testing (qualification, KAIZEN, half-working = broken), directed edits (SVM as the digital intention, EDIT_SV), the trader's rule (predict per case; divergence is transitive and triggers full re-grounding), LEAN before any oracle
- [Kernel release 2026-10-01](docs/kernel-release-2026-10-01.md) — one executor contract for tool/agent/human (done or explicit stop; silence = FAIL), a verbatim decision departed from only with a measurement on its layer, recursive re-verification by digest, evidence anchored on a non-artifact surface
- [Gate add-ons](docs/gate-addons.md) — advisory path bindings per kernel gate, addon registry, budget guardrails
- [Agentic reasoning runtime](docs/agentic-reasoning-runtime.md) — gates, REUSE ladder, claim ledger
- [AGI Workflow](docs/agi-workflow.md) — orchestrator/worker loop, plan hygiene
- [Rendering Pipeline](docs/rendering.md) — LLM→terminal display, mermaid, images

### Infrastructure
- [Startup & bootstrap](docs/startup-bootstrap.md) — cold start, CodeGraph, Fossil vs git/jj
- [Fossil snapshot system](docs/fossil-snapshot.md) — agent undo/redo, extras cleanup
- [CodeGraph MCP](docs/codegraph-mcp.md) — MCP live graph + SQLite readonly
- [External File Locations](docs/external-file-locations.md) — where opencode reads/writes
- [Tools and sidecars](docs/tools-and-sidecars.md) — `tools/` binaries
- [Tool playbook](docs/tool-playbook.md) — task → instrument routing, three habits, and the anti-patterns measured on 2026-09-21
- [Background Jobs](docs/background-jobs.md) — non-blocking shell jobs
- [Kernel assembly point](docs/kernel-assembly-point.md)

### Deployment
- [Linux deploy](docs/linux-deploy.md) — Linux build and portable install

<!-- CODEGRAPH_START -->
## CodeGraph

Reach for it BEFORE grep/find when you need to understand code. MCP owns the live graph; SQLite packs readonly structure for agents.

- Built-in `codegraph` tool: MCP touch → SQLite pack (symbols, cross-file edges).
- Config: auto-injected when `.codegraph/` exists (opt out: `OPENCODE_CODEGRAPH_MCP=0`).
- Before a task's first query and after edits, run `codegraph sync` (incremental; through `bin\codegraph.cmd`, the
  one sanctioned launch from `bin/`). Owner, 2026-10-03: «перед использованием codegraph надо сделать codegraph sync»
  — this replaces the earlier «Do not write `codegraph.db` or use CLI reindex as fallback». A full `codegraph index`
  stays the owner's call. RAG goes first: `adm --rag index` (incremental), then `adm --query`, then codegraph.

Full details: [docs/codegraph-mcp.md](docs/codegraph-mcp.md)
<!-- CODEGRAPH_END -->
