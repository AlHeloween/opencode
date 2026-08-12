intent:
Root AGENTS.md — project-wide governance and conventions for opencode.
Project paradigm (outer-loop continuous development), agent governance, coding standards,
KV cache continuity, backup/restore, testing.

state:
default_branch: dev
local_main: may not exist — use dev or origin/dev for diffs
upstream: anomalyco/opencode (branch has architectural divergence)
paradigm: outer-loop fractal prior + continuous memory + reuse + smoke (not train-from-scratch)

scope:
- project paradigm (formalism below)
- agent governance rules
- TypeScript style standards
- security and secrets management
- bug policy
- KV cache continuity
- conversation checkpoint system
- discovery rules
- plan maintenance
- style guide (TypeScript, schema, control flow)
- backup & restore
- fossil snapshot system
- opencode path architecture
- testing conventions
- TUI testing with cmd_runner
- auto-generated code
- dependency notes
- completed research
- agent inventory

constraints:
- See `prompts_kernel/` package for GOVERNANCE dict (all rules as typed Python data)
- Default branch is dev, NOT main
- Never expose secrets to public git
- Silent catch {} blocks are bugs — every catch must log
- Plan-to-code gaps are bugs — correct immediately
- KV cache must be byte-stable across session turns
- No .opencode/plans/ directory — only plans/ and plans_completed/
- After plan changes, run explore agent to validate
- Tests cannot run from repo root — run from package dirs
- Avoid mocks in tests — test actual implementation

forbidden_actions:
- Exposing secrets (API keys, tokens, passwords, private keys) to git
- Using git push --no-verify (or any --no-verify variant with git push)
- Using silent catch {} blocks
- Labeling errors as "pre-existing" — every error is a deliverable
- Planning from .opencode/plans/ directory
- Breaking KV cache continuity (system prompt must be byte-stable)
- Running tests from repo root
- Changing Global.Path.home from worktree to os.homedir()
- **This worktree only (not product SPECS):** Prefer product code under `packages/**` for architecture. Do not treat this repo’s host skill/rule trees as the product identity to redesign unless the user **explicitly asks**. Runtime-injected host surfaces for the session may still be used. Product kernel/reasoning stay host-agnostic (see `21_skills_boundary.py`).
- Hand-editing ADID framework receivers when framework work is requested — frozen; change only via kernel SPECS or official ADM pipelines.

invariants:
- Default branch is dev — never assume main exists
- Every catch block must log (debug for expected, warn("bug:...") for unexpected)
- Silent catch {} is always a bug
- Plan documents must match actual code state
- .opencode/plans/ is prohibited for plan storage
- git push --no-verify is never permitted for developer pushes

acceptance_tests:
- git status confirms dev branch
- No catch {} blocks without log statements
- Plan files in plans/ match actual code state
- KV cache fingerprint stable across consecutive turns
- No git push --no-verify in development workflow

"""
Agent governance — defined in prompts_kernel/ package.

from prompts_kernel import GOVERNANCE_RULES, CODING_AGENT_DIRECTIVES, DefaultPromptDirectives

Architecture documentation: prompts_kernel/docs/WORKFLOW_DIAGRAM.md (full spine diagram)
"""

- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- This `Local_Development` branch has **significant architectural divergence** from upstream `dev` (anomalyco/opencode). See `upstream_comparison/README.md` for fork point, divergence summary, and adoptable patterns.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Project Paradigm — Outer-Loop Continuous Development

This fork does **not** rely on training a custom model from scratch (too expensive). The inductive bias lives in the **runtime outer loop**: planning grammar, memory handles, working-copy impact, search, and oracles. Elements already appear elsewhere in this file and in the kernel (`PLANNING`, `SMOKE.BEFORE`, `REUSE.BEFORE`, `docs/compaction.md`); this section is the **formal paradigm** that unifies them.

### Thesis

Ship behavior by **installing priors as process** on a general cosine-native transformer, not by re-initializing weights. Same scientific bet as fractal / multi-scale embedding R&D (self-similarity across grain sizes) — applied at systems layer until weights catch up.

```
Goal
  → fractal / linear task lattice (small, meaning-true jobs)
  → REUSE.BEFORE (web + Sourcegraph) + local codegraph
  → implement small chunk
  → SMOKE.BEFORE / post-impl oracles
  → continuous memory (summary handles + fossil + folder impact)
  → iterate without leaving goal direction
```

**No big untestable jobs.** Every unit must be searchable, doable, and smoke-testable. Advanced projects emerge from **many proven medoids**, not one cathedral plan.

### Layer stack

| Layer | Mechanism | Kills | Canonical surfaces |
|-------|-----------|--------|-------------------|
| **1. Task geometry** | Fractal lattice (Sierpinski / Quad-tree / L-System) + cosine filter + **k-medoids grounded on seed tasks** → `CENTRAL_TASKS` = medoids only (**no Mode-1 linear shortcut**) | Monolith plans; soft step lists; transformer length-bias mush; goal drift | Kernel `PLANNING`; `ALGORITHM_CARD`; plan agent workflow |
| **2. Prior art** | `universalsearch` `web` / `code` (Sourcegraph) / `hybrid`; local codegraph first for structure | Reinvention; guesswork | Rule `REUSE.BEFORE`; tool `universalsearch` |
| **3. Oracles** | Plan `## Smoke Tests`: baseline [Exact] before edit; post-impl pass criteria before `[x]` | “Works on vibes” | Rule `SMOKE.BEFORE`; `plans/README.md` |
| **4. Conversation memory** | Mechanistic compaction: small summaries with hard links → `message*`; never delete; session-read = Exact | Memory soup | `docs/compaction.md`; checkpoint system |
| **5. Working-copy memory** | Fossil snapshots (runtime undo timeline) + CodeGraph **folder-scoped** impact on change eras (not whole-repo graph every time — too ambiguous) | Tree soup; “what did we change?” | Fossil snapshot system; `codegraph/reader` / structural tags |
| **6. Direction lock** | Semantic Vector / decisions preserved; re-cluster residual work against original goal seeds | Silent mission creep | Compaction SV + Key decisions; plan master sync |

### Fractal decomposition (why Sierpinski)

Transformers bias toward **output length ≈ input length**. A single huge “plan everything” prompt yields a soft monolith. A **self-similar lattice** (Sierpinski-style `F→F+F−F`, or Quad/L-System when structure fits) forces the same recursive motif at every level — the length bias **fills the lattice** instead of inventing essay architecture.

Pipeline:

1. **Seed tasks** — meaning-true `Task_1 … Task_n` grounded on the goal (Exact evidence first).  
2. **Over-generate** — fractal lattice per seed (Sierpinski / Quad / L-System); same recursive motif every level.  
3. **Cosine filter** — keep candidates aligned with Goal SV / seed meaning.  
4. **k-medoids with seeds as grounding** — seeds are cluster centers; foam dies; **middle-ring medoids** remain: small enough to execute, still exactly about the seed.  
5. **Each medoid** — REUSE search → implement → smoke.  
6. **Iterate** — residual work re-clustered against original seeds / Goal SV (never Mode-1 linear fallback).

Cosine similarity is the natural measure on today’s embedding geometry; fractal grammar is the **outer prior**. (Frontier R&D explores fractal Word2Vec / multi-scale embeddings and multifractal net structure — same bet inside \(W\); we cannot afford train-from-scratch, so the prior stays in the loop.)

### Continuous memory + impact (organized agent memory)

On each summary / change era (conceptually aligned with Layer-1 compaction windows):

1. Resolve **fossil positions** that match the record (timeline of real working-copy state).  
2. **Fossil diff** between those positions.  
3. Translate diff through CodeGraph **per touched folder only** (exact-enough impact; full-repo graph is ambiguous noise).  
4. Attach impact to the summary handle so `message*` carries not only chat narrative but **development memory**.

Triple handle per era:

| Handle | Question | Epistemic |
|--------|----------|-----------|
| Message IDs (`from_id` / `to_id` / `summary_message_id`) | What was said / decided? | Exact via `session-read` |
| Fossil hashes + diff | What files actually changed? | Exact (snapshot truth) |
| Folder-scoped CodeGraph | Which symbols / external callers? | Structural Exact-ish at index time |

Soft-fail if fossil or index is missing — never invent impact; never block compaction or snapshot.

### How a task becomes “trivial”

When all layers are live, work is rarely exploration hell:

1. **Locate** — messagesearch / session-read + fossil impact + local codegraph  
2. **Reuse** — universalsearch web + Sourcegraph  
3. **Change** — one medoid-sized edit  
4. **Prove** — smoke oracle  

Hard remaining work is product judgment; mechanics stop burning the session.

### Tool grain (axe vs sandpaper)

| Tool | Role |
|------|------|
| **Axe / sawmill** | Fractal over-generation, large implementers, bulk feature agents |
| **Sandpaper** | Cosine + k-medoids filter, smoke oracles, correctness review, plan-to-code audit |

Do not rebuild timber with sandpaper; do not finish planks with a sawmill. Large greenfield features: implement with bulk agents; assess correctness in a separate pass.

### Agent obligations (paradigm checklist)

- Prefer **small, named, testable** tasks over epic single-shot implementation.  
- **REUSE.BEFORE** non-trivial invent; re-search on stuck failure.  
- **SMOKE.BEFORE** implementation; baseline then post-impl before `[x]`.  
- Treat summaries as **Inferred handles**, not Exact ground truth — recover via session-read / fossil / codegraph.  
- Keep plans, memory, and WC impact **aligned with original goal direction** across iterations.  
- Do not hand-edit ADID receivers; kernel + ADM own framework surfaces. Kernel rules: `REUSE.BEFORE`, `SMOKE.BEFORE`, `PLANNING`, `SEARCH.ORDER`.

### Related docs

- `docs/compaction.md` — mechanistic continuous conversation memory  
- `docs/agi-workflow.md` — orchestrator / worker loop + plan hygiene  
- `docs/reasoning-framework.md` — SPECS stack diagram  
- `plans/README.md` — plan structure (Prior art + Smoke Tests)  
- `opencode_prompts_kernel.py` — typed SPECS / RUNTIME_RULES (canonical policy data)

## TypeScript Style Standards

Follow these external style guides for TypeScript code:

- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) — file structure, language features, control flow, naming, type annotations
- [MetaMask TypeScript Guidelines](https://raw.githubusercontent.com/MetaMask/contributor-docs/372c7b31e951ffec2f71a706099b3df68e4b5f7a/docs/typescript.md) — type inference, type assertions, `any` avoidance, type guards, escape hatches

## Security

- Never expose secrets (API keys, tokens, passwords, private keys) to public git.
- The `.opencode/data/` directory and `logs/` directory are gitignored — use them for sensitive runtime data.
- Any test credentials must use environment variables (e.g., `process.env.XXX_API_KEY`), never hardcoded in source.

## Bug Policy

- This is a development tool. There is no such thing as an "unimportant" or "low severity" bug. Every bug is a problem that degrades the tool for its users — fix it, don't triage it away.
- **There are NO pre-existing errors.** Every TypeScript error, every typecheck failure, every test failure is a real bug that must be investigated and fixed. Do not label errors as "pre-existing" and skip them — that creates an ever-growing pile of broken code that nobody owns. Each error in `tsgo --noEmit` output is a deliverable.
- **Bugs block push.** All bugs — regardless of who introduced them — must be fixed before `git push`. Pre-push hook failures (lint, typecheck, test) are bugs that must be resolved, not bypassed with `--no-verify`. There is no such thing as "someone else's bug" that can be skipped.
- Silent `catch {}` blocks are bugs. If an error can occur, it must be logged. If it's truly expected and ignorable, log at debug level.
- Plan-to-code gaps (a plan claiming something is done when it is not) are bugs and must be corrected in the plan document.
- **Known type workarounds** (documented, not bugs):
  - `src/tool/bash.ts`: `web-tree-sitter` `Parser.init()` requires full `EmscriptenModule` but runtime only uses `locateFile`. Cast to `as any` with comment explaining why.

## KV Cache Continuity

The system prompt is **byte-stable** for the entire session — no timestamps, no mutable markers, no agent switches between turns. This ensures providers see identical SHA256(system prompt) → prefix KV cache hits → minimum recomputation → model preserves its reasoning chain across turns.

**Before modifying any code that touches the system prompt, user messages, or model message conversion, assess KV cache impact:**

- **System prompt** (`src/session/system.ts`, `src/session/prompt.ts` system construction): Must be byte-identical across all turns within a session. No dates, no counters, no `Date.now()`, no random values, no per-turn identifiers.
- **Agent resolution**: Same agent must be used for consecutive turns (including summary/compact turns). Switching agents changes `sys.skills(agent)` output → different system prompt → cache break.
- **Plugin hooks**: `experimental.chat.system.transform` in `llm.ts` receives `system[]` by reference. If a plugin modifies it, fingerprint must be computed AFTER the plugin runs, not before.
- **Date/time**: UTC timestamp is appended to user message text in `prompt.ts` (`new Date().toISOString()`). Never injected into the system prompt. No date extraction logic in `llm.ts`.
- **Message conversion**: `toModelMessagesEffect()` must not inject timestamps, random IDs, or mutable content into converted messages.

**Reporting rule:** If a proposed change has any probability of breaking KV cache continuity, the agent MUST:
1. Explicitly flag it with `[KV-CACHE RISK]` before implementing
2. Explain what would change (system prompt hash, message prefix, etc.)
3. Provide the alternative that preserves cache stability
4. If the change is unavoidable, document it clearly so downstream developers understand the cache invalidation

**Key files:**
| File | What | Cache sensitivity |
|------|------|-------------------|
| `src/session/system.ts` | System prompt construction | `environment()` must be static — no dates, no mutable values |
| `src/session/prompt.ts` | System prompt assembly, fingerprint | System must be identical across paths; fingerprint stored post-plugin |
| `src/session/cache-control.ts` | Fingerprint computation | `partFingerprint` uses MD5(content) for text, not length |
| `src/session/llm.ts` | Plugin hook, provider request | Plugin can modify system by reference; fingerprint must be post-hook |
| `src/session/compaction.ts` | Mechanistic compaction + incremental summaries | `injectSummaryRequest()` every ~32K open-window content tokens (chars/4); `compact()` soft-hides into `message*` (never hard-deletes); see `docs/compaction.md` |
| `src/session/message-v2.ts` | Message conversion | No mutable injection in `toModelMessagesEffect` |

## Conversation Checkpoint System

Per-model encrypted checkpoints (`src/session/checkpoint.ts`) eliminate per-turn prompt assembly and reduce DB reads to delta messages only.

**How it works:**
- After every successful provider response, model-ready state is published in-memory (sync) and encrypted to `{log}/.checkpoints/{provider}_{model}_{agent}_{sid}_S{0|1}.enc` (2-slot rotate)
- **Path system frozen until compact** — AGENTS.md/skills/rules edits mid-session do not rebuild the system prefix (KV cache continuous; multi-project work stays stable). Refresh at compaction or `identityFingerprint` mismatch (kernel/agent prompt only).
- **Per model (+ agent)** — switching models does not discard the other model's slot; each keeps its continuous era.
- **Message deltas** — longest ordered prefix with matching IDs + content fingerprints is reused; suffix (new or in-place-edited messages) is re-converted.
- On failure, disk slots are not overwritten mid-write (atomic rename); memory holds the last good publish.

**Files:**
| File | Role |
|------|------|
| `src/session/checkpoint.ts` | Save/load/remove checkpoints, AES-256-GCM encryption (reuses `request-diff.ts` crypto) |
| `src/session/prompt.ts` | Loads checkpoint at turn start (line 1602), saves after successful response (line 1767) |
| `src/session/request-diff.ts` | Provides `deriveKey`/`encryptBaseline`/`decryptBaseline` — shared crypto primitives |

**Namespaces:**
- Checkpoints: `{log}/.checkpoints/` — per-model conversation state
- Request diffs: `{log}/…_diff_…` diagnostic files; previous request kept in-process (not a separate baseline store)

**Compaction integration (mechanistic continuous memory):** See `docs/compaction.md`.

- **Layer 1:** open-window **counter** (`chars/4` since last summary) ≥ ~32K → system injects summary request. **Model** writes only Inferred prose (SVM, Goal, Key decisions, Current state). **System** owns Exact digits: ignored `from_id`/`to_id`/`session_id` marker, post-summary Exact stamp, fossil/tool diffs for the range, CodeGraph structure. After compact, counter becomes `len(message*)/4` (same rule). Runs on stop and continue. See `docs/compaction.md` § Model vs system.
- **Layer 2:** on overflow, **system** `compact()` builds **`message*`** (summaries + Recent); soft-hide visible messages — **never deleted**. Full history for `session-read` / `messagesearch`.
- **Loop:** `(m*, s, m, m, …)` grows again → compact again. Lone `message*` is idempotent (no-op until growth).
- **Why not one giant “summarize 500k”:** memory soup. **Why not model-authored IDs/diffs:** same class of error as guessing a SHA-256 — system + fossil + CodeGraph only.
- Checkpoint is **removed** on compact; next successful turn saves a fresh `Checkpoint.save()` of the compacted visible set. No separate compaction agent.

**Rollback safety:** Atomic write via temp file + rename — no partial state ever touches disk.

### Checkpoint Invalidation on Kernel Change

The checkpoint `identityFingerprint` is a SHA-256 of `reasoningPromptForIdentity`
(=`reasoning_prompt.txt` + optional kernel tail). **Any change to the kernel** — even a
whitespace fix — changes the fingerprint and **invalidates ALL encrypted checkpoints
for ALL sessions**. This is by design:

- The identity fingerprint ensures a new kernel is never paired with a system prompt
  assembled under an old kernel → KV-cache prefix would be silently wrong otherwise.
- On kernel update: cold start — system prompt reassembled, messages reconverted.
- Path system (AGENTS.md, rules, skills, env) is NOT in the fingerprint — it freezes
  until compaction, preserving KV continuity across project file edits mid-session.

**To minimize disruption**, batch kernel changes into a single commit when possible.
After a kernel change, users experience one "cold" turn per session — subsequent
turns resume normal checkpoint reuse.

## Discovery Rule

```python
# From prompts_kernel/: CODING_AGENT_DIRECTIVES
DISCOVERY_RULES = {
    "search_before_report": True,
    "no_ignore_glob": "pass noIgnore: true to glob/grep for full unbounded search; default is .gitignore-bounded",
    "no_absence_guessing": "Search first, report after. Guessing absence is a bug.",
}
```

## Plan Maintenance

- **After any implementation task completes, audit all `plans/*.md` files.** Mark items `[x]` if code confirms they're done. Move fully-completed plans to `plans_completed/`.
- **Never use `.opencode/plans/`.** Active plans live only in repo-root `plans/`, and completed plans live only in repo-root `plans_completed/`; `.opencode/plans/` is prohibited, not a compatibility location.
- **Reuse before invent (REUSE.BEFORE).** Before non-trivial design/implementation — and again when stuck after build/test/typecheck/runtime failures — use `universalsearch` with `source: "web"` (internet) and/or `source: "code"` (Sourcegraph over indexed git) or `"hybrid"`. Prefer existing solutions; do not reinvent the wheel. Trivial exception: typo/rename/one-line with local codegraph evidence. Plans should note `## Prior art` or `reuse: N/A`. See kernel rule `REUSE.BEFORE`.
- **Smoke Tests before implementation (PRE_FLIGHT).** Every implementable plan must include a `## Smoke Tests` section: baseline commands (cwd + expected-now + Actual [Exact] before first edit) and post-implementation oracles with pass criteria — or `smoke: N/A — {reason}` for pure docs/plan-only. Vague "test later" is forbidden. Do not start code edits until baseline is recorded when smoke is defined. Do not mark items `[x]` until post-impl smoke passes. See `plans/README.md` and kernel rule `SMOKE.BEFORE`.
- **Plan-to-code gaps are bugs.** A plan claiming `[ ]` when code is done, or `[x]` when code is missing, is a bug — correct the plan immediately.
- **Deduplicate overlapping plans.** If two active plans track the same item, pick one as canonical and remove from the other.
- **Use `messagesearch` to verify task completion.** Before implementing any task, search conversation history for prior work on the same item. Re-doing completed work is a bug. If the task was already done, update the plan — never re-implement.
- **Cross-reference grounding.** When reading a plan that references subordinate plan files at specific paths, verify against both `plans/` AND `plans_completed/` before reporting the subordinate's status. A reference found in `plans_completed/` means the master plan is stale — update it, don't propagate the error.
- **Master plan synchronization.** After moving a plan to `plans_completed/`, scan all active plans in `plans/` for references to it. Update any tracking/master plan that lists the completed item — mark it `[x]` Done or move it to a "completed" section. A master plan with stale task status is a plan-to-code gap.
- **Mechanical hygiene (AGI / tooling):** `packages/opencode/src/util/plan-status.ts` — `reconcilePlans(worktree)` moves fully-checked files `plans/` → `plans_completed/` and reopens incomplete files from `plans_completed/` → `plans/`. True “all done” is `active === 0` **and** `misplaced === 0` (`isPlanHygieneClean`). AGI mode runs this automatically; see `docs/agi-workflow.md`. Checkbox content and master-plan prose remain agent duties; directory location is standardized by runtime.

## Style Guide

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

## Backup & Restore

- The `edit` tool automatically creates `.bak` backups of pre-edit file content before each modification.
- Backups live in `{worktree}/.opencode/data/backups/<sessionID>/` (one folder per session).
- Filename format: `<timestamp>_<callID>_<sanitized-path>.bak`
- To restore: copy the `.bak` file over the original file (no git, no adm needed).
- Each session keeps up to 50 backups; oldest are deleted first.

## Fossil Snapshot System

Real-time working-copy tracking with session undo/redo. **Canonical doc:** [`docs/fossil-snapshot.md`](docs/fossil-snapshot.md). Bootstrap: [`docs/startup-bootstrap.md`](docs/startup-bootstrap.md). Bug history: `plans_completed/fossil-undo-redo-fix.md`.

**Key points:**
- **Role**: agent snapshot / undo-redo timeline only (`snapshot.fsl` under data). **Git** is project VCS — do not conflate them.
- **Repo**: `{data}/fossil/{projectID}/snapshot.fsl` (sidecar; never colocated with project `.git`)
- **Binary**: `external/fossil/fossil.exe` (v2.28) or `tools/fossil.exe` next to the executable ([tools-and-sidecars.md](docs/tools-and-sidecars.md) §4.1)
- **Self-healing**: corrupt open → backup `*.bak.*` + `HISTORY_INVALID.json` + reinit; old session hashes fail loud (no silent empty-tree undo)
- **`.gitignore`** → Fossil `ignore-glob` (also ignores `.git` / `.jj`)
- **Undo/redo**: full **leaf** checkout (`revertTo`), not per-file hash mix; structure cleanup = extras ∩ pre-checkout `ls` only; multi-level redo via `session.revert.redo_stack`

**Not the same as project VCS or TUI indicator:**
- **Git** (`project/vcs.ts`) — source control when the worktree is a git repo
- **jj** — TUI footer detection only (`.jj`)
- **TUI indicator** — fossil (green) / jj (blue) / git (red); git monorepo still uses Fossil for agent undo

**Key APIs:** `track`, `checkpoint`, `patch`, `diff` / `diffFull`, `restore` / `checkout`, `revertTo` / `revert`, `impact`

**Integration:** processor tracks write tools + emits patch parts; summary Exact uses tool filediffs + CodeGraph (not Fossil span) — see `docs/summary-exact-handles.md`

**Troubleshooting:** see `docs/fossil-snapshot.md` §8

## opencode paths

- opencode is fully portable — all data lives under `{worktree}/.opencode/data/` (gitignored). Config and auth files live next to the executable.
  - `Global.Path.data`   → `{worktree}/.opencode/data`
  - `Global.Path.config` → executable-adjacent (sibling of opencode.exe)
  - `Global.Path.log`    → `{worktree}/.opencode/data/log`
  - `Global.Path.cache`  → `{worktree}/.opencode/data/cache`
  - `Global.Path.bin`    → `{worktree}/.opencode/data/cache/bin`
  - `Global.Path.state`  → `{worktree}/.opencode/data/state`
  - `Global.Path.home`   → `{worktree}`
- Copy project + executable to any OS and it works — zero OS-specific paths.
- `Global.Path.config` is set from `path.dirname(process.execPath)` at startup.
- Call `Global.initFromWorktree(worktree)` once the worktree is known to switch all data/log/cache paths to worktree-relative.

### Portable Path Architecture (CRITICAL)

**`Global.Path.home` = worktree, NOT `os.homedir()`.** This is by design for full portability — copy the project to any OS and paths resolve locally. All data lives under `{worktree}/.opencode/data/`, not XDG or OS home directories.

**Do NOT change `Global.Path.home` to `os.homedir()`.** If you need the OS user home directory, use `os.homedir()` directly. Code that uses `Global.Path.home` for `~` abbreviation is correct — `~` represents the worktree in our portable model.

**When displaying paths in the TUI**, remember:
- Windows uses `\` as path separator. Always normalize before `split("/")`: use `text.replace(/\\/g, "/").split("/")`.
- When the working directory IS the worktree (after `~` replacement the path is just `~`), there are no subdirectory segments to split. Guard rendering against empty parent segments (e.g., `<Show when={parent}>`).
- The `~:branch` format (worktree + branch) is a single display unit — do not split the `:` part on path separators.

## Plans convention

```
plans/              ← Active plans (to be implemented)
plans_completed/    ← Done plans (historical record)
abstract_futures/   ← DO NOT IMPLEMENT — graveyard of pre-kernel agent hallucinations.
                      Before opencode_prompts_kernel.py was activated, the agent
                      generated speculative "designs" (memory reorganization, Zig
                      migrations, HTTP API rewrites). The kernel eliminated this
                      class of output. These files are kept as a warning, not as
                      deferred work. Never implement from abstract_futures/.
```

- Active plans live in `plans/` at the repo root.
- Completed plans move to `plans_completed/` at the repo root (AGI also auto-moves via `reconcilePlans` when no `[ ]` remain).
- **`abstract_futures/` is a graveyard, not a backlog.** Ideas there predate the Python instruction kernel — the agent was hallucinating architectures without grounding. Do not read, reference, or implement from `abstract_futures/`. If the kernel doesn't mention it, it doesn't exist.
- `.opencode/plans/` is strictly prohibited. Do not create, edit, read as authoritative, migrate from, or preserve plan state there.
- After creating a plan document, run the explore task agent to validate it against the codebase.
- Correct the plan based on explore feedback before implementing.
- **PRE_FLIGHT smoke gate:** plan must contain `## Smoke Tests` (or `smoke: N/A`) before any implementation edit; baseline [Exact] recorded first; post-impl oracles before `[x]`.
- After implementation, verify each plan item against the actual code **and** pass post-impl smoke oracles. Update status markers in the plan document.
- Plan-to-code gaps (a plan claiming something is done when it is not) are bugs and must be corrected in the plan document.
- Before moving a resolved plan to `plans_completed/`, run the explore task agent against the real code execution state and correct any plan-to-code gaps it finds.
- When all items in a plan are resolved and the final explore check is clean, move the plan to `plans_completed/`.
- Plans found outside `plans/` (e.g., `PERF_PLAN.md` at root, `BUN_SHELL_MIGRATION_PLAN.md` in a package) belong in `plans/` and should be moved there.
- After any plan change (creation, status update, completion), run the explore task agent to validate the plan against the codebase. Correct the plan based on explore feedback.

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Searching in Gitignored Directories

- The `glob`, `grep`, and `list` tools are bounded by `.gitignore` — they will not return results from `logs/`, `.opencode/data/`, `node_modules/`, or other ignored paths.
- To search gitignored directories (logs, runtime data, dependencies), pass `noIgnore: true` to `grep` or `glob`:
  ```
  grep("pattern", { noIgnore: true })
  glob("**/opentui/**", { noIgnore: true })
  ```
- The `list` tool does not support `noIgnore` — use `glob` with `noIgnore: true` instead.
- For logs specifically: use the Grep tool with `noIgnore: true` to search `.opencode/data/log` for patterns like `error|ERROR|bug:`.

## Shell Command Restrictions (Constitution)

The runtime constitution (`constitution.ts` + `shell-constitution.ts`) hard-blocks shell **directory/file enumeration** and routes agents to product tools. VCS/PATH oracles that those tools cannot replace stay **allowed**.

| Shell command | Status | Product equivalent / note |
|---------------|--------|---------------------------|
| `ls`, `dir`, `tree` | ❌ HARD BLOCK | `list` (tree listing) |
| `find`, `fd`, `rg --files` | ❌ HARD BLOCK | `glob` (path patterns) |
| `Get-ChildItem`, `gci` | ❌ HARD BLOCK | `list` / `glob` |
| `type`, `cat`, `more` | ❌ HARD BLOCK | `read` (file viewer) |
| `for … *` globs (tree walk) | ❌ HARD BLOCK | `glob` / `list` |
| `findstr` | ✅ **ALLOWED** | Windows content search (like `findstr /s`); product `grep` preferred when convenient, but shell `findstr` is not blocked — not a `list`/`glob` substitute |
| `echo`, `printf` (incl. with `*`) | ✅ **ALLOWED** | print to stdout, not directory enumeration |
| `git ls-files` (all variants) | ✅ **ALLOWED** | VCS oracle — what git tracks / `--error-unmatch`; **not** covered by `list`/`glob`/`grep` |
| `where`, `where /r`, `which` | ✅ **ALLOWED** | PATH lookup; **not** FS tree walk |
| `rg` without `--files` | ✅ ALLOWED | content search (prefer product `grep` when possible) |
| `bun`, `tsc`, `cargo`, `make` | ⚠️ `cmd_runner` only | `cmd_runner start -- <binary> <args>` |
| `cmake`, `gcc`, `g++`, `clang` | ⚠️ `cmd_runner` only | `cmd_runner start -- <binary> <args>` |
| `rustc`, `dotnet`, `msbuild` | ⚠️ `cmd_runner` only | `cmd_runner start -- <binary> <args>` |
| `ninja`, `go` | ⚠️ `cmd_runner` only | `cmd_runner start -- <binary> <args>` |

**Crash-prone binaries** (`bun`, `tsc`, `cargo`, etc.) crash the TUI when executed directly. They MUST run through `cmd_runner`:
```
# ✅ Allowed:
cmd_runner start -- bun run script/build.ts

# ❌ Blocked (will crash TUI):
bun run script/build.ts
```

**`cmd_runner send <run_id> … -- <text>`** — keys/text into an **already-running interactive session**. Typical uses:

1. **SSH / remote shell** — explore the remote host  
2. **Interactive TUI debugging** — drive opencode/other TUI via inbox (prompts, keys, `/slash`, dialogs)

Whatever is after `--` is **session input** for that run, **not** a local agent “browse the project worktree” command:

- **After `--`:** no hard-blocks for `ls`/`dir`/`find`/etc. (remote host *or* in-session shell may need them).  
- **After `--` and bare local shell alike:** **brutal DESTRUCTIVE** still needs permission (`rm -rf`, `DROP`, force-push, `git checkout`/`reset --hard`, fossil mutate, …).  
- **Outside** that payload (normal `bash`/`cmd` tool on the worktree): full constitution — enumeration hard-block, product tools for local tree.

Exploration inside the session (SSH or TUI-attached shell) is free of browsing hard-blocks; destroying data always asks.

Override: `OPENCODE_ALLOW_DESTRUCTIVE=1` (env) or `bypass_constitution` bypasses hard-blocks / destructive gates (not a substitute for product tools).

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## TUI Testing with cmd_runner

When testing opencode TUI interactions (session delete, rename, dialogs, keybinds), use `cmd_runner.exe` to automate the TUI and verify behavior end-to-end.

### Workflow

1. **Build** the binary: `pwsh _build.ps1`  
   - Rebuilds OpenTUI first (`packages/opentui/packages/core` Zig+TS lib, then solid/three), then opencode → `dist/`.  
   - `-SkipOpenTui` skips OpenTUI when only opencode TS changed; `-OpenTuiFull` builds the full OpenTUI monorepo.
2. **Start** opencode from the build output directory (avoids reusing repo-level sessions):
   ```
   cmd_runner start --cwd dist/bin -- opencode.exe
   ```
3. **Check** the TUI initialized: `cmd_runner tail <run_id>`
4. **Send text input** (prompts, `/slash` commands):
   ```
   cmd_runner send <run_id> --text "/new" --crlf
   cmd_runner send <run_id> --text "create a file" --crlf
   ```
5. **Send key combinations** (leader keys, shortcuts):
   ```
   cmd_runner send <run_id> --keys "ctrl+d"        # single chord
   cmd_runner send <run_id> --keys "ctrl+x,n"      # leader + key (ctrl+x then n)
   cmd_runner send <run_id> --keys "DOWN,ctrl+r"   # navigate then action
   ```
6. **Wait** between steps so the agent/UI has time to process.
7. **Verify** side effects: check file system, reopen `/sessions` dialog to confirm state.

### Key notes
- Always launch from `dist/bin` (via `--cwd`) to get a clean project with no pre-existing sessions.
- `cmd_runner list` shows all runs; `cmd_runner stop <id>` to clean up.
- Prefer `/slash` commands (`/new`, `/sessions`) over leader keys when possible — they're more reliable through cmd_runner.
- Session delete: navigate to session in list, `ctrl+d` twice (first press shows confirmation prompt).
- Session rename: `ctrl+r` on session in list, clear old title (`ctrl+a`), type new name, `ENTER`.
- Check `logs/cmd_runner/<run_id>/inbox.jsonl` if sends seem to hang — the bridge may stop processing new inbox entries; restart the cmd_runner run in that case.

## Auto-Generated Code

Some files in the repo are auto-generated by tooling. Manual edits to these files will be overwritten.

| File | Generator | Regeneration Command |
|------|-----------|---------------------|
| `packages/sdk/js/src/gen/` | `@hey-api/openapi-ts` | `bun run packages/sdk/js/script/build.ts` from repo root |
| `packages/sdk/js/src/v2/gen/` | `@hey-api/openapi-ts` (v2 API) | `bun run packages/sdk/js/script/build.ts` |
| `packages/desktop/src/bindings.ts` | Tauri Specta | `cargo run -p specta-bindings` from `packages/desktop/src-tauri/` |
| `packages/opencode/src/session/prompt/reasoning_prompt.txt` | `render_runtime_kernel()` + fragment assemble | `python plans/2026-08-08-cc-generator-integration/_rebuild.py` |
| `packages/opencode/src/session/prompt/reasoning_prompt.mdc` | same + YAML frontmatter | same build script |

After modifying the OpenAPI schema (`openapi.json`), regenerate the SDK before testing.

**Kernel sync:** Run `python plans/2026-08-08-cc-generator-integration/_rebuild.py` to regenerate `reasoning_prompt.txt` + `.mdc` after any kernel source change. The kernel is loaded by `transform.ts` → `systemPromptPrefix()` and embedded in every model's immutable system prompt prefix — stale files mean stale agent definitions at runtime.

**Reasoning protocol fragments:** Edit `prompts_kernel/reasoning/*.txt` (7 topic files), then rebuild via `_rebuild.py`. Do not hand-maintain a giant single reasoning blob when fragments exist.

**This file is host-local (THIS repository only).**  
Product kernel + `reasoning/*` are **host-agnostic**: they must not prescribe or embed `AGENTS.md`, host skill trees, or host rule trees — every worktree differs. Runtime loaders inject whatever *this* host has. See kernel `21_skills_boundary.py`.

**Policy for agents working in this worktree only** (not product SPECS): do not redesign or deep-dive this repo’s `.opencode/skills` / `.opencode/rules` for ordinary product tasks unless the user **explicitly asks**. Using surfaces the runtime already injected for this session is fine.

**Python kernel package:** Canonical source is the `prompts_kernel/` package (TUI-agnostic, self-contained). Public import: `from prompts_kernel import …`. Precompiled module (`_kernel_precompiled.py`) is generated at build time — edit sources not precompiled.

**Python test suite:** Kernel tests under `prompts_kernel/tests/` (488 tests). After SPECS/contract ID changes, run `python -m pytest prompts_kernel/tests/ -q`.


## Kernel Development Workflow

Any kernel modification MUST follow this ordered pipeline:

### 1. Dictionary First

Define rules in `prompts_kernel/27_runtime_dict.py`:
- Add rule bodies to `RUNTIME_RULES` under the correct gate section
- Add gate category to `RUNTIME_RULE_CATEGORIES`
- Add to at least one `RUNTIME_WORKFLOW` (or precompiled will reject)

### 2. Regenerate

```bash
python -c "from pathlib import Path; from prompts_kernel._assemble_prompts_kernel import write_precompiled_kernel; write_precompiled_kernel(Path('prompts_kernel'))"
python plans/2026-08-08-cc-generator-integration/_rebuild.py
```

### 3. Update Tests

- `prompts_kernel/tests/test_runtime.py` — ownership, references, contracts
- `prompts_kernel/tests/test_gate_dictionary_refs.py` — gate @REF resolution
- `prompts_kernel/tests/test_prompt_schema.py` — pocket size limits

Run: `python -m pytest prompts_kernel/tests/ -q`

### 4. Commit

Single commit: source changes + regenerated kernel + test fixes.
## Dependency Catalog (MANDATORY)

All shared dependencies MUST be declared in the root `catalog` (`package.json` → `workspaces.catalog`) and referenced as `"catalog:"` in sub-packages. Hardcoded versions in sub-package `package.json` files cause version drift, duplicate installs, and subtle runtime conflicts.

### Procedure

**After adding, upgrading, or removing any dependency** in any sub-package:

1. Run the consolidation script:
   ```
   python consolidate_catalog.py --dry-run
   ```
2. Review conflicts (⚠️ = multiple versions picked newest; ⛔ = major version conflict, skipped)
3. Resolve any ⛔ conflicts manually — major version splits are usually intentional (e.g. React 18 vs 19)
4. Apply:
   ```
   python consolidate_catalog.py
   ```
5. Verify:
   ```
   bun install   # must produce ZERO "incorrect peer dependency" warnings
   ```

### Rules

- **Every dep used in 2+ packages belongs in the catalog.** Single-use deps stay in their package.
- **Never hardcode a version that exists in the catalog.** Use `"catalog:"` reference.
- **Workspace packages** (`"workspace:*"`) are local and do not go in the catalog.
- **Version ranges** (`^1.0.0`, `~1.0.0`, `>=2.0.0`) are NOT consolidated — they're intentional flexibility.
- **Desktop TypeScript version** (`packages/desktop/`, `packages/desktop-electron/`): Both pin `typescript@~5.6.2` while the rest of the monorepo uses `5.8.2` (via root catalog). This is intentional — Tauri Specta bindings and Electron tooling have known compatibility constraints with TS 5.8. Do not upgrade these packages without verifying Tauri/Electron builds.
- **@opentui vs @opencode-ai/ui**: `@opentui/core` and `@opentui/solid` are **external** dependencies installed in `node_modules/@opentui/`. The monorepo's own UI library is `@opencode-ai/ui` in `packages/ui/`. To search `@opentui` source, use `glob("**/opentui/**", { noIgnore: true })`.

### CI Enforcement (future)

A CI check should run `consolidate_catalog.py --dry-run` and fail if any hardcoded versions could be cataloged. This keeps the monorepo permanently consolidated.

## Markdown Rendering Flag — DO NOT TOUCH

**`OPENCODE_MARKDOWN` must always default to `true`.** This is the standard markdown rendering path — not experimental. The OpenTUI `<markdown>` renderable is the correct renderer for tables, folding, headings, and all GFM features. Flipping it to `false` silently breaks tables, collapsible sections, and other native markdown formatting.

- Defined in `packages/core/src/flag/flag.ts` — uses `!falsy(...)` semantics (on-by-default)
- The config-override `_setTest("OPENCODE_MARKDOWN", false)` exists for testing only
- The `<code filetype="markdown" onHighlight={...}>` fallback path with tree-sitter highlight preservation exists as a safety net for anyone who explicitly opts out — **never make it the default**

If the OpenTUI `<markdown>` renderable has a bug (e.g., nested CodeRenderable streaming state), fix it in the renderable — do not work around it by flipping this flag.

## Completed Research

Research analyses were removed. All findings were triaged and resolved — see `plans_completed/` for linked implementation plans.

## Agent Inventory

The project defines these built-in agents (`packages/opencode/src/agent/agent.ts`):

| Agent | Mode | Prompt | Description |
|-------|------|--------|-------------|
| `build` | primary | provider family prompt | Default full-access development agent |
| `plan` | primary | provider family prompt | Read-only planning (denies edits) |
| `orchestrator` | primary | `prompt/orchestrator.txt` | Autonomous development orchestrator — ADID AgentStrategist+AgentAnalyst. Delegates to sub-agents, verifies against oracles, drives plans to completion. For AGI mode. |
| `general` | subagent | `prompt/general.txt` | Planning, design, root-cause analysis |
| `explore` | subagent | `prompt/explore.txt` | Fast file/code/conversation search |
| `coder` | subagent | `prompt/coder.txt` | Code implementation (edit/write/bash) |
| `researcher` | subagent | `prompt/researcher.txt` | Read-only research (code+web+history) |
| `media` | subagent | `prompt/media.txt` | Media generation via capability tool |
| `title` | primary (hidden) | `prompt/title.txt` | Session title generation |
| `summary` | primary (hidden) | `prompt/summary.txt` | Session summarization |

**Tools of note:** `pipeline` chains subagents sequentially (researcher→coder, explore→general). `capability` looks up model output modalities against available API keys.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code.

**CodeGraph hybrid (hard rule):** MCP owns the live graph (`mcp.codegraph` → `codegraph serve --mcp`). Opencode then packs **readonly SQLite** structure for agents/fossil (low noise). MCP prose is **not** the agent output. Soft-fail when MCP is down is **forbidden**.

- **Built-in `codegraph` tool:** MCP touch → SQLite pack (symbols, cross-file edges, external files). Prefer including file paths in the query.
- **Fossil impact/tag:** same hybrid on changed files (`KINDS|TOP|IMPACT` from SQLite).
- **Config:** `mcp.codegraph` is **auto-injected** on config load when `.codegraph/` or `codegraph` binary exists (opt out: `OPENCODE_CODEGRAPH_MCP=0`). Optional `CODEGRAPH_HYBRID_DEBOUNCE_MS` (default 500). See `docs/codegraph-mcp.md`.
- **Do not** write `codegraph.db` or use CLI reindex as a silent fallback (~20m).

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision. Plan: `plans/2026-07-23_codegraph_mcp_only.md`.
<!-- CODEGRAPH_END -->
