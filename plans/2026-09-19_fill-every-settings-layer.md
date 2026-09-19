# Fill every settings layer — no runtime parent-search

<!-- intention: values resolve by walking session → worktree → global at READ time -> every layer is physically populated and a read is a plain lookup -->

**Owner ruling (2026-09-19, verbatim):** «каждый конфиг если его нету должен быть заполнен,
никаких etheritance быть не должно, всё заполнено, чёткий дубль. Если не заполнен — заполнить.
А не как сейчас — ой настройки не заданы, ой ищем parent, а если нету ой ищем parent — а потом
ой а как в остальном софте — и количество поверхностей растёт в геометрической прогрессии.»

So: **fill, do not search.** A layer that lacks a value gets one written into it. Reads become a
direct lookup of one layer. The chains that walk parents are DELETED, not documented.

---

## 1. Current state (grounded, file:line)

Three layers, two read-time chains, zero fill.

| layer | storage | populating code |
|---|---|---|
| session | `{worktree}/.opencode/data/sessions/{sessionID}.jsonc` (`SessionSettings`) | **none** — `saveSessionSettings` is called only from user actions in `/agents` (`local.tsx:263,430,540,636,744,790,976,1067,1174`) |
| worktree | `{worktree}/…/model.json` (`MODEL_STATE_KEYS`) | **none** — `workspaceAgentModel` is a read-through resolver |
| global | `opencode.jsonc` → `agent` section, surfaced as `sync.data.agent[name].model` | user-authored only |

The chains to remove:

- `forAgent(name)` — `local.tsx:383-399`: session → worktree → global agent config.
- `layerView(name, scope)` — `local.tsx:556-569`: ONE layer, no fallback. **This is why `/agents`
  renders `inherits from worktree` with no model**: the row is layer-pure by design (2026-08-31
  ruling) and the layer is empty because nothing ever filled it.
- `fallbackModel` — `local.tsx:331-371`: `args.model` → `config.model` → `recent[0]` → provider
  default → first model. Applied only to the *current* agent (`currentModel`, `:373-381`).
- `session-settings.ts:16-19` — the module docstring literally documents the priority chain.

`big-pickle` exists as the free-tier final default, but **only in `acp/agent.ts:1646-1669`** — it is
not part of the TUI chain at all.

## 2. Target

Fill order (each layer filled from the one above it, at the moment it comes into existence):

1. **worktree ← global** — when the worktree state file has no entry for an agent, write it.
2. **global ← build model** — for every agent the global config does not define.
3. **global ← `opencode/big-pickle`** — when there is no build model either, i.e. no models at all.
4. **session ← worktree** — when a session is created, copy every agent's model into it.

After that, reads are trivial and the chains are deleted:

- `forAgent(name)` → the session entry (always present).
- `layerView(name, scope)` → that layer's entry (always present). `/agents` therefore shows a real
  model in **every** scope, and the 2026-08-31 layer-pure ruling stays satisfied *literally*.
- `fallbackModel` → the current agent's entry; the chain collapses.

## 3. Deletions (the point of the exercise)

Removing surfaces is the deliverable, not a side effect:

- `forAgent`'s three-step search → one read.
- `fallbackModel`'s four-step chain → one read.
- The "Loading priority" docstring in `session-settings.ts` → "every layer is filled; a read is a
  lookup".
- The `inherits from <scope>` label in `dialog-agent.tsx:205` becomes unreachable. `/agents` should
  not need it: a missing value is a bug to fix by FILLING, not a state to display. Keep the label
  only as a guard that becomes visible if a layer is somehow unfilled.
- Audit `sessionAgentVariant` / `sessionAgentRouting` / `effectiveSubagents` for their own
  parent-walks; each loses its walk on the same rule.

## 4. Open decisions (settle before implementing)

1. **Which keys get filled** — models only, or every key in `SESSION_SETTINGS_KEYS` /
   `MODEL_STATE_KEYS` that has a source? The ruling says «чёткий дубль» → fill all that have a
   source. Recommendation: **models + variant + sampling**; subagents/routing only where a source
   exists.
2. **Fill once, never re-fill** — a copy is a copy: after filling, a later worktree change does NOT
   flow into the session (that is the stated price). Recommend: fill once at creation;
   `copyFromParent`/`copy-from-worktree` stays as the *explicit* re-sync action.
3. **Scope of the global fill** — for every agent in `sync.data.agent` (bounded), NOT for every
   model in the catalogue.
4. **The build model's identity** — `sync.data.agent["build"]?.model`. Needs confirming against the
   agent inventory before it is used as the fill source.

## 5. Smoke Tests

Baseline before ANY edit; each test names the layer it proves.

- **S1 — global ← build.** Temp worktree, global config with NO agent models → after fill, every
  agent in `sync.data.agent` has a `model` in the global layer, and it equals the build agent's
  model.
- **S2 — nothing at all → big-pickle.** Global with no agent models AND no build model → the fill
  lands `opencode/big-pickle`.
- **S3 — worktree ← global.** New worktree, global defines model X for agent A → `model.json`
  contains `workspaceAgent[<scope>][A] = X` after fill (read the FILE back — write-path oracle).
- **S4 — session ← worktree.** Create a session → its `.jsonc` contains an `agent` entry with a
  concrete model for **every** agent in `sync.data.agent` (assert `model` is defined for each; no
  `undefined`, no gaps).
- **S5 — copy, not link.** After S4, change the worktree value → the session value is UNCHANGED.
  This is the test that proves "чёткий дубль" rather than a hidden chain.
- **S6 — render.** `/agents` shows a concrete model in all three scopes. Needs the rebuild
  (`bin/opencode.exe` predates today); oracle = cmd_runner inbox or a cua screenshot of the dialog,
  not a typecheck.

## 6. Ordering vs the pending build

The build the owner is waiting on is **independent** of this work, but `bin/opencode.exe` predates
every commit from today, so a build now ships tonight's budget/cleanup work and NOT this. Recommend:
land S1–S3 first (global and worktree fills — they are what make `/agents` non-empty before a
session exists), then S4–S5 (session fill), then S6 after the rebuild.
