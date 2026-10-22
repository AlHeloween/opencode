<!-- intention: the specs under packages/opencode/specs state live inventory in prose — file lists, call-site counts, feature flags — and that prose rots silently (measured 2026-10-12: facades.md names a makeRuntime composition that has since changed on BOTH sides, http-api.md still announces a gate flag that no longer exists in src) -> inventory that can rot is either replaced by the command that recomputes it or generated, while the rules and the work order — which do not rot — stay hand-written. -->

# specs/: stop writing down numbers that rot

<!-- goal_sv: specs-inventory, no-rotting-numbers, recomputed-or-generated, rules-stay-handwritten, live-truth -->
```yaml
Keywords: specs-inventory 0.30, no-rotting-numbers 0.25, recomputed-or-generated 0.20, rules-stay-handwritten 0.15, live-truth 0.10
Semantic dominant: Inventory that can rot is replaced by the command that recomputes it, while the rules and the work order — which do not rot — stay hand-written.
md5: b2d2bf600f8b088f980cdaade238ad06
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
note: hash values are generative tags — search them, never compute them.
```
**Status:** ACTIVE — 2026-10-12. Owner: «Давай», after the audit below was measured.

## 1. What the specs are (audited, not assumed)

12 files in three genres — and the genre decides whether "does it match reality" is even the right question:

| genre | files | rots? |
|---|---|---|
| **rules / patterns** | `effect/migration.md` (InstanceState vs makeRuntime, the scope rule), `effect/schema.md` (preferred shapes) | slowly — principles survive refactors |
| **plans with phases** | `effect/http-api.md`, `instance-context.md`, `server-package.md`, `routes.md`, `tools.md`, `facades.md`, `loose-ends.md` | **fast in their inventory, slow in their order of work** |
| **design / reference** | `v2/message-shape.md` (options, 2026-07-03), `v2/keymappings.md`, `tui-plugins.md` | n/a — they describe choices and behaviour, not state |

Two of these (`keymappings.md`, `tui-plugins.md`) were **not opened** during the audit; nothing here claims they are sound.

## 2. The rot, measured (2026-10-12, instruments named)

| spec | it says | measured now | instrument |
|---|---|---|---|
| `facades.md` | «`src/` has 5 `makeRuntime(...)` call sites: bus, cross-spawn-spawner, project/instance, npm, tui/config» | **5 again, different composition**: `bus/index.ts:172`, `project/instance.ts:21`, `cli/cmd/tui/config/tui.ts:186` survive; `npm/index.ts` and `effect/cross-spawn-spawner.ts` are **gone**; `session/compaction.ts:2990` and `installation/index.ts:97` are **new** | `grep makeRuntime` in `src` |
| `http-api.md` | «`OPENCODE_EXPERIMENTAL_HTTPAPI` gates the bridge. Default behavior still uses Hono» | **the flag does not exist in `src/`** (0 matches), while the bridge is alive (`server/routes/instance/httpapi/server.ts:65`) | `grep OPENCODE_EXPERIMENTAL_HTTPAPI` |
| `instance-context.md` | legacy `Instance` still in use | **correct**: `Instance.provide(` — 20 call sites | `grep Instance\.provide\(` |
| `server-package.md` | a **future** `packages/server` | package absent — and the document already says "future", so this is a plan, not a lie | `glob packages/server/**` |
| `migration.md` / `schema.md` | `InstanceState`, `makeRuntime`, `@/util/effect-zod` | all present (`prompt.ts:4,120`) | `grep` |

And the specs are **not abandoned**: the last five commits touching `packages/opencode/specs` are `feat(httpapi): bridge …` (tui routes, pty routes, event stream, session routes, session-message mutations). They are maintained *alongside* the work — which is exactly why a stale number is a defect and not a museum piece.

## 3. The rule this plan adopts

**A number that can rot is either replaced by the command that recomputes it, or generated. Rules, work order and rationale stay hand-written.**

A frozen count in prose is a claim with no oracle: it was true on the day it was typed, nothing re-checks it, and a reader cannot tell a fresh number from a stale one. That is the same failure mode `AGENTS.md` names for unmarked claims — the fix there was a mark, here it is a command or a generator.

## 4. Tasks

- [x] **S1 — de-number the prose.** DONE 2026-10-12. Frozen inventory replaced with the command that
      recomputes it in all five named files — `facades.md` (the `makeRuntime` inventory, hotspots,
      "remaining work", the two live checklist boxes), `tools.md` (the exported-tools list; the
      follow-up and fs lists), `http-api.md` (the flag-gate claim, the checklist references, the
      stale "Current Route Status" table), `instance-context.md` (the "56 files" total, the per-file
      churn ranking), `routes.md` (the per-file state lists). **Two files the audit had missed carried
      the same rot and were fixed too**: `server-package.md` (the same flag) and `schema.md` (a tool
      list naming three tools that no longer exist). Oracle: `grep` over `specs/` for
      `OPENCODE_EXPERIMENTAL_HTTPAPI|apply_patch|codesearch|websearch|npm/index|cross-spawn-spawner`
      returns only the intentional "gone since" mentions; ``` fences balanced in every edited file.
- ⚠ **S1 residual (named, not closed).** This was not a full sweep: `schema.md` and
      `server-package.md` were spot-fixed only, and `loose-ends.md` was not read in full. A complete
      sweep is what S3 exists to enforce going forward.
- [ ] **S2 — generate what must be visible.** Where a reader needs the current state at a glance (facade hotspots, instance-context callers, httpapi bridge coverage), add a `<!-- generated below -->` marker and a renderer that fills it, modelled on the existing pair: `util/plan-status.ts` + `svm render`. The renderer prints counts it computes from the tree and prints `MISSING` where it cannot compute — never a guess.
- [x] **S3 — a guard, not a caution.** DONE 2026-10-12 — `test/spec/spec-inventory.test.ts`, three tests: a control that the scan finds the corpus, the rule itself (a count + an inventory noun must name the instrument that recounts it, unless below `<!-- generated below -->`), and a fallibility check (a frozen count MUST be caught, a discharged one MUST pass). **It caught a real offender the S1 pass had missed**: `effect/migration.md:259` still read «There are 5 `makeRuntime(...)` call sites under `src/`» — the same frozen five, in a file S1 had judged "rules, which do not rot". Oracles: RED `20261012T032839Z_bd279f40` (2 pass / 1 fail — the FALLIBILITY control fired first and exposed that the regex was blind to a backticked token between the count and the noun) → RED `20261012T032911Z_2c13101e` (1 offender named: `effect/migration.md:259`) → **GREEN `20261012T032934Z_2a42529b`** (3 pass / 0 fail / 7 expect) after `migration.md` was de-numbered.
- [x] **S4 — say what was not audited.** DONE 2026-10-12. `v2/keymappings.md` is a 10-line DESIGN NOTE (it proposes reshaping keybindings into `keymappings`; nothing in it is recomputed by a command), so its first line now says exactly that and its status is Unknown until someone checks the code. `tui-plugins.md` states BEHAVIOUR, not inventory: a grep over all 433 lines for counts and file lists (`[0-9]+ (files|routes|hooks|methods|plugins|entries|APIs|types)`) found none, so no de-numbering applies — its first line now records that check. Neither file needs re-auditing.

## 5. Smoke Tests

| oracle | before | after |
|---|---|---|
| `rg -n "makeRuntime\\(" src \| wc -l` | 5 (+1 definition) — the number the spec must not freeze | unchanged; the spec no longer states it |
| the S3 guard, run on the current specs | **FAIL — `facades.md` and `http-api.md` carry unbacked numbers** | PASS |
| `bun test test/<guard>.test.ts` | new file, red first | green |
| specs render (if S2 lands) | section absent | section present, and a second run is byte-identical |

## 6. Out of scope

- Rewriting the specs' substance: their order of work and their rules are sound and are being followed (5 httpapi bridge commits).
- `message-shape.md`: it is a design document with options, dated 2026-07-03; "matches reality" is not a property it claims.
- The `packages/server` extraction itself — `server-package.md` is its plan, and the plan is honest about being future work.
