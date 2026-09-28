# Kernel cleanup — identity contracts: drop `gates`/`may_mutate`, add code-synced tool lists

<!-- intention: identity contracts in the kernel stop advertising workflow gates and mutation flags, and gain per-identity allowed-tool lists kept honest by a parity test against the live ACL in agent.ts -->

- status: ACTIVE
- depth: L2 (SELF_MODIFY — normative: identity contract shape changes; per docs/kernel-amendment.md, L2 requires user + runtime ACL and the diff shown before install)

Owner request (2026-09-28, verbatim): «Давай подчистим кернел» · «Надо убрать ворота
из определений и режимов. Убрать may mutate, добавить список разрешенных тулов для
каждого из них через аддоны, которые синхронизированы с реальными разрешениями тулов
в коде.» · «Мы убрали gates из агентов и режимов — потому что gates к ним отношения
не имеют.» · «У claude и codex свои тулы не наши.»

## Decisions (owner Q&A, 2026-09-28)

1. Sync mechanism: **extractor + parity test**. A runtime extractor prints the manifest
   (identity → allowed tools) from the LIVE rules; a TS test in `packages/opencode` fails
   when the rendered kernel drifts from the live ACL.
2. Format: **hybrid brevity** — narrow identities list allowed tools explicitly; wide
   identities list exclusions ("all except …"). Both computed from the live ACL.
3. Scope: **product kernel only**. Claude/Codex identity blocks lose `gates`/`may_mutate`
   like everything else but get no tools rows (their tools are not ours) — residual R1.
4. Gates are not an identity property: remove `gates` and `may_mutate` from identity
   contracts AND remove gate mentions from agent prompts (`<spine>`) and mode reminders
   (`(G1–G9)` / `(G1–G6, G9)`).

## Phases

### F0 — Baseline (smoke before)
- [x] `python -m pytest prompt_kernel/tests/ -q` — baseline: **113 passed, 1 failed** (`test_variant_parity::test_codex_artifact_is_current`, stale codex artifact). Fixed by `python -m prompt_kernel --codex` (artifact `dist_codex/2026-09-29_03-41-06`, sha `a16285…`); suite re-run green.
- [x] `python -m prompt_kernel` — **47 368 B / 6 209 tokens**; caps are `KERNEL.utf8_budget=48_000` (source.py:779) and `normalized_token_count <= 7_000` (test_dedup.py) — only ~630 B / ~790 tok of headroom. Any growth must be earned; see F8.
- [x] Section-5 shape confirmed: 9 identities × (`kind`, `scope`, `gates`, `may_mutate`) — `render.py:263-271`.
- Note: variant artifacts are staleness-guarded (`test_claude_kernel_is_installed_current`, `test_codex_artifact_is_current`, `test_registries_share_their_addon_slots`) — after F1/F2 both must be refreshed in F8 (`--claude --install`, `--codex`) and any product-only identity slot declared in `test_variant_parity.py`.

### F1 — Identity model slim (kernel)
- [x] `prompt_kernel/model.py` — `Identity` drops `gates` and `may_mutate`.
- [x] `prompt_kernel/source.py` — 9 `Identity(...)` updated (the PLAN_MODE/gates comment deleted with them).
- [x] `prompt_kernel/render.py` — section 5 renders `kind`/`scope` + addon lines; `gates:`/`may_mutate:` gone. Related de-gating: DELEGATION text ("whose scope covers it", id `DELEGATE_BY_SCOPE`) and the G6 terminal condition ("this identity's ACL denies implementation").
- [x] `prompt_kernel/validate.py` — two-way identity↔gate checks dropped; "gate names a known identity" kept.

### F2 — Identity add-ons mechanism
- [x] `prompt_kernel/addons.py` — `IdentityAddon` + `IDENTITY_ADDONS` + `validate_identity_addons`;
      `GateAddon` untouched.
- [x] `prompt_kernel/render.py` — identity add-ons wired into section 5 (`_render_identity`;
      `render_kernel`/`render_review`/`kernel_digest` take `identity_addons`); manifests carry
      `identity_addons` count/sha (`artifacts.py`).
- [x] One mechanism for all three registries; product fills content, claude/codex render
      `identity_addons=()` (R1).

### F3 — Extractor (TS)
- [x] Extracted `resolveTools` into `src/agent/identity-tools.ts`; `debug/agent.ts` re-exports it
      (its test `test/cli/cmd/debug/agent.test.ts` stays green).
- [x] Manifest mode added: `script/kernel-tools-manifest.ts` prints
      `{ identity: { allowed, denied } }` for the 9 native identities from LIVE rulesets.
- [x] First manifest run (2026-09-28) — and it found the consistency defects F7 predicted:
      1. **`jobkill` dead deny**: `jobkill.ts` declares policy `job_kill`, while seven deny
         lists said `jobkill` — no rule matched, the tool was available everywhere.
         Fixed in `agent.ts` (7 occurrences → `job_kill`); the TUI already keys on `job_kill`
         (`routes/session/index.tsx:2490`), so the deny key was the wrong side.
      2. **`read` false-positive in `Permission.disabled`**: scoped `.env: ask` defaults counted
         as a "scoped open" for a flat deny, so `disabled` reported `read` available for
         `reasoning_mode` / `researcher_agent` while the runtime refuses it. Fixed: scoped
         opens count only for the `edit` family (same rule as `SessionTools.denied`).
- [x] `identity-tools.resolveTools` now implements the agent-scoped half of `SessionTools.denied`
      (the Gate A runtime formula, evaluated on the tool's POLICY — `session/tools.ts:259`),
      not the hide-oriented `Permission.disabled` view. A second manifest run follows the fixes.
- [x] Manifest re-run after the F7 fixes (`20260928T195328Z_36b3b87d`, exit 0); rows copied into
      `IDENTITY_ADDONS` (F4). The researcher row excludes `githubprsearch`/`githubtriage` —
      MCP tools are host-configured and are not enumerated in the kernel.

### F4 — Fill product tool rows
- [x] `IDENTITY_ADDONS` (product) filled for the 9 identities, hybrid format, from the F3
      manifest (48 274 B render; caps below).
- [x] Grammar fixed together with the F5 parser (one grammar, two readers; trailing period and
      "all except" handled; the first parity run caught the missing period strip).

### F5 — Parity test (TS, packages/opencode/test/agent/)
- [x] `test/agent/kernel-identity-tools.test.ts`: builds `Agent.defaultLayer` (registry.test
      pattern, fake model), computes allowed sets via `resolveTools`, parses section 5 of the
      installed `reasoning_prompt.txt`, compares sets; fails on drift or a missing row — green
      in `20260928T200926Z_e1542b78` (21/21, exit 0).
- [x] Scoped rules documented: prose after `;` carries `write/edit: plans/ only` boundaries the
      ACL enforces at `ctx.ask`; the test compares only the id sets (note in test + docs).

### F6 — Prompts: gates out of agents and modes
- [x] `<spine>` lines deleted from the six agent prompts; the `<kernel>` rule lists dropped
      their `@G`-references (the guard caught them after the spine pass).
- [x] Gate parentheses dropped from `build.txt` / `plan.txt` reminders.
- [x] Kernel tests: spine-match replaced by `test_agent_and_mode_prompts_carry_no_gate_ids`
      (absence guard) + `test_agent_prompts_name_their_runtime_identity`; @ref tests kept.
- [x] `test_constitution.py` — "only three may mutate" re-aimed: coverage check here (every
      identity declares a tools row), the unscoped-edit invariant moved to the TS parity test
      (where the ACL lives).

### F7 — Rule consistency audit (owner-requested item)
- [x] Audit result: `apply_patch`/`EDIT_TOOLS` and `plan_enter`/`plan_exit`/`reasoning_*` are
      consistent — Gate A calls `denied(item.policy)` (`session/tools.ts:259`), so policy keys
      match the deny keys; `multiedit` likewise. Two mismatches were CONFIRMED and fixed:
      `jobkill` (policy `job_kill` vs seven deny keys `jobkill`) and `Permission.disabled`
      counting non-edit scoped asks as opens (`read` in `reasoning_mode`/`researcher_agent`).
- [x] Fixes landed with regression cases in the parity test (dead-deny + scoped-open cases);
      negative results recorded here.

### F8 — Build the kernel (L2 procedure)
- [x] pytest green (**117 passed**) before and after install.
- [x] Render measured: **48 274 B / 6 290 tokens**; byte cap raised 48 000 → **49 000** in
      `source.py` with the admission recorded (rows ≈ +1.3 KB vs removed lines ≈ −0.6 KB);
      token cap 7 000 not exceeded; dedup repeat approved in `REPEATED_NGRAM_ALLOWLIST`.
- [x] **Diff shown to the owner** (identity §5 + edge + delegation lines); owner answered
      «Да, устанавливай».
- [x] `--install` `ac3e8d51…`; `baseline.json` repinned; `assert_current_kernel_unchanged()`
      `PIN_OK`; claude/codex receivers refreshed without tool rows.

### F9 — Package tests, docs, commit, close
- [x] `bun typecheck` exit 0; `bun test test/agent/kernel-identity-tools.test.ts test/tool/registry.test.ts test/tool/kernel-alignment.test.ts test/cli/cmd/debug/agent.test.ts` — **21/21** (`20260928T200926Z_e1542b78`).
- [x] `docs/gate-addons.md` — identity add-ons section + how-to updated; `docs/kernel-release-2026-09-28.md` written; `AGENTS.md`/docs checked (no stale `may_mutate`).
- [ ] Commits naming this plan; move to `plans_completed/` when the last box closes
      (`reconcilePlans`), scan for stale refs.

## Smoke Tests

Baseline (before any edit):
- `python -m pytest prompt_kernel/tests/ -q` → expected green; record N.
- `python -m prompt_kernel` → record `utf8_bytes`/`sha256`; **no install**.

Post-change:
- Same pytest (updated suite) green.
- `bun test test/agent/kernel-tools-parity.test.ts` (from `packages/opencode`) green;
  plus `test/tool/registry.test.ts`, `test/tool/kernel-alignment.test.ts`.
- Absence checks: rendered section 5 contains no `gates:`/`may_mutate:`; agent/mode
  prompts contain no `G\d` gate mentions.
- Budget checks: bytes/tokens within caps or cap raised with a named reason in the same
  change.

## Acceptance frame

| # | Criterion | Surface | Instrument | Falsifier |
|---|-----------|---------|-----------|-----------|
| 1 | No `gates`/`may_mutate` in identity contracts | rendered kernel §5 | kernel pytest | substring found |
| 2 | Every identity has a tools row | rendered kernel §5 | TS parity test | missing row |
| 3 | Rows == live native ACL | live `Agent.layer` | TS parity test | set mismatch |
| 4 | Gates absent from agent/mode prompts | prompt `.txt` files | kernel pytest (regex) | `G\d` found |
| 5 | Budget respected | render | pytest budget test | over cap |

## Risks

- Budget growth from tool rows (mitigate by compression per docs/gate-addons.md «cut
  prose, never a decision»).
- `Permission.disabled()` semantics is hide-oriented; path-scoped rules (`edit`: `plans/*`
  allow) need an explicit shape in the grammar — a naive row would lie. Decide in F5 and
  test it.
- Kernel change rewrites the system prefix → KV cache re-arms on new sessions only (old
  sessions keep the previous prefix until compact). Expected, not a defect; flag it in the
  commit.
- L2: install only after the owner sees the diff (F8 gate).

## Residuals

- **R1** — claude/codex identity blocks get no tools rows; their tool names are not ours
  («У claude и codex свои тулы не наши»). Signal: when their harnesses expose a
  machine-readable ACL source, add per-registry rows. Tracked in `docs/gate-addons.md`.
- **R2** — `bin/opencode.exe` rebuild/rollout is the owner's procedure (`bin/` is
  protected); this plan stops at the installed `reasoning_prompt.txt` + repin.
