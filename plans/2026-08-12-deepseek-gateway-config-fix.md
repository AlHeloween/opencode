# Fix: DeepSeek api.npm — ОДНА логика в двух местах

## Принцип
`gateway.jsonc` — спецификация реальности. Должен показывать то что **фактически** использовал прокси.  
`provider.ts` — SDK-роутинг. Должен использовать **тот же** npm.

Оба должны применять одинаковую data-driven логику: `model.id содержит "deepseek"+"v4" → @ai-sdk/deepseek`.

## Правки (3 файла, 4 строки)

### 1. `provider.ts:981` — fromModelsDevModel (SDK-роутинг)
```ts
// СТАЛО:
npm:
  (model.id.toLowerCase().includes("deepseek") && model.id.toLowerCase().includes("v4")
    ? "@ai-sdk/deepseek"
    : model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"),
```
**Проверка ПЕРВАЯ**, переопределяет models.dev.

### 2. `provider.ts:1141-1146` — config модели (SDK-роутинг)
```ts
// СТАЛО:
const apiNpm = ...
  ?? (modelID.toLowerCase().includes("deepseek") && modelID.toLowerCase().includes("v4")
    ? "@ai-sdk/deepseek" : "@ai-sdk/openai-compatible")
```

### 3. `config-manager.ts:104` — генератор gateway.jsonc (СПЕЦИФИКАЦИЯ)
```ts
// СТАЛО:
npm:
  model.provider?.npm ??
  provider.npm ??
  (model.id?.toLowerCase().includes("deepseek") && model.id?.toLowerCase().includes("v4")
    ? "@ai-sdk/deepseek"
    : "@ai-sdk/openai-compatible"),
```
**Та же логика**, чтобы gateway.jsonc показывал реальный npm.

## Результат
- `provider.ts` выбирает `@ai-sdk/deepseek` для V4 моделей
- `gateway.jsonc` показывает `"npm": "@ai-sdk/deepseek"` для V4 моделей
- Спецификация = реальность
