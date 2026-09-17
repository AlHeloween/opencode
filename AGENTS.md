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
- KV cache must be byte-stable across session turns
- No .opencode/plans/ — only plans/ and plans_completed/
- After plan changes, run explore agent to validate
- Tests cannot run from repo root — run from package dirs
- Avoid mocks in tests — test actual implementation
- Reach every provider from the HIGHEST surface down: newest API version first, then h3 -> h2 -> http/1.1

forbidden_actions:
- Exposing secrets (API keys, tokens, passwords, private keys) to git
- Using git push --no-verify (or any --no-verify variant)
- Using silent catch {} blocks
- Labeling errors as "pre-existing" — every error is a deliverable
- Planning from .opencode/plans/ directory
- Breaking KV cache continuity (system prompt must be byte-stable)
- Running tests from repo root
- Changing Global.Path.home from worktree to os.homedir()
- Hand-editing ADID framework receivers — change only via kernel SPECS or ADM pipelines
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

acceptance_tests:
- git status confirms Local_Development branch
- No catch {} without log statements
- Plan files in plans/ match actual code state
- KV cache fingerprint stable across consecutive turns
- No git push --no-verify in development workflow

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `Local_Development`.
- Prefer automation: execute requested actions without confirmation unless blocked by safety/irreversibility.
- This is **not a branch of anything** — it is a separate project that shares an
  ancestor. Never port upstream architecture in, never "sync with upstream", and
  never treat an upstream diff as mergeable: the same identifier names a
  different system on each side (Hono vs Effect server, Fossil vs git snapshots,
  per-worktree vs central state). Measured 2026-09-17: of 190 same-named source
  files, zero are byte-identical.

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

### Agent obligations

- Prefer **small, named, testable** tasks over epic single-shot implementation.
- **REUSE.BEFORE** non-trivial invent; re-search on stuck failure.
- **SMOKE.BEFORE** implementation; baseline then post-impl before `[x]`.
- Treat summaries as **Inferred handles**, not Exact — recover via session-read / fossil / codegraph.
- Do not hand-edit ADID receivers; kernel + ADM own framework surfaces (why both canons exist: [docs/two-canon-protocol.md](docs/two-canon-protocol.md)).

---

## Bug Policy

- No such thing as an "unimportant" bug. Every bug degrades the tool — fix it.
- **There are NO pre-existing errors.** Every typecheck/test failure is a deliverable.
- **Bugs block push.** All bugs must be fixed before `git push`. No `--no-verify`.
- Silent `catch {}` blocks are bugs — must log (debug for expected, warn for unexpected).
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

- Active plans in `plans/` (repo root). Completed → `plans_completed/`.
- **Never use `.opencode/plans/`.**
- After implementation, audit `plans/*.md` — mark `[x]` if code confirms done.
- **PRE_FLIGHT smoke gate:** plan must have `## Smoke Tests` (or `smoke: N/A`) before any edit.
- Plan-to-code gaps are bugs.
- Use `messagesearch` to verify task completion before implementing.
- After moving to `plans_completed/`, scan active plans for stale references.

Tool: `packages/opencode/src/util/plan-status.ts` — `reconcilePlans()` auto-moves completed plans. See [docs/agi-workflow.md](docs/agi-workflow.md).

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
| `findstr` | ✅ ALLOWED | Windows content search |
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

---

## Type Checking

Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

---

## TUI Testing with cmd_runner

Use `cmd_runner.exe` to automate TUI interactions. Launch from `dist/bin` for clean sessions.

Workflow: build (`pwsh _build.ps1`) → start → tail → send text/keys → verify.

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
- Read output: `job_output` / `cmd_runner tail`

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
`temperature` / `topP` / `presencePenalty` / `options.repetition_penalty` in
`src/agent/agent.ts` — verification identities (`explorer`, `coder`) are
sampled tight and unpenalised so their output is reproducible and their
repeated tokens (paths, identifiers) survive; generative ones (`general`,
`media`) are sampled loose so a candidate set actually differs. Model-wide
sampling merges *before* the agent in `session/llm.ts`, so the narrower
declaration wins. Only what the provider honors binds — see the vendor
reasoning contract below.

---

## Documentation Index

All detailed docs live in `docs/`. Here's the quick map:

### Memory / Session
- [Mechanistic Compaction](docs/compaction.md) — Layer-1 summary + Layer-2 compact
- [Summary Exact handles](docs/summary-exact-handles.md) — tool filediffs + CodeGraph
- [Session memory graph](docs/session-memory-graph.md) — cadence vs safety (mermaid)
- [Finish-step TX graph](docs/finish-step-tx-graph.md) — `runBatch` / single SQLite TX

### Architecture / Stack
- [Architecture](docs/architecture.md) — prompt system, checkpoint, compaction, agents, KV cache
- [Kernel package](prompt_kernel/README.md) — gate graph, serialization order, source of the runtime prefix
- [Two-canon protocol](docs/two-canon-protocol.md) — ADID 15.3 (untracked, package-rendered) ↔ kernel parity: one protocol, two compilers; why both exist
- [Kernel amendment](docs/kernel-amendment.md) — SELF_MODIFY depths, constitution core, the build procedure that replaces hand editing
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
- [Background Jobs](docs/background-jobs.md) — non-blocking shell jobs
- [Kernel assembly point](docs/kernel-assembly-point.md)

### Deployment
- [Linux deploy](docs/linux-deploy.md) — Linux build and portable install

<!-- CODEGRAPH_START -->
## CodeGraph

Reach for it BEFORE grep/find when you need to understand code. MCP owns the live graph; SQLite packs readonly structure for agents.

- Built-in `codegraph` tool: MCP touch → SQLite pack (symbols, cross-file edges).
- Config: auto-injected when `.codegraph/` exists (opt out: `OPENCODE_CODEGRAPH_MCP=0`).
- Do not write `codegraph.db` or use CLI reindex as fallback.

Full details: [docs/codegraph-mcp.md](docs/codegraph-mcp.md)
<!-- CODEGRAPH_END -->
