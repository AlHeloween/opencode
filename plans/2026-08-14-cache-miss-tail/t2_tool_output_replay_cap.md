# T2 — Дефолтный кап tool-output в replay (toolOutputMaxChars)

## Abstract definition

Включить существующий, но неиспользуемый механизм `toolOutputMaxChars` (`message-v2.ts:780/937`) с дефолтом, чтобы крупные tool-outputs попадали в replay-историю обрезанными (digest + ссылка на `outputPath`), а не целиком.

## Math formalization

- miss(t+1) ≈ Σ новых токенов, добавленных в контекст за ход t (C1).
- Вклад tool-output: tokens_out ≈ chars/4.
- С капом C (chars): replay-размер блока ≤ C + digest(~100 chars).
- Экономия на запрос: Δcost ≈ rate_miss × (chars_out − C)/4 × 10⁻⁶.
- Цель: C = 32 000 chars (~8K токенов) → для блока 100K chars: Δcost ≈ 0.435 × 17 000/1e6 ≈ $0.0074 за инжекцию.

## Structural diagram

```
tool execute → Truncate.Service (tools.ts:301) → outputPath (уже есть для гигантов)
        │
        ▼
toModelMessagesEffect(message-v2.ts:937)
  toolOutputMaxChars = config.toolOutputMaxChars ?? 32_000
        │
        ├─ output ≤ C → как есть
        └─ output > C → первые C + "\n[Tool output truncated: N chars omitted — full output: {outputPath}]"
        ▼
checkpoint cacheKey (message-v2.ts:855) уже включает toolOutputMaxChars → префикс не смешивается
```

## Input / Output

- Input: `part.state.output` (string), `part.state.outputPath` (опционально), config `toolOutputMaxChars` (default 32 000).
- Output: обрезанный текст с digest-маркером.

## Brief implementation

1. Конфиг: `toolOutputMaxChars` (default 32 000) в session/config.
2. Прокинуть options в callsites `toModelMessagesEffect` (`prompt.ts` ~310/1918/1922/1931).
3. Digest: `${text.slice(0,C)}\n[Tool output truncated for cache economy: ${omitted} chars omitted${outputPath ? `; full output: ${outputPath}` : ""}]`.
4. [KV-CACHE RISK]: после деплоя один холодный ход на активных сессиях (байты replay меняются) — задокументировать; checkpoint fingerprint system-уровня не затрагивается.
5. Compaction-взаимодействие: уже обрабатывается (`part.state.time.compacted` → "[Old tool result content cleared]").

## Test cases

- t2.1: unit — output 100K chars, C=32K → конвертация содержит ≤ ~33K chars + маркер + outputPath.
- t2.2: unit — output < C → не тронут (байт-идентичен).
- t2.3: oracle — wire post-сравнение: ход с гигантским tool-output добавляет в prompt_tokens ≤ ~8K+overhead (против 60K+ до).
- t2.4: `bun typecheck` + существующие session-тесты зелёные.
