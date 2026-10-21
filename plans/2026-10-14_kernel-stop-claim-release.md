<!-- intention: the kernel lets any terminal verdict (SUCCESS, BLOCKED, WAITING) close without falsification -> the fixed kernel (stop-claim form, @STATUS_CLAIM, JIDOKA/KAIZEN) is installed here, carried into ADID_Python's canonical bundle, released, installed to every consumer with readback, and the opencode binary rebuilt -->

# Kernel stop-claim fix → ADID release → every consumer → binary

```yaml
Keywords: terminal-verdict-falsification 0.30, kernel-install 0.20, adid-release 0.20, consumer-readback 0.20, binary-rebuild 0.10
Semantic dominant: Ship the falsifiable-exit kernel end to end — fix and install here, carry it through an ADID release to every consumer with readback, rebuild the binary.
md5: 6e8a0c2f4b1d3579a1c3e5b7d9f02468
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
```

Owner, 2026-10-14, verbatim: «нам надо исправить кернел, потом обновить этот кернел в adid_python, зарелизить новую
версию и установить всем потребителям. Пересобрать бинарь.» Decisions the same day (AskUserQuestion): C1–C7 + mechanism;
root rule @STATUS_CLAIM (P3, short + «Unknown does not stop the work»), paid by compressing @REWARD_FUNCTION; @KAIZEN
split A-lean. Source analysis: experiments/2026-10-14_kernel-reanalysis/REPORT.md (t42) + INPUT-gpt-6.1-pro-review.md.

Lifts the residual of plans/postponed/2026-10-12_kernel-contract-repair-and-adid-release.md (A1/A2: ADID delivery
not verified; org ticket efbfea7c BLOCKED at the release pytest gate `sed LC_ALL=C.UTF-8`, trial fix `LC_ALL=C`
proven there). This plan is the new bounded envelope its lift signal asked for.

## Ownership

- Kernel edit: robot session t42 (`ses_ec636363dfferrgTBDkpw24Rg1`), pipeline only, STOPS before `--install`.
- Mechanism: robot session t36 (stop-claim check in planstatus + the end-of-turn stop-check).
- Review: Claude (doctrine, aicall on the WHOLE exits section, global-invariant tests, REPORT §7 predictions).
- ADID_Python update / release / install: its resident `smit-adid_python` through an org.fossil ticket
  (workspace_repo D:\zPython\ADID_Python); never edited from this repo.
- `bin/` promotion of the rebuilt binary: the OWNER's procedure only (AGENTS.md forbidden_actions).

## Tasks

- [x] K1 kernel package committed by t42: C1–C7, @STATUS_CLAIM, @REWARD_FUNCTION compressed, JIDOKA/KAIZEN split; global-invariant tests first; product ≤ 8 500 words, all four variants within caps. <!-- sv: kernel-edit 0.6, invariant-tests 0.4 --> ✓ CONFIRMED 2026-10-14: tests first — tests/test_status_claim.py RED on the pre-K1 text (run 20261014T102728Z_d2047f07); GREEN 3 failed / 213 passed (run 20261014T104416Z_75fcbb43; the 3 reds = stale-receiver guards, fix `--install`, deferred to K3). Committed ff4e679fa3. K2 review (Claude): spine PASS, FAIL → fixes A1–A5/B1–B7/C applied in the same lane (REWARD R defined via «the evidence measure», TOOLCHAIN primitives + qualified-executor clause, «a check beats a caution», «from disk»/«isolated», INSTRUMENT_ORDER examples; BLOCKED edges demand why-untried/out-of-reach + G1 receipts; @STATUS_CLAIM covers WAITING_APPROVAL+OUT_OF_SCOPE; STALL «splits tried with receipts»; «central» defined; OUT_OF_SCOPE falsifier; compaction preamble per owner verbatim); tests assert B1/B3/B5. Post-fix: pytest 8 failed / 209 passed (run 20261014T113134Z_d3844d36) — 4 stale-receiver + 4 CAP OVERFLOW (product 64 697/64 000 B and 8 606/8 500 words; claude 64 569; codex 64 488; cursor 64 530) — no further cuts taken per the K2 instruction; candidate levers for the owner: INFOMARK 1.1 ladder consolidation −25..40w, SVM further compression −40w, SOURCE_ROUTING table −150..180w.
- [x] M1 mechanism committed by t36: planstatus reports a postponed/BLOCKED plan without a «## Stop claim» routes table (route | receipt | failing component, untried routes, reopen_when); end-of-turn stop-check continues a turn that declares a stop without one. — **CLOSED 2026-10-22 (t135): class (a) for the first half, class (d) for the second.** The first half IS in the code: `packages/opencode/src/util/plan-status.ts:790-836` reads the stop-claim forms (`STOP_CLAIM_STATES`), calls `auditStopClaim` for `plans/postponed/**` and for every plan in `plans/` whose lifecycle is BLOCKED/WAITING/WAITING_APPROVAL/POSTPONED, and returns `stopClaims` naming the missing piece (no «## Stop claim» section / missing routes table / missing untried routes / missing reopen_when). The second half is SUPERSEDED by the kernel change itself: `packages/opencode/src/session/stop-check.ts:152` — «A stop claim no longer ends a turn» — so the end-of-turn continuation this box asked for no longer exists to be built. <!-- sv: mechanism 0.7, plan-status 0.3 -->
- [x] K2 Claude review PASS of K1 (+M1 pending its own review): doctrine §7, aicall over the whole exits section, GPT's 5 closure + 8 behaviour scenarios read against the text, §7 predictions. <!-- sv: review 1.0 --> ✓ CONFIRMED (Claude 2026-10-14): ff4e679fa3 FAIL → 067d9cad2d fixes A1-A5/B1-B7/C verified on source; aicall over the whole exits section (7 of 9 findings real, 1 false); after K3 readback: installed sha prod ee09f586, claude 093c58d8, codex a57b289a each carry STATUS_CLAIM ×4, the fold preamble, «why each is out of reach»; pytest run 20261014T120425Z_42202fb3 finished 0, 217 passed.
- [x] K3 install here: `python -m prompt_kernel --install`, `--claude --install`, `--cursor --install`, `--codex --install`; baseline repinned; pytest all PASS; installed == render for all four (drift_check). <!-- sv: install 0.6, readback 0.4 --> ✓ CONFIRMED 2026-10-14 (installation run 20261014T120311Z_6ecca937, exit 0): production sha256 ee09f586c1f42e122512ea1cbe2b0556472f3200d59a1a04b592075732d5079c; claude 093c58d898f565ced82419a3b45a4ddbc2ec236c5675538689a968d39ef6971e; cursor body 8b6f8ca76ca14bdb161aa8ece8ac782d1784784a288cf6dbf2997a7a1e09d56d / receiver 6c80e17520ed3fd1c709e7e9075907aa90a5a4ffb41365301537349a40a4744c; codex a57b289ae7a3b2c145b088cf942037d94d5be23f76d67f66c6b3571ed0f14559. Baseline repinned prev 6a1aefc0… → ee09f586… (k3_finish.py). drift: installed == render True for all four. pytest post-install: 217 passed in 3.92 s (run 20261014T120425Z_42202fb3). Caps raised first (owner «64 - 65 без разницы»): utf8_budget 65_000 (== validate.py hard ceiling — next growth needs a cut or owner-raised ceiling), word caps 8_700/8_700/8_700/8_800; nothing cut.
- [x] B1 `_build.ps1` through cmd_runner: candidate in dist/ with the new prompt embedded (smoke line), run id recorded. Promotion into bin/ = owner. <!-- sv: build 1.0 --> ✓ CONFIRMED 2026-10-14: cmd_runner run 20261014T120445Z_71b83365 — state.json status finished / exit 0 / bytes_written 65 696+ / dropped 0 / truncated false; smoke lines «Smoke test passed: 10.0.1337» and «Smoke test passed: reasoning_prompt.txt embedded (BunFS asset present)»; «[OK] Build complete - artifacts in dist/»; bin/ untouched (owner's promotion).
- [ ] A1 ADID_Python resident: canonical bundle takes the K3 renders (two-canon parity, docs/two-canon-protocol.md); release gate fixed (LC_ALL=C); new adid_dist_* released; manifest re-verified. <!-- sv: adid-release 1.0 -->
- [ ] A2 install to every consumer with readback: the resident names the consumer list from its installer config; per consumer the installed kernel digest == the release manifest; failures listed by name. <!-- sv: consumer-readback 1.0 -->
- [ ] A4 Codex compact principle: the owner's «Compact Instructions» text (root CLAUDE.md, 2026-10-14) delivered to Codex through the ADID bundle — first VERIFY Codex 0.159.3's documented lever for compaction instructions (its config.toml is ADID_MANAGED; no compact key there today); readback on the installed Codex host. <!-- sv: codex-compact 1.0 -->
- [ ] A3 Claude verifies A1/A2 independently (hash readback on a sample of consumer roots + this repo's hosts) and closes efbfea7c / 28db8d0ace accordingly. <!-- sv: independent-verify 1.0 -->

## Smoke Tests

- Baseline (measured 2026-10-14, t42): `python -m pytest prompt_kernel/tests/ -q` → 209 passed; product 8 500/8 500 words; codex host 2 lines stale.
- Predictions (before K1 runs): the new global-invariant tests FAIL on today's text (exits without scope/receipts/falsifier; PLAN_MODE has no closing path; «stop» vs «descend») and PASS after K1; caps PASS with net ≤ 0 words in the product variant; a frameless read of the new BLOCKED line names routes/receipts/untried routes (REPORT §7.2).
- A2 oracle: per-consumer digest readback, never the installer's exit code.

## Stop claim

N/A while active.
