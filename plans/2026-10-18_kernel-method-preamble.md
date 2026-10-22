# t90 — kernel preamble: the method and why it exists; the human is not an oracle; hybrid search as the first rung

<!-- intention: kernel states machinery without stating its method -> every kernel variant opens with the working method, its why, and the no-human-oracle line, and the Claude variant grounds search on Universal Search hybrid -->

```yaml
Keywords: method-preamble 0.30, why-kernel-exists 0.20, human-not-oracle 0.20, hybrid-first-rung 0.15, names-not-explanations 0.15
Semantic dominant: Every kernel variant opens with the working method, its why, and the no-human-oracle line, and the Claude variant grounds search on Universal Search hybrid.
md5: b7c2e9a14d5f48b0a3c6e1f7d9a2b5c4
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
note: hash values are generative tags — search them, never compute them.
```

## Status

- [x] G1 grounding: doctrine, README, premise location (render.py:219, not source.py), addon rungs, memories read
- [x] RED tests: premise order + not-an-oracle, Claude :3005/hybrid, parity, caps (3 RED, 1 guard pass)
- [x] Implementation: premise (3 sentences, names not explanations) + Claude hybrid rung (WebFetch debugging only); codex/cursor checked, no rung to replace
- [x] Oracle: pytest 333 passed + 3 stale-receiver reds, 4-variant render repr identical, t84 tokenize green, _build.ps1 exit 0 smoke 10.0.1439
- [x] Commit e5b8f97a67 via scripts/commit_own.py + progress-log line; STOP before --install
- [x] Addendum 1 (instrument by layer): RED 22 failed / 2 guards passed → GREEN; graph-before-scanners + grep-last removed in all 4 variants, layer routing + honest-empty clause in; AGENTS.md § Search instruments rewritten (51911 → 52177 B); grounding pin retired with dated reason
- [x] Addendum 2 (patents + domain grounding): engineering route +Google_Patents/Espacenet primary, +USPTO/WIPO_Patentscope secondary; software secondary +Google_Patents; patent-authority rule line; G1 DOMAIN_GROUNDING rule + DOMAIN_TERMS slot (G1 outputs, G2 requires); per-variant patent host binding; missing-comma near-miss (t84 class, tuples) found by test_addons and fixed
- [x] Caps: utf8 69_000 → 70_000 (source + validate ceiling + reward pins), tokens 9_400 → 9_500, G0+G1 pre-action 7_800 → 8_500; product 69903 B, max tokens 9460; nothing cut
- [x] Oracle + build + commit for the addenda (7421093607; pytest 357+3 stale, build 10.0.1445); STOP before --install
- [x] Review 1 (Legislator FAIL): RED 49 failed / 24 passed → GREEN 73 passed; F1 core contradiction (INSTRUMENT_ORDER by layer, LOUD_FAILURE narrowed to STRUCTURE) + invariant test; F2 chain refs → instrument+layer; F3 concept/unclear-target layer in all 4 (adm --query / qualified adm query / retrieval MCP); F4 DOMAIN_GROUNDING bounds (task path, reuse @ANTI_CHURN, Unknown exit, org wiki + higher rung wins, read-only report + parent records, content_hash per surface, reinvented-from-recall); F5 patent lines as instruction (no render claim); F6 ISO/IEC/ASTM secondary; F7 AGENTS.md:760 + .claude/CLAUDE.md:4 tails aligned (no in-repo generator found — outputs edited directly)
- [x] Caps: utf8 70_000 → 71_000 (product 70617), tokens 9_500 → 9_600 (max 9575), G0+G1 pre-action 8_500 → 9_500 (measured 9134); nothing cut
- [x] Oracle + build + commit for review 1 (53877ef2; pytest 406+3 stale, build 10.0.1448); STOP before --install
- [x] Review 2 (five small fixes): RED 20 failed → GREEN; F1 slot/rule Unknown agreement + receipt-in-place-of-hash clause; F2 registries primary (Espacenet/USPTO/WIPO/ISO/IEC), aggregators secondary (Google_Patents/ASTM); F3 docs/glossary.md bound in all 4 layout lines (×1 identical); F4 concept spans layers by definition; F5 higher @INFORMATION_STATUS rung per @SOURCE_ROUTING; stale review-1 phrase superseded in its test with dated reason
- [x] Caps: tokens 9_600 → 9_700 (max 9618); utf8 71_000 holds (product 70918); nothing cut
- [ ] Oracle + build + commit for review 2; STOP before --install — then ready for the owner

## 1. Grounding (measured)

- Premise location: `prompt_kernel/render.py:219` (hardcoded `premise:` line in `render_kernel`), NOT `prompt_kernel/source.py` — `source.py` carries no premise field (`KERNEL = Kernel(...)` at `source.py:907` has no premise; `model.py` `Kernel` has no premise slot). The brief's `source.py` path is off by one file; the edit lands in `render.py` where the section 0 premise renders. Provenance: `grep premise prompt_kernel/render.py` 1 hit (`render.py:219`); `grep premise prompt_kernel/model.py` 0 hits.
- Existing tags (do not duplicate): section 0 `premise:` (request = user simulation, answer = ours, error = sum); `@SOURCE_ROUTING` ladder (`source.py` + `render.py:112`); `ORACLE_ROLE` (`source.py:1000`: neither simulation, user's included, is the oracle; user's word is testimony); G3 ACCEPTANCE_FRAME line (user word or visual capture alone leaves the claim Unknown); `@MEDOID_SIMPLEX`, `@LEAN_RANKING`, `@SMOKE_BEFORE`.
- Claude G1 rungs today: `INSTRUMENT_CHAIN` (`addons_claude.py:44`) names `WebSearch/WebFetch` as the search rung; `TOOL_GROUNDING` (`addons_claude.py:61`) names `WebFetch/WebSearch`. Product `addons.py:47,54` already names `universalsearch` (`adm --query -> codegraph -> messagesearch -> universalsearch`) — the hybrid call is that ladder made executable (owner 2026-10-18).
- Codex (`addons_codex.py:35,53`): `web/fetch or cua_repl`, `static web: web/fetch` — no `WebSearch/WebFetch` rung. Cursor (`addons_cursor.py:58,74`): `Codebase/Web`, `Fetch Rules` — capability names, no `WebSearch/WebFetch` rung. No alignment needed beyond Claude; verified by read, not by memory.
- Memories (`.opencode/data/memory/reasoning.md` + doctrine §7 Craft): `kernel names activate latent knowledge` — name, don't explain; keep authority names (papers, standards, patents stay as names). `kernel cap vs failure cost` — raise by the next band, no cuts. `no external docs in prompt surfaces` — no URLs/docs in the kernel text. Doctrine §7: position sets price, slot beats imperative, state the rule not the reason, fund from prose never the ceiling silently.
- Sizes before (2026-10-18): product 68421 B / 9166 tok; claude 68213 / 9230; codex 68132 / 9176; cursor 68174 / 9252; `utf8_budget` 69000; token caps 9300 (all variants). Headroom product 579 B / 134 tok — the preamble likely needs the next band (70000 / 9400); nothing cut.

## 2. Implementation

- Premise (`render.py:219` region, section 0): at most 4 short sentences, English, names pointing to existing tags (no restatement, no external docs):
  1. Method chain in order: search → `@SOURCE_ROUTING` grounding into papers, standards, patents as ready algorithms → `@SMOKE_BEFORE` on our material → owner choice among grounded near-solutions → SVM on the chosen theory → fractal decomposition filling missing medoids.
  2. Why: without it long development on real tasks drifts from the target and never reaches industrial or military grade.
  3. No human is an oracle: their word is a simulation like ours (`@ORACLE_ROLE`); evidence decides.
- Claude (`addons_claude.py`): `INSTRUMENT_CHAIN` search rung becomes Universal Search hybrid (`POST 127.0.0.1:3005/hybrid`, then `/web/context` for `content_hash`); `TOOL_GROUNDING` grounds via hybrid; `WebFetch` stays named for pipeline debugging only, never as the search rung.
- Codex/Cursor: checked (§1); no `WebSearch/WebFetch` rung to replace — left untouched so host capability names stay intact.
- Caps: measure after; if over 69000 B / 9300 tok, raise `utf8_budget` (and the token asserts in `test_dedup.py`, `test_addons_claude.py`, `test_addons_codex.py`, `test_addons_cursor.py`) to the next band above the measurement, nothing cut, per standing owner word.

## 3. Claim ledger

- C1: premise names the method steps in order and carries the not-an-oracle line. Falsifier: `render_kernel` output for any variant lacks a step name or the oracle line. Status: pending RED test.
- C2: Claude G1 chain contains `:3005/hybrid` and no longer offers WebSearch/WebFetch as the search rung (WebFetch only as debugging). Falsifier: `INSTRUMENT_CHAIN`/`TOOL_GROUNDING` block still lists WebSearch/WebFetch as a search rung. Status: pending RED test.
- C3: parity across 4 variants (premise identical; shared bindings unbroken). Falsifier: `test_variant_parity.py` red beyond the 3 known stale-receiver reds. Status: pending oracle.
- C4: caps hold by the next band only. Falsifier: byte/token assert red without a band raise, or a cut to fund the addition. Status: pending measure.

## 4. Risk ledger

- R1: premise path (`source.py` vs `render.py`) — contained by grounding §1 (render.py is the renderer; source.py has no premise slot); no edit to `source.py` for the premise.
- R2: cap overrun — contained by next-band raise, never a cut; `dedup`/`validate` guards stay green.
- R3: variant drift — contained by `test_variant_parity.py` + shared-binding wording untouched.

## 5. Smoke Tests

RED (must FAIL on today's kernel for the stated reason, never on the harness):

- `prompt_kernel/tests/test_method_preamble.py::test_premise_names_method_steps_in_order` — premise text contains `search`, `@SOURCE_ROUTING`, `papers`, `patents`, `@SMOKE_BEFORE`, `owner`, `SVM`, `fractal` in order; today absent.
- `prompt_kernel/tests/test_method_preamble.py::test_premise_carries_not_an_oracle_line` — premise names the human not-an-oracle line (`no human is an oracle` + `@ORACLE_ROLE` or `evidence decides`); today absent.
- `prompt_kernel/tests/test_method_preamble.py::test_claude_chain_uses_hybrid_not_websearch` — Claude G1 `INSTRUMENT_CHAIN` contains `:3005/hybrid` and contains no `WebSearch` search rung; today the reverse.
- Guard (passes today, pins behavior): `test_sv_legend.py::test_render_list_literals_have_no_implicit_concatenation` stays green through the change.

GREEN criteria: the RED file passes unmodified after the edit; `python -m pytest prompt_kernel/tests/ -q` shows only the 3 known stale-receiver reds; all 4 variants render and the new premise lines print with `repr`; caps hold by next-band raise only.

## 6. Residual / out of scope

- `--install` (product, Claude, Codex, Cursor receivers) is NOT this step — the Legislator reviews and runs the outside falsifier; the owner gives the install word.
- No product-source (`packages/`) change; no `bin/` touch.
