Smit, software architect: проверка плана и ограниченного ремонта, только чтение.

Intention: Обычный ввод выглядит проигнорированным во время скрытой подготовки CodeGraph -> запрос сразу показывает активность и этап подготовки, затем ответ или корректную отмену.
Plan: plans/2026-10-15_prompt-noop-http.md P3.
SV: progress 0.45, cancellation 0.30, independent-oracle 0.25; dominant: найти опровержение видимого прогресса, не подтвердить по виду diff.

Лимит: максимум 5 вызовов инструментов, 3 минуты. CodeGraph первым. НЕ редактировать, не запускать тесты/сборку, не коммитить и не касаться bin/. Прочитай diff и план. Пути: src/session/prompt.ts, src/session/status.ts, src/session/graph-prebuild.ts, src/cli/cmd/tui/component/prompt/index.tsx внутри packages/opencode; test/server/httpapi-prompt-start.test.ts, test/mcp/fixture/held-graph-server.ts; SDK SessionStatus в packages/sdk/js/src/{gen,v2/gen}/types.gen.ts. Всё остальное вне задания.

Локальный независимый оракул Codex — test/server/httpapi-prompt-start.test.ts с реальным HTTP/Runner/stdio MCP и локальным детерминированным провайдером, плюс кадр настоящего Session. Отдельно проверь, даёт ли синхронный spawnSync в graph-prebuild реально передать прогресс клиенту и обработать отмену до перехода к MCP. Найди только конкретные дефекты с адресом и воспроизводимым условием. Проверь соответствие задач плана текущему доказательству. Не делай вывод о дефекте HTTP200 без чтения body: он уже опровергнут контролем.

Итог по-русски: что прочитано, конкретные риски/опровержения, какие оракулы ещё нужны. Не объявляй PASS без их запуска.
