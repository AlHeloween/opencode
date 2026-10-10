# Claude Haiku 5.5: параметры thinking

```yaml
Keywords: haiku-5.5 0.45, adaptive-thinking 0.30, sdk-wire 0.25
Semantic dominant: Зафиксировать контракт Haiku 5.5 и границу локальной проверки SDK.
md5: 639c1a0e74b548d9a5302cbe186df724
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 7ac164db203b49af985ceb70106a8d42
```

Haiku 5.5 требует adaptive thinking вместо старого `enabled` с бюджетом токенов. Effort передаётся в `output_config.effort`; доступны `low`, `medium`, `high`, `xhigh`, `max`. Контракт: [руководство миграции](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide) и [параметры effort Haiku](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5).

В `packages/opencode/src/provider/transform.ts` общий `anthropicAdaptiveEfforts` распознаёт `haiku-5-5` и `haiku-5.5`. Его используют существующие ветви Anthropic, Vertex Anthropic, gateway, Bedrock и SAP. Поведение Haiku 4.5 сохранено.

Локально подтверждено 2026-10-11: тесты вызывают настоящий `ProviderTransform`; установленный Anthropic SDK сериализует `thinking.type=adaptive`, не добавляет `budget_tokens` и передаёт effort в `output_config`. Перехвачен локальный fetch — платного запроса нет. Проверка SDK body не доказывает приём запроса удалённым API или работу установленного TUI.

Из `packages/opencode`:

```text
bun test test/provider/transform.test.ts test/provider/transform-anthropic-adaptive.test.ts
bun typecheck
```

Независимый повтор Codex вместе с scratch wire probe: 181 pass / 0 fail; typecheck exit 0; `_build.ps1 -Task build` exit 0. Кандидат собран в `dist/`; установка в `bin/` — отдельное действие владельца.

Адреса запусков, SHA-256 и границы доказательств: [завершённый план](../plans_completed/2026-10-11_haiku-adaptive-thinking.md).
