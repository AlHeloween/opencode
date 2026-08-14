# T3 — Guard бюджета хода: warn при крупной инжекции в контекст

## Abstract definition

Детектировать и логировать ходы, где Δprompt_tokens за ход превышает порог T — ранний сигнал "этот ход сожжёт кеш и деньги".

## Math formalization

- Δ_turn = prompt_tokens(t) − prompt_tokens(t−1) (из usage финальных chunk'ов, уже доступны в processor finish-step).
- Триггер: Δ_turn > T, T = 24 576 токенов (192×128, ~96K chars).
- Оценка стоимости: est_cost(Δ) = Δ × rate_miss / 1e6 (deepseek-v4-pro: $0.435/M) → лог `cache: large injection`.
- Опционально (фаза 2): при Δ > T автоматически помечать крупные старые tool-results как compacted.

## Structural diagram

```
processor.ts finish-step (usage.tokens)
        │
        ▼
Δ = prompt_tokens − lastPromptTokens (per session/model in-memory)
        │
        ├─ Δ ≤ T → ничего
        └─ Δ > T → Log.Default.warn("cache: large injection", {deltaTokens, estMissCostUsd, sessionID})
```

## Input / Output

- Input: `usage.tokens` (processor.ts:591-597), порог T (config `cacheInjectionWarnTokens`, default 24 576).
- Output: warn-лог с {deltaTokens, estMissCostUsd, modelID, sessionID} + (опционально) событие для TUI-индикации.

## Brief implementation

1. In-memory Map<sessionID+modelID, lastPromptTokens>.
2. В finish-step после line 597: вычислить Δ, при превышении — warn.
3. Юнит-тест порога через фикстуру usage.
4. Не менять байты запроса — чисто наблюдательная функция (KV-safe).

## Test cases

- t3.1: unit — Δ=68 735 > T → warn вызван с правильным estMissCostUsd (~0.0299).
- t3.2: unit — Δ=2 000 < T → тишина.
- t3.3: smoke — на реальном крупном tool-call лог появляется в `.opencode/data/log`.
