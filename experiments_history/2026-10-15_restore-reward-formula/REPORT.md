# Восстановление награды и завершение задач

✓ Git oracle: исходный literal взят из `ff4e679fa3^`; удаление в `ff4e679fa3`,
затем замена delta_R в `067d9cad2d`. Source diff меняет только REWARD_FUNCTION
и необходимые конечные cap metadata; прочие правила сохраняются.

✓ Requirement reproducer `20261014T190208Z_f026630c`:18FAIL/1PASS до source-edit.
Boundary reproducer `20261014T190844Z_13599479`:2FAIL до ceiling66000.
Дополнение владельца `task_done/((101-%)^2)`:
`20261014T191247Z_4b484269`:14FAIL/12PASS до добавления suffix.
Исторический fixture оставлен точным; отдельные controls проверяют потерю
formula, counted completion, percent, frozen scope и undefined term.

✓ Parent oracle `20261014T191618Z_da25e797`:243PASS/0FAIL, exit0,
345B captured, zero dropped, truncated=false. Focused reward26PASS/0FAIL.
✓ Pipeline install4 `20261014T191531Z_6e6b8db6`:exit0.
✓ Actual persistent readback `20261014T191619Z_09508cee`:4receivers equal
canonical render bytes, exact historical text + completion suffix, PASS.

| Variant | Body bytes | Normalized words | Actual receiver SHA256 |
|---|---:|---:|---|
| Product | 65381 | 8700 | 4bf6f129e00ede9e433b0788854940a4342aad7e2b509b01f372a4e219b6c4ca |
| Claude | 65253 | 8777 | cbca9248f005f4784b36a28a64f000177d500cfdd305e1b836afb5063c3a2650 |
| Cursor | 65214 | 8799 | 2ef4816365b4a61299e8fa24f9e4b5f3e724b1ad121339d5dc4dfce10f4c3b93 |
| Codex | 65172 | 8723 | e4b3dd7dcac16e66e213959c0fc02ecd7a43b26a34c2bb6223aeb5273c9ca4d0 |

Cursor receiver includes267B frontmatter. Limits:bytes66000, product words8700,
other variants8800. No FLOPs estimate or runtime reward calculator introduced.
Full failed and passing run states/output retained here.

HARNESS retained: readback run191301 failed because cmd_runner transforms -c
into a payload file whose sys.path lacks repo. Standalone readback with explicit
known root fixes the probe;191330 thenPASS. Coder's -c measurement run191316
failed from quote damage; qualified direct argv measurement recovered the
diagnostic. These are instrument residuals, not repaired cmd_runner claims.

Boundaries: this verifies definition, serialization, installed artifact and
discriminating guards. It does not prove live model completion behavior or
populate measured FLOPs. Open sessions use frozen prefixes until normal reload.
BLOCKED removal is the next separately authorized kernel task.

✓ Mandatory build `20261014T191704Z_63084943`:exit0, state50299B,0dropped,
truncated=false; wholestdout read. Candidate10.0.1343 version and BunFS asset
reasoning_prompt embedding smoke passed. No bin promotion.

```yaml
Keywords: reward-contract 0.45, task-completion 0.30, independent-oracle 0.25
Semantic dominant: Историческая награда и новый completion term проверены независимыми проигрывающими и проходящими прогонами.
md5: 32e8703294b6476389ff2b3aac318793
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 617f4b0ae28149d0a8c369bec5724f13
```
