# Upstream relation — the SDK question is closed; generated vs hand-maintained code

Moved verbatim from AGENTS.md (2026-10-13 split). The rule stays in AGENTS.md § STOP; this file is the record — the measured diff, the conclusions, the two-upstreams table, the OpenTUI re-base residual list, and the auto-generated-code table.

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

## Auto-generated vs hand-maintained (moved from AGENTS.md § Auto-Generated Code)

| File | Regeneration |
|------|-------------|
| `packages/sdk/js/src/gen/` | **NOT generated on this branch.** `ea7ec60f51` (2025-12-07) repointed `createClient` output to `./src/v2/gen`; eight hand-edit commits landed in v1 afterwards. Hand-maintained — TUI imports `@opencode-ai/sdk/v2`, so v1 is doubly irrelevant. |
| `packages/sdk/js/src/v2/gen/` | **OURS, hand-maintained. Do NOT regenerate.** `bun run packages/sdk/js/script/build.ts` exits 0 and removes ~7100 lines — the generator working *correctly*, because the committed files were never its output: `79c5b4a04e` (2026-07-16, mislabelled `Revert "Regenerate SDK…"`) shrank the spec by 763 lines while growing the two gen files by +7357. Root cause of the gap: **the API is described twice and the generator reads the half with no description.** 46 `describeRoute` entries against 275 route registrations, while 108 `HttpApiEndpoint` declarations across 17 files carry 149 `OpenApi.annotations` that nothing reads (`OpenApi.fromApi` has zero call sites despite shipping in the installed effect); the Effect half enters Hono as opaque pass-throughs (`routes/instance/index.ts:29`). Hence 233 typecheck errors collapsing to 12 missing symbols. Note `packages/sdk/openapi.json` is an ORPHAN — `script/build.ts:12` writes its own spec to `packages/sdk/js/openapi.json` from the live server and deletes it at line 62; the committed file one directory up is never read. `bun typecheck` is not a valid gate here: live code references the hand-maintained types, so a correct regeneration fails it. Add fields by hand. |
| `packages/desktop/src/bindings.ts` | `cargo run -p specta-bindings` |
| `packages/opencode/src/session/prompt/reasoning_prompt.txt` | `python -m prompt_kernel --install` (stamps `prompt_kernel/dist/` and copies runtime `.txt` into production) |
