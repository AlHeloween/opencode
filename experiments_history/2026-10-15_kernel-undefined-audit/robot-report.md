## A1: READ-ONLY аудит неопределённых контрактов — final report

**Метод.** CodeGraph FIRST: запрос `prompt_kernel source model render evidence validate addons kernel norms` вернул только нерелевантные TS-символы (Renderable, prompt.ts, wasm) — зафиксирован evidence gap, fallback на read/grep обоснован. Далее прочитаны полностью: `source.py` (1200 строк), `model.py`, `render.py`, `evidence.py`, `validate.py`, `addons.py`, `addons_claude.py`, `addons_codex.py`, `addons_cursor.py`; частично `docs/kernel-quality-doctrine.md` (строки 1–120), `prompt_kernel/README.md` (1–120); промпты `codex.txt`, `gemini.txt`, `default.txt`, `copilot-gpt-5.txt` полностью, остальные — через grep-свипы с positive control. Сборщик промптов заземлён: `packages/opencode/src/session/system.ts:45-55` (PROMPT_REGISTRY), `:79-81` (resolvePrompt). Сборщик agent-промптов (`src/agent/prompt/`) за бюджетом не локализован — находки M2/M3/A1 помечены `binding: assembler-ungrounded`, parent добьёт.

**SHA256:** не зафиксированы — у explorer_agent нет санкционированного инструмента хеширования (bash/cmd исключены из ACL). Вместо пинов — read-хеши строк + `evidence_ref` каждого чтения; parent воспроизводит. Divergence за проход не наблюдался (повторных чтений с изменениями не было). Permission refused: ноль.

### Findings (14 уникальных норм; копии одной нормы посчитаны один раз)

**MEASURE — 10:**

| id | source | wording | missing boundary | proposed observable predicate |
|---|---|---|---|---|
| M1 | `packages/opencode/src/session/prompt/copilot-gpt-5.txt:22` (registry `system.ts:54`) | «Keep answers short and impersonal» | short: нет единицы, scope, comparator; acceptance-тесты файла длины ответа не bound'ят | FAIL ⇔ в ответе есть строка/абзац, удаление которого не меняет claims/evidence терна (счётчик — строки/предложения, граница будущая, не заявляется) |
| M2 | `packages/opencode/src/agent/prompt/general.txt:7` | «Be concise. Thorough when needed; never pad» | concise/thorough/pad без меры; одна норма, два дефекта → union 1 | FAIL ⇔ абзац дублирует уже сказанное в терне (цитата дубля — опровержение) |
| M3 | `packages/opencode/src/agent/prompt/title.txt:7` | «produce only a concise thread title» | concise без bound | FAIL ⇔ title > 1 строки либо содержит слова вне треда (проверка чтением треда) |
| M4 | `prompt_kernel/source.py:523` MANHATTAN_L1 | «keep each zone small» | small: N нет; коммент `:518` объясняет причину, не число | FAIL ⇔ число кандидатов зоны не записано в плане (наблюдаемо счётом) |
| M5 | `prompt_kernel/source.py:726` SEMANTIC_CONTROL | «only around enough Exact medoids» | enough: N нет; MEDOID_SIMPLEX (≥3) — про покрытие, не про retune | FAIL ⇔ retune без cited count Exact-медоидов; 0 cited = FAIL |
| M6 | `packages/opencode/src/session/prompt/default.txt:21` (registry `system.ts:53`) | «Minimize output tokens» | minimize без comparator/scope; acceptance `:46` bound'ит предложения, не токены | FAIL ⇔ существует принятый ответ на тот же запрос с меньшим числом токенов при тех же claims (парное сравнение) |
| M7 | `prompt_kernel/addons_codex.py:166` + копия `addons_cursor.py:125` | «shell executes binaries or short fact pipelines only» | short без bound; две копии = 1 норма | FAIL ⇔ pipeline из >1ステージ без записи зачем (stages считаются) |
| M8a | `prompt_kernel/source.py:479` PROJECT_GEOMETRY_RULE | «the smallest evidence-backed change region» | smallest: множество-кандидат не задано | FAIL ⇔ предъявлен строго меньший evidence-backed регион (фальсификатор — регион+evidence) |
| M8b | `prompt_kernel/source.py:577` objective G4 | «the smallest explicit execution envelope» | то же | FAIL ⇔ предъявлен envelope, покрывающий ту же задачу с меньшими bounds |
| M8c | `prompt_kernel/source.py:635` IMPLEMENT | «the smallest cohesive change» | то же | FAIL ⇔ предъявлен меньший diff с тем же oracle PASS |

**ACTION (обязательное действие без success/failure predicate) — 1:**

| id | source | wording | missing boundary | proposed predicate |
|---|---|---|---|---|
| A1 | `packages/opencode/src/agent/prompt/explore.txt:12` (уровни `:14`) | «Search thoroughly before reporting "not found"» | уровни quick/medium/very thorough заданы, но правило на них не ссылается — какой уровень = thorough, неизвестно | FAIL ⇔ "not found" без записи: какой уровень взят + какой rung ответил (graph-before-scanners квитанция) |

**TERM (термин без определения) — 3 нормы, один термин:**

| id | source | wording | sweep receipt (определения нет) | proposed predicate |
|---|---|---|---|---|
| T1a | `prompt_kernel/source.py:669` PREDICATE_POWER | «Name material alternatives» | `material` отсутствует в terms/state/validate-namespaces; grep по `prompt_kernel/*.py` — только употребления `:562`, `:669`, `:1111` | material ⇔ смена альтернативы меняет вердикт гейта/oracle (контрфактическая проверка); иначе немaterial |
| T1b | `prompt_kernel/source.py:562` MASTER_PLAN_RULE | «material premise/scope change» | то же | то же (меняет план/вердикт) |
| T1c | `prompt_kernel/source.py:1111` edge G9→G1 | «material residual evidence gap» | то же | то же (меняет маршрут закрытия) |

**Counts:** MEASURE unique = 10, ACTION = 1, TERM = 3. **Union = 14.** Проверка: M7-две-копии = 1; M2-два-дефекта = 1. Numeric bound для short НЕ заявляется (M1/M7 — только будущий счётчик).

### Rejected candidates (known-positive control свипа) — R1..R8

- R1 READY — определён в SURFACE_PREPARATION (`source.py:152`: read impl+tests, baseline PASS pinned). ✓
- R2 «independent sources» — определено в MEDOID_SIMPLEX (`source.py:527`: within-nesting-level, parent+child ≠ 2). ✓
- R3 «current/relevant evidence» — операционально: `evidence.py:18-32` (`_pin_current`), `:60-114` (`check_evidence` re-read). ✓
- R4 SUPPORTED — `evidence.py:41-57` (`_strategy`: goal+verdict+contribution+pins). ✓
- R5 «exhaustive inventory» — `evidence.py:96-110` (inventory_sha256 + равенство множеству). ✓
- R6 «bounded residual» — схема RESIDUAL_GOAL `{gap,bound,route,form_holds}` (`source.py:1035`). ✓
- R7 «finite budgets / concrete integer» — LOOP_PROGRESS (`source.py:111`) + CONCRETE_BOUNDS (`source.py:586`). ✓
- R8 codex ≤10 lines (`codex.txt:32,50`), gemini <3 lines (`gemini.txt:22,54`), default ≤3 sentences (`default.txt:13,46`), beast one sentence (`beast.txt:29`) — числовой bound ЕСТЬ, наблюдаемо. ✓ (Не путать с M6: там токены, не предложения.)
- Non-norms: «the PLAN is short» (`source.py:1109`), «cut short at G2» (`:1158`) — historical comments, не нормы. Отклонены по правилу задачи.

### Read tools / errors

- `codegraph_explore` — irrelevant pack (evidence gap, не absence); fallback read/grep с control-хитом (`short` найден в 6 местах — инструмент отвечает).
- Все `read`/`glob`/`grep` — OK; `grep` no-match один (`session/prompt/*.ts` assembler-паттерн) с контрольно-позитивным соседом (41 хит второго паттерна) — false absence исключён.
- Остаток: assembler agent-промптов не локализован (1 свип сверх лимита не влез); M2/M3/A1 ждут привязки parent'ом. Покрыты все bound canonical norm fields ядра (terms/state/action/rules/edges/FSM/contracts/addons×4+identity); из owning docs прочитаны частично (120/332, 120/210) — непокрытые §§ — направление допроверки (Unknown, не находка).

```yaml
Keywords: undefined-contracts 0.70, source-pins 0.30
Semantic dominant: Независимый read-only аудит посчитал 14 неопределённых норм с пинами и предикатами.
md5: 7f3a9c1e4b5d6a8f0c2e4d6b8a0c1e3f
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 21a66067b9824dab91f15b37970ac653
```