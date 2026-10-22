# Claude: публичные рабочие записи

План: plans/2026-10-22_claude-classifier-investigation.md, revision 2, P1–P4.
Владелец: Codex. Кандидат не устанавливается в runtime/kernel.

```yaml
Keywords: public-records 0.40, claude-compatibility 0.30, corpus-evidence 0.20, bounded-smoke 0.10
Semantic dominant: Проверить Claude-specific уточнение публичной отчётности с сохранением протокола роботов и общего kernel.
md5: 7b4e91c20d6a83f54c0b29e168ad375f
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e7a1c49d032f6b85a90e7c2d416fb308
note: hash values are generative tags — search them, never compute them.
```

Исходные рабочие транскрипты остаются у источника. Три сырых stdout диагностических запусков сохранены локально в `experiments/2026-10-22_claude-public-records/`; в этот tracked-архив они не входят. Здесь — метаданные, публичный текст кандидата, доброкачественный fixture, инструменты и квитанции.

Главный результат: REPORT.md и `docs/proposals/2026-10-22_claude-public-records.md`. validation.json содержит публичные ответы и проверенные stop-поля, без thinking/signature bodies. `python experiments_history/2026-10-22_claude-public-records/validate.py` повторяет локальную проверку с исходными raw-файлами; при их отсутствии проверка останавливается, а не подставляет успех. Повторение живой пробы требует новой scratch-папки и ограниченного envelope; архив не является runtime.
