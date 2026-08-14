# T4 — Честные метрики кеша: агрегация по шагам + cache.write

## Abstract definition

Исправить `message.data.tokens`, который сейчас перезаписывается последним step-usage (processor.ts:599), на корректную агрегацию по всем шагам сообщения; добавить маппинг `cache.write` там, где провайдер его отдаёт.

## Math formalization

- Для сообщения с шагами s=1..N:
  - input_msg = Σ input(s); output_msg = Σ output(s); reasoning_msg = Σ reasoning(s)
  - read_msg = Σ cache.read(s); write_msg = Σ cache.write(s)
  - cacheRatio_msg = read_msg / max(1, input_msg + read_msg + write_msg)
- Сейчас: input_msg = input(N) (один шаг), read_msg = Σ read(s) → ratio завышен для мультишаговых сообщений.
- Источник per-step данных уже есть: `step-finish` parts хранят tokens (processor.ts:626) — per-request ряд строим из них, БД не трогаем.

## Structural diagram

```
step-finish part (per-step tokens, уже пишется)
        │
        ▼
processor.ts:599
  ctx.assistantMessage.tokens = Σ(по шагам) вместо "=" (последнего)
        │
        ▼
message.data.tokens (честная агрегация)  →  cacheRatio не смешанный
```

## Input / Output

- Input: usage.tokens per step (processor.ts), существующие step-finish parts.
- Output: message.data.tokens с Σ-агрегацией; исторические строки помечаются (не переписываются).

## Brief implementation

1. `processor.ts`: заменить присваивание на аккумуляцию (add input/output/reasoning/cache.read/cache.write) с инициализацией на первом шаге.
2. `cache.write`: по explore-валидации поле **хардкодится** `cacheWrite: undefined` в `openai-compatible-chat-language-model.ts:288` (grep `cacheWriteTokens|cache_write_tokens` в src/provider/sdk — 0 хитов). Задача: добавить маппинг `usage.prompt_tokens_details.cache_write_tokens → cacheWrite` (поле есть в OpenAI GPT-5.6+), плюс потребитель уже умеет читать `inputTokenDetails.cacheWriteTokens` (`session.ts:501`).
3. Юнит-тесты агрегации (2-3 шага с фикстурами usage).
4. Документировать в плане: старые строки БД остаются смешанными (R4).

## Test cases

- t4.1: unit — 2 шага: (input 100, read 900) + (input 200, read 1800) → message.tokens = {input:300, read:2700}, ratio = 2700/3000 = 0.9.
- t4.2: unit — текущий баг-режим даёт {input:200, read:2700}, ratio 0.931 — тест фиксирует разницу.
- t4.3: unit — write-маппинг при наличии поля в фикстуре.
- t4.4: `bun typecheck` зелёный.
