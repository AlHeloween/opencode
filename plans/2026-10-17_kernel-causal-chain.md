<!-- intention: robots close on user/visual-only without mechanism or math -> kernel binds independent legs (MEDOID_SIMPLEX) and the causal chain mechanism-prediction-observation at G3 ACCEPTANCE_FRAME, user/visual-only closes Unknown -->
# Kernel t79 — independent legs and the causal chain

```yaml
Keywords: causal-chain 0.30, independence-legs 0.25, mechanism-prediction 0.20, visual-oracle 0.15, kernel-edit 0.10
Semantic dominant: Bind independent legs and mechanism-before-observation at G3 so user or visual alone never closes.
md5: 7f9a3c1d4e5b60718293a4b5c6d7e8f9
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

Owner 2026-10-17, verbatim: «роботы продолжают пытаться сделать пользователя или визуальный эффект единственными оракулами без математического обоснования или подтверждения исходным кодом» + «у нас нету нормальной расшифровки … невырождающийся симплекс» + «я — не оракул и симплекса в доказательствах быть не должно, опираться надо на исходный код и вычисления … чертежи или 3д моделирование … скриншотом не отделаешься».

Field case: `D:/zPascal/ Projects/ClientSoft/docs/3d-render-verification.md` §2 (three legs A data-only / B our-code-only / C framework-only; own smokes counted once; owner screenshots uncontrolled) and §3 (FMX-exact MVP predictions M1–M5 registered BEFORE the render; CUA screenshot judges them).

## Ownership

- Kernel edit: Smit (this session `ses_eb7b76ae6ffedVeLDiXxYJdOAd`), pipeline only, STOPS before `--install`.
- Review: Claude owns the topic, reviews the diff critically; installation only after Claude PASS + owner word.
- `bin/` untouched. No `--install`. No `bin/` launch.

## Tasks

- [x] S1 independence in MEDOID_SIMPLEX: neither leg yields through the other's failure — different input (data | our code | framework-or-spec) AND different instrument; own scripts over own reading = ONE source. <!-- sv: independence-legs 0.7, medoid-simplex 0.3 -->
- [x] S2 CAUSAL_CHAIN at G3: each ACCEPTANCE_FRAME criterion names mechanism leg (path:line or formula) whose beforehand prediction the observation checks per @SMOKE_BEFORE; no mechanism-derived prediction = symptom/testimony per @ORACLE_ROLE, never oracle per @ORACLE; legs independent only per @MEDOID_SIMPLEX; user/visual alone → Unknown; computed geometry decides, render judges. <!-- sv: causal-chain 0.7, acceptance-frame 0.3 -->
- [x] S3 invariant test + caps: `prompt_kernel/tests/test_causal_chain.py` (3 tests); bytes 67_000→68_000 (product 67_326), tokens product 8_900→9_000 (8_981), codex 8_900→9_000 (8_991), claude/cursor 9_000→9_100 (9_045/9_067); reward ceiling guard stepped to 68_000/68_001. <!-- sv: invariant-test 0.6, size-cap 0.4 -->
- [ ] S4 commit through `scripts/commit_own.py`, STOP before `--install`; report sha, diff, counts, sizes. <!-- sv: commit 1.0 -->
- [ ] R1 Claude critical review + owner `--install` (out of scope here). <!-- sv: review 1.0 -->

## Smoke Tests

- Baseline (before edit, measured 2026-10-17): product 66_651 B / 8_887 tok; claude 66_443 / 8_951; codex 66_362 / 8_897; cursor 66_404 / 8_973; pytest green except receivers.
- Prediction (before runs): new `test_causal_chain.py` FAILs on pre-t79 text (no independence clause, no CAUSAL_CHAIN); PASSES after; caps PASS at next band; `test_reward_restoration` ceiling tests PASS at 68_000/68_001; the 3 stale-receiver guards (production/claude/cursor) FAIL pre-install by construction.
- Post-change oracle: `python -m pytest prompt_kernel/tests/ -q` → 305 passed, 3 failed (stale receivers only); renders product `b2c5aa5c…`, claude `5f85d91a…`, codex `9087aed1…`, cursor `484af960…`; `working_copy=not_updated` on all four (no install).

## Stop claim

N/A while active — review (Claude) and `--install` remain.
