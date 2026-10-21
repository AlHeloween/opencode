# t87 — global recents is the CONSTRAINT every model layer obeys

<!-- intention: stale per-worktree/session/chain model picks run unchecked -> every worktree, session and chain layer is checked against the global recents allowlist before a model is used -->

```yaml
Keywords: global-recents-allowlist 0.35, layer-model-constraint 0.25, stale-worktree-model 0.20, plan-and-red-tests 0.12, no-parent-walk 0.08
Semantic dominant: The global recents list becomes the single allowlist that every worktree, session and chain layer is checked against before a model is used.
md5: 6d0b84e2f9a317c5b8e0d4a6c2f91b73
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 6d0b84e2f9a317c5b8e0d4a6c2f91b73
```

## Status

- [x] G1 grounding: location table (§2) + consumer table (§3) read from code, graph before grep
- [x] RED tests written, run one file per call through cmd_runner (§7)
- [x] Commit plan + RED tests through `scripts/commit_own.py`, plus a `_progress_log.md` line (97af50e9)
- [x] STOP — Legislator reviewed (PASS 2026-10-18, §8 decisions settled)
- [x] Implementation: gate in every §3 consumer (resolvers, assign head fallback, prompt/shell/command/title, task/pipeline/plan/reasoning, aicall, chain PUT write-gate, llm stream filter, small-model head), TUI writer/surface/marker, migration display, renamed-model failover (classify withdrawn + stream note + head fallback); RED→GREEN runs one file per call (§7 + §8)
- [ ] OWNER BOX (do not close the plan): owner enters `globalRecents` in the TUI (Global recents action, ctrl+alt+r) — proposed seed: free zen → contributor via Go (owner order 2026-10-16). The plan stays ACTIVE until this box is ticked by the owner's own edit.
- **t135 (2026-10-22): class (c) — an owner ACTION, quoted from this box:** «The plan stays ACTIVE until this box is ticked by the owner's own edit». Resume: the owner enters `globalRecents` in the TUI (Global recents, ctrl+alt+r) with the proposed seed (free zen → contributor via Go, owner order 2026-10-16). The robot may not tick it. Every other box in this plan is closed — this box IS the remainder, and it is one action, not a project.

## 1. Incident and mechanism (measured)

- `D:/zPython/ADID_Python/.opencode/data/state/model.json` held
  `workspaceAgent.default.{build_mode,plan_mode,orchestrator_agent,…} = opencode-go/glm-5.3-flash`
  (written 10-15). A host launched from our bin ran ticket af66e83a21 on it for 14 steps (10-18).
  Owner: not allowed — the current order is free zen → contributor via Go.
- Mechanism A — `resolveAgentModel` (`packages/opencode/src/session/session-settings.ts:281-303`):
  returns the session pick, else the worktree pick («last explicit pick in this worktree»), else
  nothing. Nothing checks either pick against the global list.
- Mechanism B — `fillChainForNewLayer` (`packages/opencode/src/provider/model-chain/chain.ts:93-96`):
  copies the parent once; «the parent is never consulted again», so a lower layer never learns
  that the global list changed. `resolveChainAgentModel` (`session-settings.ts:313-328`) takes
  the first UP member of whatever the session layer holds — no membership check.

## 2. Location table — which «global recents» is the authority

| # | Object | Path:line | Writer(s) | Reader(s) | Verdict |
|---|---|---|---|---|---|
| L1 | Per-worktree recents/favorites (`recent`, `favorite`, max 10) | `packages/opencode/src/cli/cmd/tui/context/local.tsx:164-195` store; persisted to `{worktree}/.opencode/data/state/model.json` by `save()` `:284-307` via `set()` `:1251-1258`, `taskSet()` `:620-626`, global pick `:752-759` | `local.tsx` `set`/`taskSet`/`setGlobalAgentSelection`; TUI dialogs `dialog-model.tsx:121,149-198`, `dialog-agent.tsx:146-147`; `cycle`/`cycleFavorite` `:1128-1170` | per-worktree history for the picker. NOT the authority — one copy per repo, exactly the «100 model.json» the requirement refuses to touch |
| L2 | Per-session recents/favorites | `packages/opencode/src/session/session-settings.ts:49-52`; file `{worktree}/.opencode/data/sessions/<sid>.jsonc`; merged in `local.tsx:240-253`, written by `sessionPayload()` `:256-270` | `refreshSessionSettings`, `saveAll` | session-local mirror. NOT the authority |
| L3 | Chain global scope (`model_chain` scope `"global"`) | `packages/opencode/src/provider/model-chain/chain.sql.ts`; `store.ts:44-82` (`loadChain`/`saveChain`/`loadScopeChains`); `chain.ts:4-6` («the chain is the ordered form of recents»); route `GET|PUT /chain/:scope/:agent` in `server/routes/instance/httpapi/chain.ts:42-66,83-117` | chain dialog/web form via `chainHandlers.set` `:109-117`; `fillSessionChains` (`store.ts:140-172`) copies `session:<parent>` → `worktree:<id>` → `"global"` at session birth | the ordered per-agent list — but the table lives in the **worktree DB** (`storage/db.ts:44-45`: `dbPath = {worktree}/.opencode/data/opencode.db`), so scope `"global"` is global in name only. NOT cross-repo as stored |
| L4 | Global config layer S0 (agent declarations) | `bin/opencode.jsonc` → `agent.<name>.model` (executable-adjacent = `Global.Path.config`); writer `writeGlobalAgentField` (`local.tsx:634-682`) + `setGlobalAgentSelection` (`:724-759`) via `PATCH /global/config`; readers `sync.data.agent` (S4 ← S0) and server `ag.model` | global + worktree + session scopes (`local.tsx`), server fallbacks (`prompt.ts`) | the ONLY file shared by every worktree launched from our bin. PROPOSED authority host |

**Decision: L1/L2/L3 are three per-worktree lists with two shapes (history vs ordered chain).
The ONE authority is a new ordered key on L4 — `globalRecents: ["prov/model", …]` in the
exe-adjacent global config (bin/opencode.jsonc), seeded from the current S0 agent models
(free zen → contributor via Go).** L3's `"global"` scope rows become its per-worktree
materialization, re-seeded from L4, and every resolver gates against L4 at USE time.
No `model.json` in any repo is rewritten by this change.

Why not L3-as-is: its rows die with the worktree DB — a fresh clone has no `"global"` row,
and 100 repos mean 100 divergent «global» lists. Why not L1: unordered history, capped at 10,
already polluted by the stale pick itself (every `set(..., {recent:true})` prepends it).

## 3. Consumer table — who picks a model, and where the gate goes

Gate shape everywhere (identical): after a layer value is read, ONE lookup of ONE key (the L4
list) — member → use it; else `Log.Default.warn("bug: layer model not in global recents",
{layer, agent, model})`, fall to the next layer. TUI additionally shows the stale value
(per AGENTS.md: every option controllable, never silent).

| Consumer | Path:line | Today | Gate |
|---|---|---|---|
| `resolveAgentModel` (single choke for task/pipeline/plan/reasoning/prompt) | `session-settings.ts:281-303` | session → worktree → undefined, no check | gate EACH layer value before returning; fall through on miss |
| `resolveChainAgentModel` + `firstUp` | `session-settings.ts:313-328`; `chain.ts:123-129` | first UP of session chain, no check | filter chain to L4 members at USE (covers «filled before the list changed»); empty-after-filter → warn + `undefined`, caller falls to legacy path |
| `task.ts` chain+legacy+taskModel | `tool/task.ts:234-272` (chain `:239`, legacy `:250`, `taskModelOverride` `:256-263` from `model.json` `taskModel`) | precedence chain → legacy → global-decl → taskModel → parent model | inherits both resolver gates; `taskModelOverride` gated the same way (it is a worktree layer value) |
| `pipeline.ts` | `tool/pipeline.ts:210-233` | chain → legacy → step/default | inherits both resolver gates |
| `plan.ts`, `reasoning.ts` `transitionModel` | `tool/plan.ts:19,42`; `tool/reasoning.ts:35-37` | `resolveAgentModel ?? target?.model ?? fallback` | inherits; `target?.model` (global declaration) is BY DEFINITION in-list — no gate; `fallback` (last-message/default) IS gated (a pre-change message can name a stale model) |
| `prompt.ts` `createUserMessage` | `session/prompt.ts:992-1025` | `input.model ?? resolveAgentModel ?? ag.model ?? lastModel` | inherits; `ag.model` exempt (authority's own value); `lastModel` gated like fallback above |
| `prompt.ts` `shellImpl` / `command` | `session/prompt.ts:672-679`, `:3104-3120` | `input.model ?? agent.model ?? lastModel` + labeled `used:` warns (T4 rule) | same as above; the gate reuses the `used:` label channel |
| `aicall.ts` | `tool/aicall.ts:126-178` (chain `:152-153`; explicit model/provider `:133-149`; router REFUSAL precedent `:139-148`) | chain without check; explicit param trusted | chain path inherits; explicit param: REFUSE outside-list like a router (same envelope style), needs Legislator confirm — explicit ≠ layer, over-gating here could break probes |
| title / small models | `prompt.ts:358-387` (`provider.getSmallModel`, `small: true`); `provider/provider.ts:1056,1839` | provider-chosen, not a layer pick | EXEMPT as a pick, but the returned member must be in-list: gate at the title call site (fall back to first L4 member + warn). Small/experimental ≠ stale |
| TUI `local.tsx` read + write | read `forAgent` `:470-496` / `currentModel` `:448-451`; write `set` `:1171-1286`, `taskSet`, `cycle` | read is session/worktree lookup; write validates only `isModelValid` (connected-now) | write: refuse out-of-list pick with toast (mirrors `isModelValid` `:1212-1219`); read: render stale layer value with a marker (kept, shown, never silently run — server gate already refuses to run it) |
| chain httpapi + `assignChainModel` | `chain.ts:83-117` view/set; `provider/model-chain/assign.ts:30-59` | set accepts any member | `PUT /chain` may write an out-of-list member (kept + shown, per migration) — the gate is at USE, never at write, so history is preserved |

## 4. Acceptance (the requirement, stated to be pinned)

1. Global recents is an allowlist AND an order, not a default to inherit: a worktree, session
   or chain layer value outside it is not used; the model is taken from the global list.
2. Every refusal logs `warn("bug: layer model not in global recents")` and is shown on a surface
   (TUI marker/toast; server log + footer `used:` label) — never silent.
3. One edit of the L4 list governs our bin and every worktree launched from it; no `model.json`
   is touched by the rollout.

## 5. Paradigm argument (AGENTS.md § Storage Paradigm, rule 4)

Rule 4: «Fill, do not resolve — a layer that lacks a value is FILLED from its source once, at
the moment the layer is created; reads are then a plain lookup. `global → new worktree →
session`, materialised, no inheritance at read time.»

The gate does not violate it — it is not a parent walk and not inheritance:

- It reads ONE key (L4 `globalRecents`) directly, not a chain of parents; the layer value was
  already materialised by fill. Session → worktree → global resolution order is untouched —
  a refused layer value falls to the NEXT LAYER, exactly like an absent one.
- It ADDS no read-time inheritance: `resolveAgentModel` still never consults `ag.model`
  (the caller does); `loadChain`/`resolveChainAgentModel` still read one session key.
  The L4 lookup is a VALIDITY check on an already-resolved value — the same rung as the
  existing `isModelValid` (connected-now) check in `local.tsx:68-71`, but on the owner's
  axis (allowed-now) instead of the provider axis.
- Fill stays the only parent walk (`fillChainForNewLayer`, `fillSessionAgents`,
  `fillWorkspaceAgents`, `fillSessionChains`); the gate only observes staleness the fill
  cannot see (list changed after fill — Mechanism B).

If the Legislator finds this reading wrong, the stop below is the place: no product code
changes in this step either way.

## 6. Migration (kept, not deleted, shown)

- Existing out-of-list layer values (e.g. ADID's `glm-5.3-flash` rows) are KEPT in their files
  and rows — nothing is deleted or rewritten by rollout.
- First start after rollout: L4 `globalRecents` is seeded from the current S0 agent models if
  absent (same seed rule as `seedGlobalLayer`, `local.tsx:684-721`); user-authored L4 never touched.
- At use, a stale value warns + shows + falls through (§3). The user re-picks via `/agents`
  (worktree/session/global tabs) or `/chain`; the new pick overwrites that layer normally.
- `PUT /chain` keeps accepting any member (history preserved); only USE is gated.

## 7. Smoke Tests

RED tests (this step — must FAIL on today's code for the stated reason, never on the harness):

- `packages/opencode/test/session/global-recents-allowlist.test.ts`
  - worktree `model.json` pick absent from the list is not returned by `resolveAgentModel`
    (falls to global) — today the stale pick is returned;
  - session override outside the list is refused the same way (falls to the in-list worktree
    value) — today the stale session value wins;
  - structural: the resolver source carries the gate (`globalRecents` + `not in global recents`
    warn) — today absent;
  - guard (passes today, pins the order): an in-list worktree pick still wins over the global
    default.
- `packages/opencode/test/provider/model-chain-global-gate.test.ts`
  - chain `[stale]` + list without it → `resolveChainAgentModel` returns `undefined` (warn +
    legacy fallthrough) — today returns the stale member;
  - chain `[stale, backup-in-list]` → backup is assigned (failover preserved, staleness filtered
    at USE, not at fill) — today assigns the stale head;
  - structural: the chain resolver source carries the same gate — today absent.

Post-review GREEN criteria: the RED files pass unmodified (assertion text unchanged; only the
planned `opts.globalRecents` plumbing they already call starts being honored), plus
`session-settings-smoke.test.ts` and `model-chain-store.test.ts` stay green (no fill/order
regression), plus one live check: worktree with the ADID-style stale pick answers with a
list member and the warn fires once.

## 8. Residual / out of scope for this step

- Whether the explicit `aicall` model/provider param is gated or exempt (Legislator call, §3).
- Whether L4 `globalRecents` should also bound `PUT /chain` writes or stay use-gated (plan says
  use-gated; history preservation vs early refusal is an owner call).
- `provider.getSmallModel` catalog coverage: if no small list-member exists for a provider,
  title generation needs a named fallback (Legislator call).
