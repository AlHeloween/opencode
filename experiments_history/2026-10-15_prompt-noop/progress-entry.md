## [2026-10-15] Видимая подготовка обычного запроса

✓ Воспроизведено невидимое ожидание CodeGraph до первого loop: `20261015T102303Z_2fdb7fb9`, status=null, providerCalls=0; после release HTTP работает. RunLoop теперь сразу busy, Prompt показывает `preparing code graph`. CLI sync асинхронен, timeout/отмена завершает дерево процессов через Shell.killTree.
✓ После отдельного RED на застрявшей подписи status заменяется reconcile. `20261015T104749Z_22dfd0be`: 4 pass / 31 assertions, HTTP + stdio MCP + native кадры preparing/working/reply, repeat/async/cancel/restart, sync child killed. Регрессии: 37 pass / 104 assertions (`20261015T104750Z_d3f2a2dd`) и 6 pass / 11 assertions (`20261015T103420Z_2de151fa`). Typecheck `20261015T104743Z_d8198efe` exit0. Недостающее optional scope в типе source_stamps описано без ослабления assertion.
✓ `_build.ps1`: `20261015T104858Z_d9d64687` exit0, candidate10.0.1357, version/embedded-prompt smoke. План: `plans_completed/2026-10-15_prompt-noop-http.md`; доказательства: `experiments_history/2026-10-15_prompt-noop/`.
Границы: stdio MCP и native TUI/serialized Bus, не живой LLM/SSE; bin и данные XEComponents не менялись. RED baseline параллельного hybrid formatter (5 pass / 4 fail, `20261015T104233Z_6d606fc3`) сохранён и учтён в его активном плане; общий all-tests PASS не заявляется.
<!-- sv: prompt-preparation,visible-progress,cancellation,independent-oracle -->

