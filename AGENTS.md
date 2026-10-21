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
- **Never edit source with a direct, UNVERIFIABLE script — and before the edit, ask codegraph what it touches.** Hand edits go through `edit`/`write`; the precedents, the ADM descriptor contract and the measured record: [docs/tool-playbook.md](docs/tool-playbook.md)
- No .opencode/plans/ — only plans/ and plans_completed/
- **A plan hand-off is JOB FAILED** when any of these is true: a box its code has earned is still unconfirmed, the plan is still in `plans/` after its last item closed, the plan's work has no commit that names it (owner, 2026-09-22), or the plan is not named in `plans/MASTER_PLAN.md` (owner, 2026-10-12) — details and rationale in § Plan Maintenance
- After plan changes, run explore agent to validate
- Tests cannot run from repo root — run from package dirs
- Avoid mocks in tests — test actual implementation
- **Run `_build.ps1` after tests and after changes — mandatory** (owner, 2026-10-03: «запуск _build.ps1 после тестов и изменений обязателен. Темп 80гиг это слишком»). It cleans `.temp/test/` and `dist/` and builds the candidate into `dist/` — never `bin/`. See § Build after tests and changes
- **Never run a full package test suite** (`bun test` with no path) — measured 2026-09-22: `packages/opencode` ran 18 minutes with `bytes_written: 0` and ~5 GB RSS, indistinguishable from a stall; name a file or a directory instead. If one was started anyway, every error in its log is RED and needs the owner's explicit clearance — see § Full package test suite (owner, 2026-09-22)
- **"Don't litter in .opencode folder"** — instruments live in `experiments/<ISO-date>_<name>/` while in use and move to `experiments_history/` when the finding is recorded; runtime data lives under `.opencode/data/`. `.opencode/` is NOT a drawer: no `.ps1`, `.mjs`, `.ts` or scratch `.json` is written there (owner, 2026-09-20: «почем каждый придурок срет в папке .opencode без резонного обоснования, вместо того чтобы использовать папку experiments или этого нет в правилах» — it was NOT in the rules; this is the rule)
- **"Clean up after yourself"** — an experiment folder is scratch you BORROW, and you return it: when the task closes, remove what you can regenerate (build targets, `node_modules` copies, repo tree/archive copies, the second and later copy of a byte-identical file) and leave a note naming how to regenerate each item. NEVER delete a unique result (a report, a csv, a json finding, a script): a finished experiment whose finding is recorded moves to `experiments_history/` per its canon ([experiments_history/README.md](experiments_history/README.md)); anything you cannot classify goes on a list for the owner. **Never copy a repo tree with `shutil.copytree`** — it follows NTFS junctions and copied 72.4 GB until drive D had 0 GB free (2026-10-21); copy with `scripts/copy_tree_safe.py`, which treats a junction as a leaf. **Size budget: one experiment folder ≤ 2 GB, the whole `experiments/` tree ≤ 16 GB** (measured 2026-10-21: 10.6 GB before the cleanup, 8.2 GB after; the worst single folder was 863 MB of cargo `target/`). The check that enforces it is `scripts/experiments_budget.py` — run it at task close: it prints the size and the top offenders and exits NON-ZERO over budget; `scripts/experiments_cleanup.py` removes the regenerable weight (junction-safe, with a receipt that every junction target survived). Owner, 2026-10-22: «Вообще отправь робота навести порядок в экспериментах, там одних таргетов ебом это надо где-то прописать - убирать за собобой - засрали диск. Дубликатов море.»
- A measure and its threshold must share a SPACE (content vs request) and a SCOPE (slice vs whole window) — two spaces under one name is how a threshold silently changes meaning (2026-09-19)
- A skipped test must state WHY, and `test.todo` is NOT a test (bun never runs its body) — a bare skip hides a defect, which is a bug
- Heavy test files carry a FILE-level timeout (`setDefaultTimeout(20_000)`), never per-test whack-a-mole — bun's 5 s default turns a loaded machine into a red that says nothing about the code
- Reach every provider from the HIGHEST surface down: newest API version first, then h3 -> h2 -> http/1.1
- Tool names ARE wire ids: lowercase ASCII alphanumerics only — `_` and `-` are refused and the tool fails to load at `Tool.define`; the same spelling must appear in the registry, its `builtin` list and `util/dsml-normalizer`, or a DeepSeek-emitted call is never recognised (2026-09-19, restating 2026-08-26: `canonicalName` strips non-alphanumerics — `multi_edit`→`multiedit`, `session-read`→`sessionread`). WHY it is a prohibition and not a taste: a second spelling of a TOOL NAME is a generation bug, not a validation one — the model emits whichever variant association hands it (`-` and `_` are its standard separator habits) and the mismatch is silent, because a validator can see a typo and cannot see an association. SCOPE: tool names ONLY. This is not a naming rule for fields, keys or internal identifiers — a tool name is the one identifier the model must reproduce itself for the call to be routed (2026-09-19).

forbidden_actions:
- **Never touch `bin/` without explicit owner permission** — no edits, no replace/rename/move/copy into it, and no launching executables from it (including a version check like `bin\opencode.exe --version`). WHY: `bin/` is the owner's LIVE runtime — the running TUI executes from that folder, and in-session "bin surgery" (move-aside + copy to dodge a locked exe) on 2026-09-24 mixed 10.0.1106/10.0.1107 and broke the owner's session. Build candidates belong in `packages/opencode/dist/**`; promoting a candidate into `bin/` happens ONLY on an explicit owner request, by the owner's own procedure. Owner, 2026-09-24, verbatim: «любые правки в bin папке и запуски оттуда без конкретного разрешения - запрещены». **The one standing exception** (owner, 2026-10-03, «Разрешить sync из bin/»): `codegraph sync` and `codegraph status`, launched through `bin\codegraph.cmd` — the CodeGraph CLI exists only there; plus `codegraph.cmd prompt-hook`, the Claude `UserPromptSubmit` hook in `.claude/settings.json` (owner, 2026-10-21, «Разрешить запуск»; the bare `codegraph` spelling exits 127 under Git Bash, which applies no PATHEXT). Nothing else in `bin/` is launched, and nothing there is ever edited.
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


Reasoning is part of the answer: a report in the user's language over an English chain of thought is still a violation — and it is the one that hides, because only the final text is visible.

Technical identifiers, commit subjects, code and quoted log lines stay in English; the prose around them does not.

Details: [docs/agentic-reasoning-runtime.md](docs/agentic-reasoning-runtime.md)

---

## STOP — the SDK/upstream question is CLOSED. Do not reopen it.

**Run the diff — one command settles every version of this question** (`diff -rq external/opencode-1.18.29/packages/opencode/src packages/opencode/src`; measured 2026-09-17: 190 same-named files, zero byte-identical — there is no merge surface). The conclusions, the `gen` folders and the OpenTUI re-base record: [docs/upstream-relation.md](docs/upstream-relation.md).


---

## Project Paradigm — Outer-Loop Continuous Development

Ship behavior by **installing priors as process** on a general cosine-native transformer, not by re-initializing weights. The inductive bias lives in the runtime outer loop: planning grammar, memory handles, working-copy impact, search, and oracles.

```
Goal → fractal task lattice → REUSE.BEFORE → implement → SMOKE.BEFORE → continuous memory → iterate
```

**No big untestable jobs.** Every unit must be searchable, doable, and smoke-testable. Advanced projects emerge from **many proven medoids**, not one cathedral plan.


Full details: [docs/architecture.md](docs/architecture.md), [docs/compaction.md](docs/compaction.md), [docs/agi-workflow.md](docs/agi-workflow.md)


### Agent obligations

- Prefer **small, named, testable** tasks over epic single-shot implementation.
- **REUSE.BEFORE** non-trivial invent; re-search on stuck failure.
- **SMOKE.BEFORE** implementation; baseline then post-impl before `[x]`.
- Treat summaries as **Inferred handles**, not Exact — recover via session-read / fossil / codegraph.
- Do not hand-edit ADID receivers; kernel + ADM own framework surfaces (why both canons exist: [docs/two-canon-protocol.md](docs/two-canon-protocol.md)).

The layer table and the closed-loop doctrine (owner 2026-09-30, «обвести в рамку») moved to [docs/architecture.md](docs/architecture.md).

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

**Engines:** SQLite (`bun:sqlite` + drizzle) for long/relational queries, LMDB (`lmdb@3.5.6`) for fast keyed state — decided and measured. The concurrency rationale, the accepted `EBUSY` cost, the addon + `bun --compile` findings and the migration order are in [docs/storage-paradigm.md](docs/storage-paradigm.md).

## Debugging Paradigm — read state before adding a log (2026-09-19)


**The rule.** A log may record only what STATE CANNOT SHOW:

1. **Time and rate** — latency, TTFB, a stall that has no key to live under.
2. **An external system's failure** — a provider, `fossil`, `rg`, a spawned process; the state plane
   cannot see outside itself.
3. **A transition with no key yet** — a one-shot during boot, before any namespace exists.

Everything else: **if the event has a key, it is STATE.** State is durable, two-way and queryable;
a log is ephemeral, one-way, and must be pre-placed where someone guessed the problem would be. Read
it with `dbread` / `checkstate` instead of grepping for a line you hoped would be there.

Details: [docs/debugging-paradigm.md](docs/debugging-paradigm.md)


## Hashing is NEVER the suspect — measured, do not re-litigate (2026-09-29)

**Measured, do not re-litigate: a stall of seconds over megabytes is a WAIT, not a count** (sha256 = 332 MB/s; the whole session store hashes in ≈29 ms). The table, the arithmetic and the already-excluded causes: [docs/debugging-paradigm.md](docs/debugging-paradigm.md)


## Granularity — every mechanism gets the scale it serves, and nothing finer (2026-09-29)


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

Details: [docs/debugging-paradigm.md](docs/debugging-paradigm.md)

## Content Lifecycle — self-cleaning content (2026-09-19)


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

Details: [docs/content-lifecycle.md](docs/content-lifecycle.md)


## Continuity Paradigm — the invariant the project exists for (2026-09-19)


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
4. **The agent may repair its own working representation — never the sources.** Owner, 2026-10-16, verbatim:
   «Агент должен иметь возможность исправлять обнаруженные дефекты собственного рабочего представления до их
   повторного использования, не изменяя первоисточников, доказательств и истории решений.» Rule 1 forbids the
   RUNTIME silently compressing the tail; this permits the AGENT's own explicit, reasoned correction (cut or
   erratum) of what replays, before it is reused — the stored original, tool exchanges, evidence and the decision
   history stay unchanged and addressable, and each correction is recorded as a self-refutation. Mechanism:
   plan t70 (self-edit directive).

**Falsifier:** if you have to go and CHECK what your own window held, the boundary broke continuity.
The saving is a token; the cost is a recall turn. Full design:
[docs/compaction.md](docs/compaction.md) § "Continuity is the invariant this file exists to serve".

## Bug Policy

- No such thing as an "unimportant" bug. Every bug degrades the tool — fix it.
- **There are NO pre-existing errors.** Every typecheck/test failure is a deliverable.
- **Bugs block push.** All bugs must be fixed before `git push`. No `--no-verify`.
- Silent `catch {}` blocks are bugs — must log (debug for expected, warn for unexpected).
- Plan-to-code gaps are bugs — correct immediately.
- **The direction of change is one-way: tests adapt to the functionality, never the reverse** (owner, 2026-09-30) — a red test is a question about the TEST against the REQUIREMENT; never soften the assertion or the behaviour. Details: [docs/bug-policy.md](docs/bug-policy.md)
- **A test that can silently assert nothing is not a guard** — replace a conditional `continue`/`return`/skip with the assertion it stood in for. Details: [docs/bug-policy.md](docs/bug-policy.md)
- **A tool's documented contract is a claim — test it, never inherit it**; an untested safety promise is a defect waiting for its second occurrence. Details: [docs/bug-policy.md](docs/bug-policy.md)
- **Write-path oracles inspect the artifact** — a PERSISTENT_WRITE change is verified by reading back what was written, never by typecheck alone. Details: [docs/bug-policy.md](docs/bug-policy.md)

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


- **every** active plan carries its own SV (keywords + dominant): «sv для каждого субплана, таска или линка
  обязателен, чтобы было четко ясно — нафига это все и с чем это коррелирует» (owner, 2026-09-29);
- every in-flight task carries its manifest: sv, plan ref, `eta_turns`, state, oracle;
- a number there that disagrees with a plan file means the plan file wins and `MASTER_PLAN.md` is regenerated.

**The renderer WORKS — RUN IT, never hand-maintain the body**: `svm render` rewrites everything below the `<!-- generated below -->` marker and preserves the hand-owned head. The measured two-render check, the open vector-authoring counts and the full records: [docs/plan-maintenance.md](docs/plan-maintenance.md)


### The rest

- Active plans in `plans/` (repo root). Completed → `plans_completed/`.
- **Never use `.opencode/plans/`.**
- After implementation, audit `plans/*.md` — mark `[x]` if code confirms done.
- **A plan's tasks are `- [ ]` boxes.** Measured 2026-10-12: three live plans with real open work carried their tasks as headings or tables, so `planstatus` saw **no box at all** — they were absent from `Active` and from the debt count entirely, and nothing could move them. It prints the count as `No checklist: N plan(s)`; keep it at zero. A plan you have just written and cannot see in `Active` is invisible, not finished.
- **PRE_FLIGHT smoke gate:** plan must have `## Smoke Tests` (or `smoke: N/A`) before any edit.
- Plan-to-code gaps are bugs.
- Use `messagesearch` to verify task completion before implementing.
- After moving to `plans_completed/`, scan active plans for stale references.

Tool: `packages/opencode/src/util/plan-status.ts` — `reconcilePlans()` auto-moves completed plans. See [docs/agi-workflow.md](docs/agi-workflow.md).

### JOB FAILED — a plan is not finished by shipping code

A unit of work is **JOB FAILED** — not "mostly done", not "code landed" — when any of these is true at hand-off:
1. **No confirmed box** — the acceptance declared in the plan was run and passed (never «the code looks right»).
2. **The plan is still in `plans/`** after its last item closed — it moves to `plans_completed/` in the same change.
3. **No commit for the plan** — one plan's work lands as one commit that names it.
4. **Not named in `plans/MASTER_PLAN.md`** — the map is generated from the plan files; run `svm render`.

The owner's wording, the «eternal DRAFT» numbers and the items in full: [docs/plan-maintenance.md](docs/plan-maintenance.md)


### A commit is NOT closure

A commit — however green its oracle — is **not by itself grounds for G9**. To close a unit of work the commit must be accompanied by one of:

1. a **confirmed box** in the plan, earned by an **artifact** (a run id, a hash, a rehearsal log) — never by the code "looking right"; or
2. the plan's **move to `plans_completed/`**, and only when the plan is **fully complete**.

Details: [docs/plan-maintenance.md](docs/plan-maintenance.md)



---

## Style Guide

Follow [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) and [MetaMask TypeScript Guidelines](https://raw.githubusercontent.com/MetaMask/contributor-docs/372c7b31e951ffec2f71a706099b3df68e4b5f7a/docs/typescript.md).


Reduce total variable count by inlining when a value is only used once.



Avoid unnecessary destructuring. Use dot notation to preserve context.



Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.



Avoid `else` statements. Prefer early returns.



Use snake_case for field names so column names don't need to be redefined as strings.

Code examples for every rule above (and the full `STYLE_RULES` block): [docs/style-guide.md](docs/style-guide.md)


---

## Backup & Restore

`edit` tool auto-creates `.bak` backups in `{worktree}/.opencode/data/backups/<sessionID>/`. Max 50 per session. To restore: copy `.bak` over original.

---

## Fossil Snapshot System

Agent snapshot / undo-redo timeline only. **Git** is project VCS.

- Repo: `{data}/fossil/{projectID}/snapshot.fsl`
- Binary: `external/fossil/fossil.exe` or `tools/fossil.exe`
- **The snapshot backend is Fossil — git/jj are NOT alternatives** (the git-test rebaseline and the per-tool-evidence lesson: [docs/fossil-snapshot.md](docs/fossil-snapshot.md))
- **The pinned Fossil source is in-tree**: `external/fossil/fossil-src-2.28/` — version-matched to the shipped `fossil.exe` (2.28). `www/` is the docs, `src/` is the mechanism (e.g. the 15 s SQLite busy timeout at `src/db.c:2208`). Reach for it BEFORE fossil-scm.org — the web is the fallback, not the first stop.
- Undo/redo: full leaf checkout (`revertTo`), not per-file hash mix
- **Four boundaries, all BEFORE the thing they cover** (2026-09-17): the start of
  a user turn, before a sidecar summary, before an undo, before a redo. No
  decision about *whether* to snapshot and no inspection of what a turn did —
  `track(undefined)` runs `addremove`, so it catches whatever changed regardless
  of who wrote it. Fossil has no autotrack; that call is the automatic tracking.
  The redo boundary uses `track([])`: an empty *explicit* list records tracked
  modifications without conscripting untracked user files.

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


Override: `OPENCODE_ALLOW_DESTRUCTIVE=1` or `bypass_constitution`.

**Unknown apps are crash-prone too** — any executable that is not a known tool is auto-wrapped into `cmd_runner start -- …`; without `cmd_runner` it is refused (fail-closed). Details: [docs/tools-and-sidecars.md](docs/tools-and-sidecars.md)

**Never write file content through shell `echo`/`>>`/`>`.** cmd.exe emits non-ASCII in the OEM code page (cp866):
`·` became byte `0xFA` — invalid UTF-8 — and `—` silently became `-`. Measured 2026-10-12: one such append
left `_progress_log.md` «not UTF-8», the next tool read it as a legacy code page, and its save rewrote
**2 521 lines double-encoded** (plan `2026-10-14_progress-log-mojibake`, commit `7d45f72fb3`). File content
is written through `edit`/`write` (or an ADM descriptor); a shell redirect is for ASCII output logs only.

---


## Host Toolchain — the measured inventory (2026-10-10)

**Read the measured inventory before proposing ANY toolchain install** — the tool table, the NOT-present list and the prebuilt-release route: [docs/host-toolchain.md](docs/host-toolchain.md)


**Owner rule:** never run `choco install msys2` / `mingw` in this repo without an explicit request.
## Type Checking

Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

---

## Build after tests and changes — mandatory (owner, 2026-10-03)

**Run `pwsh -NoProfile -File _build.ps1` through `cmd_runner` from the repo root, after any test run and any source change** — it cleans `.temp/test/` and `dist/` and stages the candidate into `dist/` (**never** `bin/`); the product runs from source via `_run.cmd`. All details and the measured history: [docs/build-and-run.md](docs/build-and-run.md)


---

## Full package test suite — forbidden (owner, 2026-09-22)

**Never launch the full suite** — `bun test` with no path. Owner, verbatim: «полный bun test никогда не
запускать… чтобы больше не палил комп за зря, а потом с соплями типа нуууу то 50000 строк кода.»


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

Details: [docs/build-and-run.md](docs/build-and-run.md)

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

cmd_runner is the TUI/terminal debugger (per-run ConPTY + inbox bridge; recursion works); cua covers native windows + browser. Recipes and division of labor: [docs/tools-and-sidecars.md](docs/tools-and-sidecars.md)


---

## Auto-Generated Code

`packages/sdk/js/src/gen/` and `src/gen/` are **ours, hand-maintained — never regenerate**; add fields by hand. `bindings.ts` ← `cargo run -p specta-bindings`; `reasoning_prompt.txt` ← `python -m prompt_kernel --install`. The full table and the root cause of the generator gap: [docs/upstream-relation.md](docs/upstream-relation.md)


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

The postulate's rationale, the per-provider numbers (v4/v3/v1) and the measured evidence: [docs/provider-reach.md](docs/provider-reach.md)



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

Details: [docs/provider-reach.md](docs/provider-reach.md)


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

Agent roster, prompt files and per-identity sampling: [docs/architecture.md](docs/architecture.md) § Agent inventory (moved verbatim 2026-10-13).


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
- [Kernel portability — 2026-10-19](docs/kernel-portability-2026-10-19.md) — the THINK half runs in a plain chat: the same model drifts without the kernel and runs G0→G9 with it; predictions labelled Hypothetical, closure from reality
- [Gate add-ons](docs/gate-addons.md) — advisory path bindings per kernel gate, addon registry, budget guardrails
- [Agentic reasoning runtime](docs/agentic-reasoning-runtime.md) — gates, REUSE ladder, claim ledger
- [AGI Workflow](docs/agi-workflow.md) — orchestrator/worker loop, plan hygiene
- [Rendering Pipeline](docs/rendering.md) — LLM→terminal display, mermaid, images
- [Storage paradigm](docs/storage-paradigm.md) — two planes (SQLite/LMDB), concurrency rationale, engines, migration order (moved from AGENTS.md 2026-10-13)
- [Debugging paradigm](docs/debugging-paradigm.md) — read state before logs; hashing is never the suspect; granularity (moved from AGENTS.md 2026-10-13)
- [Provider reach](docs/provider-reach.md) — descend from the highest surface: why, per-provider numbers, guards, evidence (moved from AGENTS.md 2026-10-13)
- [Upstream relation](docs/upstream-relation.md) — the closed SDK/upstream question, the two upstreams, generated vs hand-maintained (moved from AGENTS.md 2026-10-13)

### Infrastructure
- [Startup & bootstrap](docs/startup-bootstrap.md) — cold start, CodeGraph, Fossil vs git/jj
- [Fossil snapshot system](docs/fossil-snapshot.md) — agent undo/redo, extras cleanup
- [CodeGraph MCP](docs/codegraph-mcp.md) — MCP live graph + SQLite readonly
- [External File Locations](docs/external-file-locations.md) — where opencode reads/writes
- [Tools and sidecars](docs/tools-and-sidecars.md) — `tools/` binaries
- [Tool playbook](docs/tool-playbook.md) — task → instrument routing, three habits, and the anti-patterns measured on 2026-09-21
- [Background Jobs](docs/background-jobs.md) — non-blocking shell jobs
- [Kernel assembly point](docs/kernel-assembly-point.md)
- [Host toolchain](docs/host-toolchain.md) — the measured inventory: zig/MSVC/rust/go/python, what is NOT present, prebuilt-release route (moved from AGENTS.md 2026-10-13)
- [Build and run](docs/build-and-run.md) — `_build.ps1`, `_run.cmd` from source, the full-suite measurement (moved from AGENTS.md 2026-10-13)

### Deployment
- [Linux deploy](docs/linux-deploy.md) — Linux build and portable install

### Governance — split from AGENTS.md (2026-10-13)

- [Bug policy](docs/bug-policy.md) — tests adapt to functionality; contract tests; write-path oracles
- [Plan maintenance](docs/plan-maintenance.md) — MASTER_PLAN renderer, JOB FAILED, commit is not closure
- [Style guide](docs/style-guide.md) — the worked examples behind the TS/Python rules


## Search instruments — by the question's layer (2026-10-18)

Choose the instrument by the layer the question lives on — the kernel's own G1 rule. A fixed
graph-before-grep order is retired (owner, 2026-10-18: «Так - мы привязали codegraph к греп
как правило - это глупо.»):

- text/literal → `grep` (fossil grep / Zoekt where present);
- files by name → `glob` / `list` («a file was found» is their whole answer);
- structure, callers, impact → `codegraph`;
- own trajectory → `messagesearch` (sv-chain skill for the vector chain);
- prior art, patents, standards, papers → `universalsearch` hybrid (`/hybrid`, then
  `/web/context` on the URL for `content_hash`).

An empty result is a claim about that tool on that layer only, never absence on another layer.

**Measured facts kept.** BOTH graph indexes are blind to declarations INSIDE a function (measured
2026-10-10: `failToolCall`, `session/processor.ts:848` — 4 `grep` hits, 0 in codegraph, 0 in CBM —
while the top-level `MAX_TOOL_CALLS_PER_MESSAGE` in the SAME file, SAME fresh index, SAME `const`
shape, IS in the graph). A literal-text question belongs to a text tool; a structure question to
the graph. What an empty graph establishes is «the graph does not index it», never «it does not exist».

The owner's statement and the price of asking the wrong layer: [docs/tool-playbook.md](docs/tool-playbook.md)

**Asking the wrong layer is not a style slip — it is the grounding step itself skipped.** @KAIZEN
history (kept from the 2026-10-10 order): the second occurrence of «grepped on a structural
question instead of asking the graph» is a tool-USAGE defect, not weather — under layer routing
the same defect is any question asked on the wrong layer.
<!-- CODEGRAPH_START -->
## CodeGraph

Reach for it when the question is structure, callers or impact — a text/literal question goes to grep first (the graph is blind to declarations inside a function, measured 2026-10-10). MCP owns the live graph; SQLite packs readonly structure for agents.

- Built-in `codegraph` tool: MCP touch → SQLite pack (symbols, cross-file edges).
- Config: auto-injected when `.codegraph/` exists (opt out: `OPENCODE_CODEGRAPH_MCP=0`).
- Before a task's first query and after edits, run `codegraph sync` (incremental; through `bin\codegraph.cmd`, the
  one sanctioned launch from `bin/`). Owner, 2026-10-03: «перед использованием codegraph надо сделать codegraph sync»
  — this replaces the earlier «Do not write `codegraph.db` or use CLI reindex as fallback». A full `codegraph index`
  stays the owner's call. RAG goes first: `adm --rag index` (incremental), then `adm --query`, then codegraph.

Full details: [docs/codegraph-mcp.md](docs/codegraph-mcp.md)
<!-- CODEGRAPH_END -->
