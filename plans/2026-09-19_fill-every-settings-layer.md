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

---

## 7. Inventory — the ad-hoc state this rule retires (measured 2026-09-19)

Owner: «Я не про только agents — у нас соплей море, вылезло — туда, ещё вылезло — опять туда.»
So the list, so the next "вылезло" has a DEFINED destination instead of a new file.

**True runtime state — the actual сопли (not user config, not relational data):**

| file | touched by | why it is a race |
|---|---|---|
| `{state}/model.json` | `session-settings.ts:243`, `provider.ts:1837`, `gateway/config-manager.ts:304` | **one file, three modules** — a lost-update surface by construction |
| `{state}/kv.json` | TUI KV (`config-scope.ts:12`) | scope choice plus whatever else the KV store accumulates |
| `{state}/plugin-meta.json` | `plugin/meta.ts:52` | |
| `{data}/sessions/{sessionID}.jsonc` | `session-settings.ts:389` | **one file per session** |
| `{data}/gateway/<STORE_FILE>` | `gateway/store.ts:131,181` | |
| `{data}/memory/memory.db` | `memory/memory.ts:12` | its own SQLite beside the main one |
| `{data}/bugs/*` | `index.ts:210` | |
| `{data}/backups/{sessionID}/*` | `edit.ts:87`, `edit-backup.ts:17` | edit-tool `.bak` files |
| `{data}/tool-output/*` | `truncation-dir.ts:5` | |

**User-authored config — STAYS a file** (rule 3 writes back only on a real edit):
`opencode.jsonc` / `opencode.json` / `config.json`, `auth.json`, `mcp-auth.json`, `gateway.jsonc`,
`models_capabilities.yaml`, `tui/*`, `themes/*`.

**Already relational, stays on SQLite unchanged:** sessions, messages, parts, jobs, balance, sync,
codegraph.

So the migration target is small and NAMED: the state-plane rows above, `model.json` first — it is
the one with three writers.

## 8. Engine probe — measured, so it is not re-argued (2026-09-19)

`lmdb@3.5.6` (MIT, Node-API) installed and ran under Bun on this host; the prebuild
(`download-lmdb-prebuilds11`) is fetched by `bun add`, so win32-x64 works with no compiler.

| property the ruling needs | measured |
|---|---|
| strict key separation | **3 DBs in ONE environment** via `openDB`, read back independently ✓ |
| sync hot-path reads | **100 000 reads in 70.7 ms = 0.71 µs/read** (mmap, no I/O) ✓ |
| one writer / one batch queue | `transaction()` spanning two DBs committed together ✓ |
| footprint | `data.mdb` 262 144 B (preallocated map) + `lock.mdb` 8 128 B |

Two honest caveats: the `ifVersion` line in the probe is INCONCLUSIVE (the version was passed
positionally, so both conditional puts returned false — the probe was malformed, not the feature),
and on Windows LMDB keeps the file mapped, so `rmSync` of the directory throws `EBUSY` — a test must
close the env, or a temp store cannot be cleaned up.

## 8b. `bun --compile` + a native addon — MEASURED 2026-09-19

This was the open "could still change the plan" risk. Four arms, one host, one moment:

| arm | build | runtime cwd | result |
|---|---|---|---|
| A | `import { open } from "lmdb"` (lmdb resolves its own `.node` at runtime) | node_modules adjacent | **FAIL** — `No native build was found … attempted loading from B:\~BUN\root` |
| B | `createRequire` **literal** path to the `.node` | dir WITH node_modules | PASS |
| C | same build as B | dir WITHOUT node_modules | **FAIL** — `Cannot find module './node_modules/…' from 'B:\~BUN\root\probe-static.exe'` |
| D | **static ESM `import` of the `.node`** | dir WITHOUT node_modules, **addon deleted from disk** | **PASS** (`STATIC_IMPORT_OK`) |

Two facts follow. **(1)** A runtime-resolved addon is invisible to the bundler, and inside a compiled
binary the path resolves through Bun's virtual root against the **cwd** — copying `node_modules`
beside the exe is NOT enough. **(2)** A statically imported `.node` IS embedded: the build reports
`bundle 2 modules`, the run succeeds with the addon absent from disk, and the byte delta
`87 000 064 − 86 087 168 = +912 896 B` matches `912 925 B` for `node_modules/@lmdb/lmdb-win32-x64`.

Cost: **+912 896 B** (lmdb) in the binary, plus `@msgpackr-extract` at 225 736 B if that path is used.
**Not yet done:** the per-platform import shim naming `@lmdb/lmdb-<platform>-<arch>` literally, and a
real `_build.ps1` binary carrying it. The remaining work is a named shim, not an open question.

## 8c. Store options — what we set, and what we do NOT (checked against the package README, 2026-09-19)

Three options were proposed (by an outside model) as the concurrency fix. Checked verbatim against
the `lmdb` README: one is real but for a different reason, two are wrong for settings — and one of
those does not exist.

| proposed | README says | verdict |
|---|---|---|
| `sharedStructuresKey: Symbol.for('shared')` — "lets several processes safely open one DB" | "stores the structural information about objects stored in database in dedicated entry … for much more efficient storage and faster retrieval" (§ Shared structures) | **real, wrong reason.** Multi-process safety is inherent ("designed for high concurrency, and we recommend using multiple processes", §Concurrency). Keep it — but because our records are uniform, which is its actual stated benefit |
| `noSync: true` — "async flush; if one process crashes the DB won't be locked; writes batched" | "Does not explicitly flush data to disk at all … **we discourage this flag for data that needs integrity and durability in storage, since it can result in data loss/corruption if the computer crashes**" | **wrong for settings.** Batching is already the default (`eventTurnBatching`); a crashed process's locks are released by the OS, not by `noSync`. It trades INTEGRITY for WRITE speed |
| `noMetaSync: true` | "This isn't as dangerous as `noSync`, but **doesn't improve performance much either**" | **pointless** — a stated downside with no stated upside |
| `overlappingSource: true` — "disable mmap for writing so the OS manages page locks" | **no such option in the README.** There is `overlappingSync` (a different thing, default ON off-Windows). The closest real one is `useWritemap` — "can increase risk of a stray pointer corrupting data, and **may be slower on Windows**" | **rejected.** Wrong name, invented rationale, and the nearest real flag is contraindicated on our platform |

**None of these touches the race we actually have.** Ours is *logical* — two read-modify-write
cycles over `{state}/model.json` from three modules. No engine flag removes that; only one
serialized writer or optimistic conditional writes do. `noSync` is orthogonal to races and costs
exactly the property being bought (settings must not be losable).

**What we DO set**, from the same README:

- `useVersions: true` + `ifVersion` / `ifNoExists` — the direct answer to the lost-update class:
  "provides a robust mechanism for concurrent data updates even with multiple processes are
  accessing the same database". This matters concretely because `jobs.db` already showed that a
  store in this project is **shared by every runtime in the worktree**.
  **Constraint:** "you can not change this flag once a database has entries in it" ⇒ versioning
  must be decided **at store creation**, before `model.json` is migrated. Decide it first, not later.
- `sharedStructuresKey` — yes, for storage/read efficiency on uniform records.
- **Default sync config**, and `await db.put()` as the durable commit (a resolved promise means
  "fully written to the physical storage medium … even if there is power loss or system crash").
  `separateFlushed` only if we ever need to distinguish *visible* from *durable*.
- **Explicitly NOT set:** `noSync`, `noMetaSync`, `useWritemap`.
- Caveat that limits all of the above: `ifVersion` only helps if **every** writer goes through the
  store. A writer that ignores versions still wins — which is why §7's inventory (all three writers
  of `model.json`) is the completion condition, not a starting point.
