# Go/Zen request repair — 2026-10-15

План: `2026-10-14_go-zen-cache-and-headers`. Область: source cache/header contract, compiled candidate smoke; без установки в живой runtime.

✓ Независимые controls: cache RED3/10 `20261014T155641Z_480561c2`; qualified header RED32/6 `20261014T180612Z_403502da`. После ремонта `20261014T180708Z_25360fe9` — 239 PASS / 0 FAIL, typecheck `20261014T180708Z_d12e9228`exit0. Build `20261014T180811Z_340fe7fa`exit0, compiled10.0.1342, version/embedded prompt smoke PASS.

✓ Полный кандидат `dist/bin/opencode.exe run --standalone`, новый изолированный worktree/config:

| provider/model | run receipt | ответ | terminal | input/output/cache-read |
|---|---|---|---|---|
| Zen/Muse Spark 1.3 Contributor Free | `20261014T181257Z_8201227a` | `OK` | step-finish stop, exit0 | 55122/11/113 |
| Go/GLM-5.3-Flash | `20261014T181445Z_d5e194da` | `OK` | step-finish stop, exit0 | 55187/3/0 |

Сохранённое состояние: `experiments/2026-10-14_go-zen-repair/stand/.opencode/data/opencode.db`, таблица message; assistant model/provider совпадают с запуском, Zen finish=stop без error. Не обращались к БД живой сессии. Новые session IDs остаются в приватном raw receipt, а не в публичном отчёте. Нулевой cache-read Go — наблюдаемый холодный MISS, не провал исправления HTTP-контракта.

✓ Source transform + установленные SDK: Go Flash implicit30m и полный GLM implicit24h получили HTTP200. Наблюдаемые upstream — Perplexity Flash и Fireworks glm-5p3 соответственно. Отдельные Muse native Responses SDK probes вернули403 FreeTierError с/без project header. Эти probes использовали UA opencode/local и вручную собранные headers; они не равны полному compiled клиенту. Результаты сохраняются как разные слои, без утверждения, что одни лишь заголовки причинно сняли FreeTier gate.

HARNESS findings сохранены: первый H1 тест31/7 (`20261014T160220Z_8781c02f`) не дошёл до HTTP; следующий32/6 (`20261014T180501Z_f8c332d7`) дошёл для Go, но не Zen. Header oracle исправлен использованием известного registry fixture и явного StreamInput; production code для исправления harness не менялся. Первое source probe начало с module-resolution failure `20261014T160046Z_fd2dbcad`; сеть не вызвана, квалификация восстановлена через package-local createRequire до полного повторного запуска.

✓ Master renderer запущен из repo cwd `20261014T181446Z_7651b383`: правильный Global.Path.data вернул три существующих SVM manifests. Ранний запуск из package cwd не читал их; ошибочная проекция исправлена штатным renderer, SVM store не переписывался.

Данные и source SHA256: [evidence.json](evidence.json). Полные state/stdout тестов и сборки архивированы после content check; приватные CLI/stdout и SDK request bodies сохранены по raw_address и hash. Auth/config/DB/prompt dumps не входят в публичный архив.

Архив хранит исходные bytes через локальный `.gitattributes` (`-text -whitespace`); index byte identity проверяется отдельно перед commit.

Остаток: фактический TTL24h не измерен; full Fireworks Flash model URI через Go отвергнут400 Model is unavailable; keep-warm20min только гипотеза с требуемым idle/control опытом. Живой `bin/` не менялся. Успех двух candidate smoke не доказывает устойчивость при всех моделях, free-tier quota состояниях и маршрутах. Полный исторический портфель планов здесь не квалифицировался.

SV: request-contract0.40, oracle-evidence0.40, residual0.20; dominant: независимая проверка ремонта с сохранёнными отрицательными controls.
