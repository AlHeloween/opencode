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

- [x] S1 independence in MEDOID_SIMPLEX (round 2): neither source yields through another's failure — inputs from DIFFERENT categories (data | our code | framework-or-spec) AND different instruments, ≥1 source computing from the mechanism; one-kind observations a single category; leg defined; agent's own scripts on its own reading = ONE source. <!-- sv: independence-legs 0.7, medoid-simplex 0.3 -->
- [x] S2 CAUSAL_CHAIN at G3 (round 2, slot): ACCEPTANCE_FRAME tuple gains mechanismᵢ/predictionᵢ in all 4 registries; CAUSAL_CHAIN shortened to the linkage (observation tests predictionᵢ; without it symptom/testimony, claim stays Unknown; render is the observation). <!-- sv: causal-chain 0.7, acceptance-frame 0.3 -->
- [x] S3 invariant test + caps (round 2): `test_causal_chain.py` (4 tests incl. tuple parity); bytes stay 68_000 (product 67_606), tokens product/codex 9_000→9_100 (9_023/9_033), claude/cursor 9_100→9_200 (9_087/9_109). <!-- sv: invariant-test 0.6, size-cap 0.4 -->
- [x] S4 commit `72d2647bad1dac0401347add7dda695aa2387243` through `scripts/commit_own.py`, STOP before `--install`. <!-- sv: commit 1.0 -->
- [x] S5 Claude/aicall review round 2 applied (5 findings: unambiguous Unknown, categories + computing leg, ACCEPTANCE_FRAME slot, defined leg, render-as-observation). <!-- sv: review-fixes 1.0 -->
- [x] S6 commit round 2 `2064a58669455a2339d43743b1540254b9a3cd25` through `scripts/commit_own.py`, STOP before `--install`. <!-- sv: commit 1.0 -->
- [x] S7 review round 3 applied (3 fixes: prediction-not-verdict, common-failure phrasing, empty-slot Unknown). <!-- sv: review-fixes 1.0 -->
- [ ] S8 commit round 3 through `scripts/commit_own.py`, STOP before `--install`; report sha, diff, counts, sizes. <!-- sv: commit 1.0 -->
- [ ] R1 Claude critical review + owner `--install` (out of scope here). <!-- sv: review 1.0 -->

## Smoke Tests

- Baseline (before edit, measured 2026-10-17): product 66_651 B / 8_887 tok; claude 66_443 / 8_951; codex 66_362 / 8_897; cursor 66_404 / 8_973; pytest green except receivers.
- Prediction (before runs): new `test_causal_chain.py` FAILs on pre-t79 text (no independence clause, no CAUSAL_CHAIN); PASSES after; caps PASS at next band; `test_reward_restoration` ceiling tests PASS at 68_000/68_001; the 3 stale-receiver guards (production/claude/cursor) FAIL pre-install by construction.
- Post-change oracle (round 3): `python -m pytest prompt_kernel/tests/ -q` → 306 passed, 3 failed (stale receivers only); renders product `432eeec2…` (67_654 B), claude `05aa6c96…`, codex `268fa960…`, cursor `cf8dfff4…`; `working_copy=not_updated` ×4 (no install). No cap raise (all within bands).

## Stop claim

N/A while active — review (Claude) and `--install` remain.
