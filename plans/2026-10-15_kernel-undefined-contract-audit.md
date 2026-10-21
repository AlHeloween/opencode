<!-- intention: расплывчатые нормы допускают произвольную трактовку -> каждое неопределённое понятие или действие без критерия посчитано и привязано к canonical source -->
<!-- goal_sv: contract-boundaries 0.50, undefined-terms 0.30, independent-audit 0.20 -->
# Аудит неопределённых контрактов кернела

State: ACTIVE. READ + PLAN_WRITE; прямое «отправь робота пусть подсчитает что не определено».
Robot Smit получает отдельную сессию existinghost, model из live/provider.
Source/addons/host prompt styles read-only; reports only experiments/2026-10-15_kernel-undefined-audit/.
Нельзя commit/install/build/bin, изменять product/test/governance или доступные чужие сессии.
Bounds:tools30,steps25,loops2,depth2,time_budget_ms900000. Parent verifies every finding.

Стратегия к MASTER goal: measurable boundaries вместо remembered/model-specific judgement;
обнаружение должно быть привязано к существующей норме, а не к собственной формулировке аудитора.

## Tasks

- [x] A1 ✓ API readback:session ses_ec420d3f5ffeVbhz9wZCXv4l4f, MuseSpark1.3Free/explorer,12then15assistant rows,finishstop/idle/completed,0toolerrors. Исходные reports14then13candidate rows retained; canonical definitions/read-tools controls приведены. <!-- sv: undefined-contracts 0.7,source-pins 0.3 -->
- [ ] A2 Parent source/readback+native independent reviewer:9/9snapshotSHA verified;8confirmed norm rows=4lexemes,7rejected originalcandidates,1Unknowntitle reference. Report parent-review.md distinguishes counters and scope; archive/docs/master/progress+commit pending. <!-- sv: independent-verification 0.6,evidence 0.4 -->
  **t135 addendum 2 (2026-10-22): class (b) — the independent read-back IS done, the close-out is not.** Receipt for the done half: `experiments_history/2026-10-15_kernel-undefined-audit/parent-review.md` (9/9 SHA, 8 confirmed rows = 4 lexemes, counters distinguished). Next: archive + docs/master/progress/commit — the pending half named in this box.

## Smoke Tests

Prediction: audit artifact generated; numeric totals equal unique row ids, duplicate copies of one norm count once.
Each reported undefined term has a current source address and a recorded sweep for definition.
No-match filters require known-positive control. Audit can find zero defects if definitions are found;
in that case evidence inventories must explain rejected candidates. Parent source readback—not robot verdict.
No claimed token quantity for `short` without its actual declared metric; model examples are testimony.

```yaml
Keywords: contract-boundaries 0.50, undefined-terms 0.30, independent-audit 0.20
Semantic dominant: Посчитать недоопределённые нормы на текущем исходнике и проверить каждую находку независимо.
md5: 21a66067b9824dab91f15b37970ac653
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 617f4b0ae28149d0a8c369bec5724f13
```
