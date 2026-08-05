# LLM Call Pipeline — Детальная Диаграмма Работы

> **Дата:** 2026-08-05  
> **Статус:** Исследование / Документация  
> **smoke: N/A** (документационный артефакт)

---

## Содержание

1. [Обзор архитектуры](#1-обзор-архитектуры)
2. [Детальная диаграмма потока](#2-детальная-диаграмма-потока)
3. [Пошаговое описание каждого этапа](#3-пошаговое-описание-каждого-этапа)
4. [Прокси-обработка (Gateway) — детально](#4-прокси-обработка-gateway--детально)
5. [Обработка ошибок и Retry](#5-обработка-ошибок-и-retry)
6. [Ключевые файлы и их роли](#6-ключевые-файлы-и-их-роли)
7. [Путь запроса: сводная блок-схема](#7-путь-запроса-сводная-блок-схема)
8. [Circuit Breaker — глубокое погружение](#8-circuit-breaker--глубокое-погружение)
9. [H2 Транспорт — глубокое погружение](#9-h2-транспорт--глубокое-погружение)
10. [Plugin System — глубокое погружение](#10-plugin-system--глубокое-погружение)
11. [Обнаруженные баги и исправления](#11-обнаруженные-баги-и-исправления)
12. [Тестовое покрытие DeepSeek-багов](#12-тестовое-покрытие-deepseek-багов)

---

## 1. Обзор архитектуры

OpenCode использует **многослойную архитектуру** для обработки LLM-вызовов:

| Слой | Ответственность | Ключевой файл |
|------|----------------|---------------|
| **Входной** (Entry) | TUI / SDK / CLI / ACP — пользовательский ввод | `session/prompt.ts`, `sdk.gen.ts`, `acp/agent.ts` |
| **Оркестратор** (Loop) | Цикл сообщений, управление контекстом, сжатие | `session/prompt.ts` (`runLoop`) |
| **Построитель запроса** (LLM Service) | Сборка system prompt, параметров, вызов AI SDK | `session/llm.ts` (`Service.stream`) |
| **Провайдер** (Provider Resolution) | Разрешение SDK, baseURL, apiKey, custom fetch | `provider/provider.ts` (`resolveSDK`) |
| **Трансформация** (Transform) | Нормализация опций, сообщений, caching | `provider/transform.ts` |
| **AI SDK** | Vercel AI SDK (`streamText`) | `@ai-sdk/anthropic`, `@ai-sdk/openai`, etc. |
| **Прокси/Gateway** | Rate limiting, circuit breaker, H2, logging | `provider/gateway/adaptive-client.ts` |
| **Транспорт** | HTTP/2 или HTTP/1.1 к upstream провайдеру | `provider/gateway/h2-transport.ts`, `h1-transport.ts` |
| **Обработчик ответа** (Processor) | Парсинг стрима, сохранение частей, tool calls | `session/processor.ts` |
| **Middleware** (Plugin Hooks) | Перехват params/headers/messages до и после | `plugin/index.ts`, плагины `github-copilot`, `codex`, `gemini` |

---

## 2. Детальная диаграмма потока

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          1. ВХОДНЫЕ ТОЧКИ                                    │
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────┐       │
│  │ TUI (ink) │    │  SDK JS  │    │ ACP Agent│    │ /session/{id}    │       │
│  │ prompt.tsx│    │sdk.gen.ts│    │agent.ts  │    │ /message (REST)  │       │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └────────┬─────────┘       │
│       │               │              │                    │                  │
│       └───────────────┴──────────────┴────────────────────┘                  │
│                              │                                               │
│                              ▼                                               │
│         SessionPrompt.prompt(input: PromptInput)                             │
│         packages/opencode/src/session/prompt.ts:1104                          │
│                              │                                               │
│           ┌──────────────────┼──────────────────┐                            │
│           ▼                  ▼                  ▼                            │
│    createUserMessage   resolveParts       setPermissions                      │
│    (создаёт User msg    (файлы, MCP,      (если заданы                       │
│     с частями)           агенты, dataURL)   в tools)                         │
│           │                                 │                               │
│           └──────────────────┬──────────────┘                                │
│                              ▼                                               │
│                         loop(sessionID)                                      │
│                         = runLoop()                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                     2. ЦИКЛ СООБЩЕНИЙ (runLoop)                              │
│                    prompt.ts:1148 — while(true)                               │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Итерация цикла (step = 0, 1, 2, ...)                               │    │
│  │                                                                      │    │
│  │  a) filterCompactedEffect ⟶ история сообщений (с кэшированием)      │    │
│  │  b) Поиск lastUser / lastAssistant / tasks (subtask parts)           │    │
│  │  c) insertReminders ⟶ synthetic части (mode transition, agent role) │    │
│  │  d) Определение agent (из lastUser.agent)                            │    │
│  │  e) Определение model (из lastUser.model или defaultModel)           │    │
│  │  f) SessionTools.resolve() ⟶ набор инструментов                     │    │
│  │  g) assemblePathSystem() ⟶ system prompt (UE, tools, kernel, path)  │    │
│  │  h) Создание Assistant message (пустой, без finish)                  │    │
│  │  i) SessionProcessor.create({assistantMessage, model, ...})          │    │
│  │  j) handle.process(streamInput) ──────────────────────┐              │    │
│  │  k) По результату: "continue" → tool results → │       │              │    │
│  │     снова в цикл; "stop" → выход;              │       │              │    │
│  │     "compact" → сжатие → выход                 │       │              │    │
│  └────────────────────────────────────────────────┼───────┘              │    │
│                                                    │                      │    │
└────────────────────────────────────────────────────┼──────────────────────┘    │
                                                     │                           │
┌────────────────────────────────────────────────────┼───────────────────────────┤
│              3. ПОСТРОЕНИЕ LLM ЗАПРОСА (LLM.Service.stream)                    │
│                         llm.ts:256-550                                         │
│                                                    │                           │
│  ┌─────────────────────────────────────────────────┼─────────────────────┐    │
│  │  StreamInput {                                   │                     │    │
│  │    user, sessionID, model, agent,               │                     │    │
│  │    system[], messages[], tools{},               │                     │    │
│  │    abort, retries, outputTokenMax, ...          │                     │    │
│  │  }                                               │                     │    │
│  │                                                  ▼                     │    │
│  │  a) provider.getLanguage(model) ⟶ LanguageModel (кэширован)          │    │
│  │  b) provider.getProvider(providerID) ⟶ Provider info                 │    │
│  │  c) auth.get(providerID) ⟶ учётные данные (OAuth/API key)            │    │
│  │                                                                       │    │
│  │  d) ProviderTransform.systemPromptParts(model)                       │    │
│  │     ├── reasoning prefix (CoT инструкции)                             │    │
│  │     ├── algorithm card (дата, модель, ограничения)                    │    │
│  │     └── kernel (базовые правила)                                      │    │
│  │                                                                       │    │
│  │  e) assembleSystemMessages({...}) ⟶ string[]                         │    │
│  │     ├── UNIVERSAL_ENV (os, shell, date, dir)                          │    │
│  │     ├── toolSchemas (сериализованные JSON Schema инструментов)        │    │
│  │     ├── reasoningPrefix                                               │    │
│  │     ├── algorithmCard                                                 │    │
│  │     ├── kernel                                                       │    │
│  │     ├── pathSystem (из assemblePathSystem)                           │    │
│  │     ├── banner [session: <cacheKey>]                                 │    │
│  │     ├── userSystem (из user.system)                                  │    │
│  │     └── checkpoint (если isCheckpoint)                               │    │
│  │                                                                       │    │
│  │  f) plugin.trigger("experimental.chat.system.transform")              │    │
│  │     ⟶ плагины могут модифицировать system[]                          │    │
│  │                                                                       │    │
│  │  g) collapseSystemMessages() ⟶ стабильный префикс + mutable tail     │    │
│  │     (оптимизация для prompt caching — KV-cache хитов)                 │    │
│  │                                                                       │    │
│  │  h) buildProviderCacheKey() + checkSystemStability()                 │    │
│  │     ⟶ детект cache-poisoning между запусками                         │    │
│  │                                                                       │    │
│  │  i) ProviderTransform.options() / smallOptions()                     │    │
│  │     ├── temperature, topP, topK                                      │    │
│  │     ├── maxOutputTokens (с учётом reasoning моделей: ×3 бюджет)      │    │
│  │     ├── providerOptions (store, prompt_cache_key, thinking, ...)     │    │
│  │     └── mergeDeep с model.options, agent.options, variant            │    │
│  │                                                                       │    │
│  │  j) plugin.trigger("chat.params") ⟶ плагины корректируют параметры  │    │
│  │     (напр. GitHub Copilot убирает maxOutputTokens для gpt)           │    │
│  │                                                                       │    │
│  │  k) plugin.trigger("chat.headers") ⟶ плагины добавляют заголовки    │    │
│  │     (напр. anthropic-beta, x-initiator)                              │    │
│  │                                                                       │    │
│  │  l) resolveTools() ⟶ полный набор AI SDK tools                      │    │
│  │     ├── базовые: bash, read, write, edit, glob, grep, task, ...      │    │
│  │     ├── MCP tools (из .opencode/mcp.json)                            │    │
│  │     └── custom tools (из плагинов)                                   │    │
│  │                                                                       │    │
│  │  m) Специальная обработка:                                           │    │
│  │     ├── LiteLLM proxy: dummy _noop tool если есть tool_calls         │    │
│  │     ├── OpenAI OAuth: system → instructions (Responses API)          │    │
│  │     ├── GitLab Workflow: toolExecutor + approval handler             │    │
│  │     └── DeepSeek/Reasoning: maxOutputTokens ×3 (учёт thinking)      │    │
│  │                                                                       │    │
│  │  n) streamText({ model, system, messages, tools,                     │    │
│  │                  ...params, ...providerOptions, headers })           │    │
│  │     └──▶ AI SDK (Vercel)                                             │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                      4. РАЗРЕШЕНИЕ ПРОВАЙДЕРА                                  │
│                  provider.ts:resolveSDK() — строки 1396-1543                  │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  a) baseURL разрешение:                                              │    │
│  │     ├── options["baseURL"] ?? model.api.url                          │    │
│  │     ├── ${ENV_VAR} подстановка из process.env                        │    │
│  │     └── varsLoaders: кастомные подстановки (напр. GitHub Copilot)    │    │
│  │                                                                       │    │
│  │  b) apiKey: options["apiKey"] ?? provider.key (из конфига)           │    │
│  │                                                                       │    │
│  │  c) headers: model.headers добавляются к options.headers             │    │
│  │                                                                       │    │
│  │  d) Кэширование SDK:                                                  │    │
│  │     key = Hash.fast(JSON.stringify({providerID, npm, options}))      │    │
│  │     s.sdk.get(key) → возврат из кэша если есть                       │    │
│  │                                                                       │    │
│  │  e) CUSTOM FETCH (ключевой момент):                                  │    │
│  │     ┌──────────────────────────────────────────────────────────┐     │    │
│  │     │  options["fetch"] = async (input, init) => {              │     │    │
│  │     │    const gwFetch = globalThis.__gatewayFetch              │     │    │
│  │     │    const fetchFn = customFetch ?? gwFetch ?? fetch        │     │    │
│  │     │                                                           │     │    │
│  │     │    // Комбинирование сигналов отмены:                     │     │    │
│  │     │    signals = [opts.signal, chunkTimeout.signal,           │     │    │
│  │     │              AbortSignal.timeout(options.timeout)]        │     │    │
│  │     │    combined = AbortSignal.any(signals)                    │     │    │
│  │     │                                                           │     │    │
│  │     │    // Очистка OpenAI itemId метаданных (как codex)        │     │    │
│  │     │                                                           │     │    │
│  │     │    const res = await fetchFn(input, {                     │     │    │
│  │     │      ...opts,                                             │     │    │
│  │     │      timeout: false,    // отключаем bun timeout          │     │    │
│  │     │      gatewayProvider: model.providerID,                   │     │    │
│  │     │      gatewayModel: model.id,                              │     │    │
│  │     │      gatewayProtocol: model.options?.protocol,            │     │    │
│  │     │      gatewayStreaming: model.options?.streaming,          │     │    │
│  │     │    })                                                     │     │    │
│  │     │                                                           │     │    │
│  │     │    // SSE chunk timeout (если задан)                      │     │    │
│  │     │    return wrapSSE(res, chunkTimeout, chunkAbortCtl)       │     │    │
│  │     │  }                                                        │     │    │
│  │     └──────────────────────────────────────────────────────────┘     │    │
│  │                                                                       │    │
│  │  f) Загрузка SDK:                                                    │    │
│  │     ├── BUNDLED_PROVIDERS (встроенные: anthropic, openai, ...)       │    │
│  │     ├── Npm.add(model.api.npm) — динамическая установка пакета       │    │
│  │     └── import(pathToFileURL(installedPath).href) — загрузка модуля  │    │
│  │                                                                       │    │
│  │  g) factory({ name, ...options }) → SDK (с custom fetch внутри)     │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│               5. GATEWAY PROXY (ПРОКСИ-ОБРАБОТКА)                             │
│          adaptive-client.ts:wrapFetch() — строки 216-754                      │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  ИНИЦИАЛИЗАЦИЯ:                                                      │    │
│  │  gateway/mod.ts:80                                                    │    │
│  │  globalThis.__gatewayFetch = wrapFetch(globalThis.fetch)              │    │
│  │  (выполняется при старте приложения, слой GatewayLayer)               │    │
│  │                                                                       │    │
│  │  НА КАЖДЫЙ ЗАПРОС:                                                   │    │
│  │                                                                       │    │
│  │  a) OAuth token passthrough:                                         │    │
│  │     x-opencode-oauth-token → Authorization: Bearer <token>           │    │
│  │     x-opencode-account-id → ChatGPT-Account-Id                       │    │
│  │     x-opencode-oauth-url → перезапись URL (ChatGPT backend)          │    │
│  │                                                                       │    │
│  │  b) Классификация запроса (Classifier.classify):                     │    │
│  │     ├── hasTools: true/false                                         │    │
│  │     ├── streaming: true/false                                        │    │
│  │     ├── maxTokens: число                                             │    │
│  │     ├── contextTokens: число                                         │    │
│  │     └── hasAttachments: true/false                                   │    │
│  │     → requestShapeClass (категория запроса)                          │    │
│  │                                                                       │    │
│  │  c) Построение RouteKey:                                             │    │
│  │     { provider, baseUrl, model, endpointKind, stream, shapeClass }   │    │
│  │                                                                       │    │
│  │  d) Разрешение протокола (resolveGatewayProtocol):                   │    │
│  │     ├── h2 (по умолчанию для openai)                                 │    │
│  │     └── http/1.1 (fallback)                                          │    │
│  │                                                                       │    │
│  │  e) Rate Limiting (последовательно):                                 │    │
│  │     ┌──────────────────────────────────────────────────────┐         │    │
│  │     │  1. LAUNCH limiter (minLaunchIntervalMs)             │         │    │
│  │     │     ├── acquireWithBackoff(limiterState, routeKey,   │         │    │
│  │     │     │   policy, "launch", timeoutMs, isStream)       │         │    │
│  │     │     └── FAIL → "Gateway launch timeout"              │         │    │
│  │     │                                                      │         │    │
│  │     │  2. INFLIGHT limiter (maxInflight)                   │         │    │
│  │     │     ├── acquireWithBackoff(limiterState, routeKey,   │         │    │
│  │     │     │   policy, "inflight", timeoutMs, isStream)     │         │    │
│  │     │     └── FAIL → "Gateway inflight timeout"            │         │    │
│  │     │                                                      │         │    │
│  │     │  3. STREAM budget (maxStreams) — только для стримов  │         │    │
│  │     │     ├── acquireWithBackoff(streamState, policy,      │         │    │
│  │     │     │   keyStr, timeoutMs)                           │         │    │
│  │     │     └── FAIL → "Gateway stream budget exhausted"     │         │    │
│  │     └──────────────────────────────────────────────────────┘         │    │
│  │                                                                       │    │
│  │  f) Circuit Breaker проверка:                                        │    │
│  │     Store.isCircuitBreakerOpen(routeKey) → ошибка если открыт        │    │
│  │                                                                       │    │
│  │  g) Выбор транспорта:                                                │    │
│  │     ┌─────────────────────────────────────────────────────┐          │    │
│  │     │  useH2 = modelProtocol === "h2"                     │          │    │
│  │     │                                                      │          │    │
│  │     │  ЕСЛИ useH2:                                         │          │    │
│  │     │    ЕСЛИ streaming:                                   │          │    │
│  │     │      H2.requestStream({baseUrl, url, method,        │          │    │
│  │     │        headers, body})                              │          │    │
│  │     │    ИНАЧЕ:                                            │          │    │
│  │     │      H2.request({...})                              │          │    │
│  │     │      ЕСЛИ ошибка И shouldFallbackToH1:              │          │    │
│  │     │        H2.closeSession(baseUrl)                     │          │    │
│  │     │        → H1.request({url, method, headers,          │          │    │
│  │     │            body, signal})                           │          │    │
│  │     │      ЕСЛИ неустранимая ошибка:                      │          │    │
│  │     │        Store.recordError + recordCircuitBreakerFailure│        │    │
│  │     │  ИНАЧЕ:                                             │          │    │
│  │     │    H1.request({...})                                │          │    │
│  │     └─────────────────────────────────────────────────────┘          │    │
│  │                                                                       │    │
│  │  h) SSE Coalescing (CoalescingTransform):                            │    │
│  │     Буферизация мелких SSE-чанков перед отправкой потребителю         │    │
│  │                                                                       │    │
│  │  i) Запись метрик + логов:                                           │    │
│  │     ├── Metrics.MetricsSample (тайминги каждого этапа)               │    │
│  │     ├── JSONL лог запроса (headers, body diff)                       │    │
│  │     ├── per-request git-format diff файлы                             │    │
│  │     └── Обновление health score для route                            │    │
│  │                                                                       │    │
│  │  j) Возврат Response (стрим или полный) в AI SDK                      │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                6. ОБРАБОТКА ОТВЕТА (Processor)                                 │
│            processor.ts: handle.process(streamInput)                           │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  process(streamInput) {                                              │    │
│  │    const stream = llm.stream(streamInput)                            │    │
│  │                                                                       │    │
│  │    stream.pipe(                                                       │    │
│  │      Stream.tap(handleEvent),     // обработка каждого события       │    │
│  │      Stream.takeUntil(needsCompaction),                               │    │
│  │      Stream.runDrain,                                                 │    │
│  │    ).pipe(                                                            │    │
│  │      Effect.retry(SessionRetry.policy(...)),  // retry policy        │    │
│  │      Effect.catch(halt),                     // error → halt         │    │
│  │      Effect.ensuring(cleanup()),             // очистка              │    │
│  │    )                                                                  │    │
│  │  }                                                                    │    │
│  │                                                                       │    │
│  │  handleEvent (switch по type):                                        │    │
│  │  ┌──────────────────────────────────────────────────────┐            │    │
│  │  │  "start"          → ctx.streamStartTime = now        │            │    │
│  │  │  "reasoning-start"→ создать ReasoningPart             │            │    │
│  │  │  "reasoning-delta"→ append текст + updatePartDelta   │            │    │
│  │  │  "reasoning-end"  → finishReasoning (сохранить)      │            │    │
│  │  │  "tool-input-start"→ ensureToolCall (pending part)   │            │    │
│  │  │  "tool-input-delta"→ (игнорируется)                  │            │    │
│  │  │  "tool-call"      → updateToolCall → running         │            │    │
│  │  │                     ├── проверка doom loop (3 повтора)│           │    │
│  │  │                     ├── проверка write tools          │            │    │
│  │  │                     └── поднятие evidence floor       │            │    │
│  │  │  "tool-result"    → completeToolCall (completed)      │            │    │
│  │  │  "tool-error"     → failToolCall (error)              │            │    │
│  │  │  "text-start"     → создать TextPart                  │            │    │
│  │  │  "text-delta"     → append + updatePartDelta          │            │    │
│  │  │  "text-end"       → сохранить + claim ledger ingest   │            │    │
│  │  │  "start-step"     → snapshot + step-start part        │            │    │
│  │  │  "finish-step"    → подсчёт токенов/стоимости         │            │    │
│  │  │                     ├── Usage (input/output/reasoning) │            │    │
│  │  │                     ├── Cost (из model.cost)           │            │    │
│  │  │                     ├── DB update (session totals)     │            │    │
│  │  │                     ├── Patch diff (если write tools)  │            │    │
│  │  │                     ├── Balance check (5-min interval) │            │    │
│  │  │                     ├── Overflow detection → compact   │            │    │
│  │  │                     └── publish ModelStatusUpdated     │            │    │
│  │  │  "finish"         → (финальное событие стрима)        │            │    │
│  │  │  "error"          → throw value.error                  │            │    │
│  │  └──────────────────────────────────────────────────────┘            │    │
│  │                                                                       │    │
│  │  cleanup():                                                           │    │
│  │  ├── Выгрузка snapshot patch                                         │    │
│  │  ├── Сохранение незавершённых reasoning/text частей                  │    │
│  │  ├── Ожидание pending tool calls (timeout 10s)                       │    │
│  │  ├── Пометка незавершённых tool calls как error (interrupted)        │    │
│  │  └── Финальное обновление assistantMessage                           │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                               │
│  Результат process():                                                         │
│  ├── "continue" → вернуть tool results обратно в LLM                         │
│  ├── "stop"     → завершить (finish reason terminal или error)               │
│  └── "compact"  → нужно сжатие контекста                                     │
│                                                                               │
│  runLoop (продолжение):                                                       │
│  ├── "continue": сохранить tool results как новые user/tool parts            │
│  │   → следующий виток while(true)                                           │
│  ├── "stop": publish MessageCompleted, ensureTitle, maybeSidecar              │
│  │   → выход из runLoop                                                      │
│  └── "compact": compaction.compact(), Checkpoint.remove(),                    │
│      сброс кэша → выход (новый запрос пользователя запустит новый runLoop)   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Пошаговое описание каждого этапа

### 3.1 Входные точки (Entry Points)

| Точка входа | Файл | Описание |
|-------------|------|----------|
| **TUI** | `cli/cmd/tui/routes/session/index.tsx` → `SessionPrompt.prompt()` | Пользователь вводит сообщение в терминале |
| **SDK JS** | `sdk/js/src/v2/gen/sdk.gen.ts:2276` (`prompt()`) | HTTP POST `/session/{id}/message` |
| **ACP Agent** | `acp/agent.ts:1367` (`prompt()`) | Agent Communication Protocol (MCP-совместимый) |
| **CLI Command** | `session/prompt.ts` → `command()` | `/command` в чате |

### 3.2 Цикл сообщений (runLoop)

`prompt.ts:1148` — бесконечный цикл, который:

1. **Фильтрует историю**: `filterCompactedEffect()` — сообщения, не попавшие под сжатие
2. **Ищет последнего пользователя и ассистента**: для определения контекста
3. **Вставляет напоминания**: `insertReminders()` — synthetic части (mode transition, agent role)
4. **Разрешает инструменты**: `SessionTools.resolve()` — полный набор с учётом ACL
5. **Строит system prompt**: `assemblePathSystem()` → `assembleSystemMessages()`
6. **Создаёт Assistant message**: пустой, без `finish`
7. **Создаёт Processor**: `SessionProcessor.create({...})`
8. **Вызывает process()**: `handle.process(streamInput)` → LLM вызов
9. **Обрабатывает результат**: `continue` / `stop` / `compact`

### 3.3 LLM Service (llm.ts)

`llm.ts:256` — единая точка сборки запроса.

**Ключевые операции:**
- Получение `LanguageModel` из кэша провайдера
- Сборка system prompt из 6+ компонентов
- Коллапс system prompt для cache stability (KV-cache)
- Расчёт выходных токенов (×3 для reasoning моделей)
- Применение плагинов (`chat.params`, `chat.headers`, `chat.system.transform`)
- Спец-обработка для LiteLLM, OpenAI OAuth, GitLab Workflow
- Вызов `streamText()` из AI SDK

### 3.4 Разрешение провайдера (resolveSDK)

`provider.ts:1396` — создаёт AI SDK language model с кастомным `fetch`.

**Ключевые операции:**
- Разрешение `baseURL` с `${ENV_VAR}` подстановкой
- Создание custom fetch с интеграцией Gateway (`__gatewayFetch`)
- Комбинирование сигналов отмены (user abort + chunk timeout + global timeout)
- Очистка OpenAI itemId метаданных
- Передача gateway-метаданных через поля запроса
- Динамическая загрузка npm пакета провайдера

### 3.5 Gateway Proxy

`adaptive-client.ts:216` — HTTP-прокси, через который проходят **все** LLM запросы.

**Подробно описано в разделе 4.**

### 3.6 Обработка ответа (Processor)

`processor.ts:889` — потребляет стрим событий от AI SDK.

**Обрабатываемые события:**
- `start`, `finish` — границы стрима
- `reasoning-start/delta/end` — мышление модели (CoT)
- `text-start/delta/end` — текстовый вывод
- `tool-input-start/delta/end` — аргументы вызова инструмента
- `tool-call` — вызов инструмента (с проверкой doom loop)
- `tool-result`, `tool-error` — результат выполнения
- `start-step`, `finish-step` — шаги (multi-step вызовы)
- `file` — файлы в ответе
- `error` — ошибка стрима

**На `finish-step`:**
- Подсчёт токенов и стоимости
- Обновление БД (сессионные totals)
- Snapshot + patch diff
- Проверка баланса (каждые 5 минут)
- Детект переполнения контекста → `compact`

---

## 4. Прокси-обработка (Gateway) — детально

### 4.1 Инициализация

```
gateway/mod.ts:48  Layer.effect(Service, ...)
  ├── loadGatewayConfig()  →  ~/.config/opencode/gateway.jsonc
  │                          + .opencode/gateway.jsonc (merge)
  ├── configureLogging(enabled, format)
  ├── setDebugConfig(config)
  ├── initLogger()
  ├── LogRotator (ротация логов)
  └── globalThis.__gatewayFetch = wrapFetch(globalThis.fetch)
```

### 4.2 Архитектура Gateway

```
                    ┌──────────────────────┐
                    │   AI SDK fetch()     │
                    │   (каждый провайдер) │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  custom fetch из     │
                    │  resolveSDK()        │
                    │  ↓                   │
                    │  gwFetch =           │
                    │  __gatewayFetch      │
                    └──────────┬───────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │    wrapFetch()                       │
            │    adaptive-client.ts:216            │
            │                                      │
            │  ┌──────────────────────────────┐   │
            │  │ 1. OAuth passthrough         │   │
            │  │ 2. Classifier.classify()     │   │
            │  │ 3. RouteKey construction     │   │
            │  │ 4. Health score lookup       │   │
            │  │ 5. Logging (start)           │   │
            │  └──────────────┬───────────────┘   │
            │                 │                    │
            │  ┌──────────────▼───────────────┐   │
            │  │ RATE LIMITING                 │   │
            │  │  ├── Launch limiter           │   │
            │  │  ├── Inflight limiter         │   │
            │  │  └── Stream budget            │   │
            │  └──────────────┬───────────────┘   │
            │                 │                    │
            │  ┌──────────────▼───────────────┐   │
            │  │ CIRCUIT BREAKER               │   │
            │  │  isCircuitBreakerOpen()?      │   │
            │  └──────────────┬───────────────┘   │
            │                 │                    │
            │  ┌──────────────▼───────────────┐   │
            │  │ TRANSPORT SELECTION           │   │
            │  │  ├── H2 (primary)             │   │
            │  │  │   ├── requestStream()      │   │
            │  │  │   └── request()            │   │
            │  │  └── H1 (fallback)            │   │
            │  │      └── request()            │   │
            │  └──────────────┬───────────────┘   │
            │                 │                    │
            │  ┌──────────────▼───────────────┐   │
            │  │ POST-PROCESSING               │   │
            │  │  ├── SSE coalescing           │   │
            │  │  ├── Metrics recording        │   │
            │  │  ├── Health score update      │   │
            │  │  └── Request logging          │   │
            │  └──────────────────────────────┘   │
            └──────────────────────────────────────┘
```

### 4.3 Rate Limiting

Три последовательных лимитера:

| Лимитер | Параметр | Описание |
|---------|----------|----------|
| **Launch** | `minLaunchIntervalMs` | Минимальный интервал между запусками запросов к одному роуту |
| **Inflight** | `maxInflight` | Максимальное число одновременных запросов в полёте |
| **Stream** | `maxStreams` | Максимальное число одновременных SSE-стримов |

Все три используют `acquireWithBackoff()` с экспоненциальной задержкой до `timeoutMs` (по умолчанию 600s).

### 4.4 Circuit Breaker

- **Health scoring** на основе `/health-window.ts`
- При последовательных ошибках → circuit breaker открывается
- При открытом CB → немедленный отказ без отправки запроса
- Автоматическое восстановление при улучшении health score

### 4.5 Транспорт (H2 vs H1)

- **H2** (HTTP/2) используется по умолчанию для OpenAI
- Поддерживает мультиплексирование (несколько стримов в одном соединении)
- При ошибках H2 (сетевая, протокольная) → fallback на HTTP/1.1
- Для streaming: `H2.requestStream()` (серверные SSE события)
- Для не-streaming: `H2.request()` или `H1.request()`

### 4.6 Логирование

- **JSONL логи**: `{worktree}/.opencode/data/gateway/` (ротация через `LogRotator`)
- **Per-request diff**: git-format diff между телами последовательных запросов
- **Sensitive headers**: автоматически маскируются (Authorization, token, etc.)
- **Метрики**: timing каждого этапа запроса для адаптивной настройки политик

---

## 5. Обработка ошибок и Retry

### 5.1 Retry Policy (SessionRetry)

`session/retry.ts` — политика повторных попыток при ошибках провайдера:

- Экспоненциальная задержка с jitter
- Максимальное число попыток из `input.retries` (по умолчанию 1)
- Различает retryable и non-retryable ошибки
- Обновляет статус в TUI (`"retry"` с attempt/message/next)

### 5.2 Error Classification (ProviderError)

`provider/error.ts`:

- Парсит ошибки провайдера (JSON + HTML)
- Извлекает лимиты токенов (`context_limit`, `input_tokens`)
- Классифицирует gateway/proxy-blocked ответы (401/403)
- `ContextOverflowError` → триггерит compaction

### 5.3 Token Calibration

При ошибке переполнения контекста:
- Извлечение точных лимитов из сообщения об ошибке
- `TokenCalibration.update()` корректирует оценщик токенов
- Предотвращает повторные переполнения для той же модели

---

## 6. Ключевые файлы и их роли

| Файл | Роль | Строки |
|------|------|--------|
| **session/prompt.ts** | Точка входа, цикл сообщений, сжатие, sidecar checkpoints | 1104 (prompt), 1148 (runLoop) |
| **session/llm.ts** | Сборка запроса, system prompt, вызов streamText | 256-550 (stream) |
| **session/processor.ts** | Обработка стрима, сохранение частей, tool calls, retry | 889 (process), 392 (handleEvent) |
| **session/system-compose.ts** | Сборка и коллапс system prompt | — |
| **session/retry.ts** | Политика повторных попыток | — |
| **session/compaction.ts** | Сжатие контекста, Layer-1/Layer-2 | — |
| **provider/provider.ts** | Разрешение SDK, custom fetch, кэширование | 1396 (resolveSDK) |
| **provider/transform.ts** | Нормализация опций, сообщений, caching | — |
| **provider/gateway/adaptive-client.ts** | HTTP прокси, rate limiting, circuit breaker, H2/H1 | 216 (wrapFetch) |
| **provider/gateway/mod.ts** | Инициализация gateway, глобальный хук | 48-151 |
| **provider/gateway/limiter.ts** | Rate limiting (launch + inflight) | — |
| **provider/gateway/stream-budget.ts** | Бюджет одновременных стримов | — |
| **provider/gateway/circuit-breaker.ts** | Circuit breaker | — |
| **provider/gateway/h2-transport.ts** | HTTP/2 транспорт | — |
| **provider/gateway/h1-transport.ts** | HTTP/1.1 транспорт | — |
| **provider/gateway/classifier.ts** | Классификация запросов по форме | — |
| **provider/gateway/metrics.ts** | Сбор метрик для адаптивной настройки | — |
| **provider/gateway/config-manager.ts** | Загрузка gateway.jsonc | — |
| **provider/error.ts** | Классификация ошибок провайдера | — |
| **plugin/index.ts** | Plugin hooks (chat.params, chat.headers, etc.) | — |
| **plugin/github-copilot/copilot.ts** | Copilot-специфичные настройки | — |

---

## 7. Путь запроса: сводная блок-схема

```
Пользователь
  │
  ▼
[TUI / SDK / CLI / ACP]
  │
  ▼
SessionPrompt.prompt()
  ├─ createUserMessage() → сохранить User msg + parts в SQLite
  └─ loop() → runLoop()
       │
       ├─ (цикл) filterCompactedEffect() → история
       ├─ resolveTools() → набор инструментов
       ├─ assembleSystemMessages() → system prompt
       ├─ SessionProcessor.create(assistantMessage)
       │    │
       │    └─ handle.process(streamInput)
       │         │
       │         └─ LLM.Service.stream(streamInput)   ◄── ЕДИНАЯ ТОЧКА
       │              │
       │              ├─ provider.getLanguage(model) → кэшированный SDK
       │              ├─ assembleSystemMessages() → полный system prompt
       │              ├─ collapseSystemMessages() → KV-cache оптимизация
       │              ├─ plugin hooks → chat.params, chat.headers
       │              │
       │              └─ streamText({ model, system, messages, tools })
       │                   │
       │                   └─ AI SDK language model
       │                        │
       │                        └─ custom fetch (resolveSDK)
       │                             │
       │                             ├─ gwFetch = globalThis.__gatewayFetch
       │                             ├─ AbortSignal.any([user, chunk, timeout])
       │                             │
       │                             └─► GATEWAY PROXY ◄──┐
       │                                  │                │
       │                                  ├─ OAuth passthrough
       │                                  ├─ Classify → RouteKey
       │                                  ├─ Rate Limit (launch→inflight→stream)
       │                                  ├─ Circuit Breaker check
       │                                  ├─ H2 stream / H1 fallback
       │                                  ├─ SSE coalescing
       │                                  └─ Metrics + Logging
       │                                                     │
       │                                  ┌──────────────────┘
       │                                  ▼
       │                        Upstream Provider
       │                        (Anthropic / OpenAI / ...)
       │                                  │
       │                                  ▼ SSE stream
       │                        ┌─────────────────┐
       │                        │ Gateway response │
       │                        │ (H2/H1 → AI SDK) │
       │                        └────────┬────────┘
       │                                 │
       │              ┌──────────────────┘
       │              ▼
       │         streamText events:
       │         start, reasoning-*, text-*, tool-*, finish-step, finish
       │              │
       │              ▼
       │         Processor.handleEvent()
       │         ├─ persist parts (text, reasoning, tool, file, step)
       │         ├─ token/cost accounting → SQLite
       │         ├─ permission gates → tool execution
       │         ├─ snapshot + patch diff
       │         ├─ overflow detection → compact
       │         └─ balance check
       │              │
       │              ▼ результат: "continue" | "stop" | "compact"
       │
       ├─ "continue" → tool results → новый виток runLoop
       ├─ "stop" → publish MessageCompleted, ensureTitle, sidecar
       └─ "compact" → compaction + выход
```

---

## Примечания

1. **Gateway — собственный адаптивный HTTP-прокси**, НЕ внешний. Он оборачивает `globalThis.fetch` и прозрачно перехватывает все LLM-запросы.

2. **Два понятия «прокси»:**
   - **Gateway** (`provider/gateway/`) — внутренний адаптивный прокси (rate limiting, circuit breaker, H2, logging). **Всегда включён** через `GatewayLayer` в `AppLayer`.
   - **baseURL** в конфигурации — переопределение эндпоинта (LiteLLM, корпоративные шлюзы). Настраивается через `${ENV_VAR}` в `provider.options.baseURL`.

3. **Единая точка входа** для всех LLM вызовов — `LLM.Service.stream()`. Через неё проходят: основные ответы, генерация заголовков, sidecar checkpoints, summary, gap-fill.

4. **Middleware цепочка:** `Plugin Hooks` → `ProviderTransform` → `AI SDK streamText` → `custom fetch` → `Gateway` → upstream.

5. **Эффекты (Effect framework):** весь код построен на Effect TS. Асинхронность, обработка ошибок, внедрение зависимостей — через `Effect.gen`, `Layer`, `Context.Service`.

---

## 11. Обнаруженные баги и исправления (2026-08-05)

### 🔴 Bug #1: Мёртвый детектор disguised tool calls

**Файл:** `session/processor.ts:559`

**Проблема:** `ctx.currentText` обнуляется в обработчике `text-end` (строка 778) до того, как `finish-step` проверяет его на наличие disguised tool calls. Условие `&& ctx.currentText` всегда ложно → детектор никогда не срабатывал.

**Исправление:** проверка идёт по `ctx.textBuilder.length >= 10` (StringBuilder аккумулирует все text-delta независимо от состояния `currentText`).

```diff
- if (value.finishReason === "stop" && ctx.currentText) {
-   const text = ctx.textBuilder.toString() || ctx.currentText.text || ""
+ if (value.finishReason === "stop" && ctx.textBuilder.length >= 10) {
+   const text = ctx.textBuilder.toString()
```

### 🟡 Bug #2: DSML-нормализатор не обрабатывал теги с атрибутами

**Файл:** `util/dsml-normalizer.ts`

**Проблема:** Единственный regex покрывал только простые теги `<||DSML||tag>`. Теги с атрибутами (`<||DSML||invoke name="x">`), self-closing (`<||DSML||tag/>`), и multi-tool блоки не обрабатывались.

**Исправление:** Три прохода regex вместо одного:
1. Self-closing: `<||DSML||tagname/>`
2. С атрибутами: `<||DSML||invoke name="x">` 
3. Без атрибутов: `<||DSML||tagname>`

### 🟡 Bug #3: `detectDisguisedToolCalls` игнорировал truncation

**Файл:** `util/dsml-normalizer.ts:76`

**Проблема:** Проверка только на `finish_reason !== "stop"`. При `finish_reason="length"` (truncation) inline tool calls не детектились.

**Исправление:** Добавлена проверка на `"length"`.

---

## 12. Тестовое покрытие DeepSeek-багов

| Файл | Тестов | Что проверяет |
|------|--------|---------------|
| `test/util/dsml-normalizer.test.ts` | **25** (+13 новых) | DSML с атрибутами, self-closing, multi-tool, китайский текст, nested JSON, дедупликация, truncation |
| `test/provider/transform-reasoning.test.ts` | **12** (новый) | reasoning_content roundtrip, empty reasoning injection, DeepSeek invariant, interleaved extraction |
| `test/session/deepseek-defence.test.ts` | **4** (новый) | Интеграционные: disguised detection → error, plain text pass-through, unparseable content, reasoning capture |

**Всего: 44 теста, 91 expect, 0 fail.** Типчек чистый (`tsgo --noEmit` PASS).

---

## 8. Circuit Breaker — глубокое погружение

### 8.1 Архитектура подсистемы

Шесть файлов в `packages/opencode/src/provider/gateway/` образуют **per-route адаптивный движок rate-limiting + fault-isolation**, работающий поверх `fetch`:

```
    ┌──────────────────────────────────────────────────────────────┐
    │          adaptive-client.ts (оркестратор)                     │
    │  wrapFetch() → обёрнутый fetch для каждого SDK-запроса       │
    └───────┬──────────────────────────────────────────────────────┘
            │ per request:
            │  1. Store.getRoute(routeKey) → RouteAdjustment
            │  2. healthScore(adjustment.health) → score
            │  3. Store.isCircuitBreakerOpen(routeKey)? → THROW
            │  4. limiter.acquireWithBackoff(policy...)
            │  5. HTTP-запрос (H2/H1)
            │  6. По результату: запись метрик / ошибок / CB
            ▼
┌──────────────────────────────────────────────────────────────────┐
│                     store.ts (persistent facade)                  │
│  state: AdjustmentStoreData + healthWindows + circuitBreakers     │
│         + retryBudgets, JSON-персистенция gateway-adjustments.json│
└───┬──────────┬───────────────┬───────────────┬────────────────────┘
    │          │               │               │
    ▼          ▼               ▼               ▼
adjustment-  health-window  circuit-        retry-budget
store.ts     .ts            breaker.ts      .ts
(адаптация   (sliding       (state          (retry % бюджет,
политик,     windows,       machine:        не используется)
здоровье)    error decay,   closed/open/
             healthScore)    half-open)
```

### 8.2 `circuit-breaker.ts` — чистая state machine

**Путь:** `packages/opencode/src/provider/gateway/circuit-breaker.ts` (89 строк)

**Типы:**
```ts
type CircuitState = "closed" | "open" | "half-open"

interface CircuitBreaker {
  state: CircuitState
  openedAt: number        // timestamp срабатывания
  failCount: number
  probeCount: number      // разрешённые/использованные пробы
  lastProbeAt: number     // (не используется — всегда 0)
}

// Жёстко зашитые значения (не конфигурируются извне):
DEFAULT_CONFIG = { failThreshold: 5, cooldownMs: 30000, probeLimit: 3 }
```

**Функции (все чистые, иммутабельные):**

| Функция | Поведение |
|---------|-----------|
| `make()` | Исходное состояние: `closed`, все счётчики 0 |
| `shouldAllowRequest(cb)` | `closed` → всегда разрешить. `open` → разрешить **только** после истечения cooldown (30s) **И** `probeCount < 3`. `half-open` → разрешить `probeCount < 3` |
| `recordSuccess(cb)` | `open`/`half-open`: `probeCount++`; при `probeCount ≥ 3` → закрыть, обнулить. `closed`: декремент `failCount` (min 0) |
| `recordFailure(cb)` | `closed`: `failCount++`; при `failCount ≥ 5` → **открыть** (`openedAt=now`, `probeCount=0`). `open`/`half-open`: переоткрыть |
| `getMetrics(cb)` | Снапшот: `{ state, failCount, openedAt }` |

**Особенности:**
- `Store` вызывает без передачи конфига → всегда используется `DEFAULT_CONFIG`
- Асимметрия: `open` + cooldown не истёк → отказ **без расхода пробы**. После истечения — каждая проба либо закрывает (3 успеха), либо переоткрывает (1 провал)
- `lastProbeAt` — мёртвое поле, нигде не пишется

### 8.3 `health-window.ts` — скользящее окно здоровья

**Путь:** `packages/opencode/src/provider/gateway/health-window.ts` (231 строка)

**Константы:**
```ts
WINDOW_SIZE = 100           // ёмкость кольцевых буферов
ERROR_DECAY_INTERVAL_MS = 600000  // 10 минут
ERROR_DECAY_FACTOR = 0.5          // счётчики ошибок уполовиниваются каждые 10 мин
```

**Структуры:**
```ts
class CircularBuffer    // фиксированный кольцевой буфер (push, toArray)
class DelayBuffer       // кольцевой буфер + median() — экспортирован, но НЕ используется

interface HealthWindow {
  latencySamples: CircularBuffer
  ttftSamples: CircularBuffer
  chunkGapSamples: CircularBuffer
  pingSamples: CircularBuffer
  errorCounts: { "429": number; "5xx": number; connReset: number; readTimeout: number }
  lastErrorDecayAt: number
  totalSamples: number
  successSamples: number
}

interface HealthMetrics {  // вычисляемый снапшот → попадает в adjustment.health
  successRate, errorRate, p50LatencyMs, p50TtftMs, p50ChunkGapMs, p50PingMs,
  recent429, recent5xx, recentConnReset, recentReadTimeout, sampleCount
}
```

**`recordError(window, category)` — ключевая логика:**
- При каждом вызове проверяется `ERROR_DECAY_INTERVAL_MS` (10 мин) — если прошло, все 4 счётчика умножаются на 0.5 (округление) и `lastErrorDecayAt` сбрасывается
- Нормализация категорий: `"429"`/`"rate_or_rejection"` → `429`; `"5xx"`/`"server_5xx"` → `5xx`; `"conn_reset"` → connReset; `"read_timeout"` → readTimeout. Остальные (goaway, tls_error, unknown) **не учитываются** в счётчиках, но снижают `successRate`
- `totalSamples++` (success НЕ инкрементируется)

**Формула `healthScore`** (взвешенная оценка 0..1):
```
score = 1.0
      − 0.3 × errorRate              // errorRate = 1 − successRate
      − 0.2 × normalize(recent429+recent5xx, 10)
      − 0.2 × normalize(p50TtftMs, 5000)
      − 0.15 × normalize(p50ChunkGapMs, 500)
      − 0.15 × normalize(p50PingMs, 200)
// normalize(v, max) = min(1, v / max)
```
Доминирующий штраф — **error rate (30%)**, затем 4xx/5xx + TTFT (20%), chunk-gap + ping (15%).

### 8.4 `adjustment-store.ts` — адаптация политик

**Путь:** `packages/opencode/src/provider/gateway/adjustment-store.ts`

**Структура Policy (per-route):**
```ts
interface Policy {
  minLaunchIntervalMs: number       // интервал между запусками (не-stream)
  streamMinLaunchIntervalMs: number
  maxInflight: number               // одновременных в полёте
  maxStreams: number                // одновременных стримов
  cooldownMs: number
  jitterMs: number
}
```

**Стартовые политики провайдеров (PROVIDER_RPM):**

| Провайдер | RPM | minLaunchInterval | maxInflight | maxStreams |
|-----------|-----|-------------------|-------------|------------|
| openai | 500 | 120ms | 50 | 62 |
| anthropic | 50 | 1200ms | 5 | 6 |
| google | 60 | 1000ms | 6 | 7 |
| deepseek | ∞ | 0ms | 500 | 500 (unlimited) |
| groq | 30 | 2000ms | 3 | 3 |
| mistral | 500 | 120ms | 50 | 62 |
| together | 1000 | 60ms | 100 | 100 |
| fireworks | 1000 | 60ms | 100 | 100 |
| xai | 60 | 1000ms | 6 | 7 |
| kat_coder | 60 | 1000ms | 6 | 7 |

**`adaptPolicy` — ядро адаптации:**

**На успех И `score > 0.8` (здоровый):**
- Запись `minLaunchIntervalMs` в историю задержек (cap 100)
- При 20+ записях: если текущий интервал > 1.5× медиана истории → бленд к 1.2× медиана (decay 15%)
- После 50 успехов подряд: сжатие интервалов на 5%
- `score > 0.9` И `recent429 === 0`: `maxInflight + 1` (cap 50)
- `lastSafeDelayMs = policy.minLaunchIntervalMs`

**На провал ИЛИ `score < 0.5` (нездоровый):**
- `minLaunchIntervalMs` и `streamMinLaunchIntervalMs` ×1.5 (cap 600000ms)
- `maxInflight`, `maxStreams` ×0.5 (min 1)
- `cooldownMs` ×2 (cap 60000ms)
- Защита: интервал не превышает `4 × lastSafeDelayMs`
- `delayHistory` очищается, `consecutiveSuccesses = 0`

**Асимметрия:** путь деградации агрессивнее пути восстановления. `cooldownMs` удваивается при ошибках, но никогда не сжимается обратно при успехе.

**Remote stream ceiling:** если `limitsObserved.remoteMaxConcurrentStreams ≠ null`, `maxStreams` capped на 70% от лимита сервера.

### 8.5 `store.ts` — персистентный фасад

**Путь:** `packages/opencode/src/provider/gateway/store.ts` (502 строки)

**Персистентность:** `gateway-adjustments.json` в `Global.Path.data`, атомарная запись (.tmp + rename) каждые 30s при dirty, + при `shutdown()`/`forcePersist()`.

**Внутреннее состояние:**
```ts
interface StoreState {
  data: AdjustmentStoreData           // персистентно: политики + последний health snapshot
  healthWindows: Map<string, HealthWindow>   // только в памяти
  circuitBreakers: Map<string, CircuitBreaker>  // только в памяти
  retryBudgets: Map<string, RetryBudget>      // только в памяти (dead code)
}
```

**Лимиты:** `MAX_ROUTES = 500`, `MAX_HEALTH_WINDOWS = 500`, `MAX_CIRCUIT_BREAKERS = 500`, `STALE_THRESHOLD_MS = 3600000` (1 час).

**Ключевые экспорты:**

| Функция | Действие |
|---------|----------|
| `getRoute(key)` | Get-or-create route с политикой провайдера |
| `recordSuccess(key, latency, ttft?)` | Health window: success + latency + ttft; streaming pref success; лог политик |
| `recordError(key, category, latency?)` | Health window: error (с decay) + latency; streaming pref failure |
| `recordCircuitBreakerFailure(key)` | `CircuitBreaker.recordFailure(cb)` |
| `recordCircuitBreakerSuccess(key)` | `CircuitBreaker.recordSuccess(cb)` |
| `isCircuitBreakerOpen(key)` | `!CircuitBreaker.shouldAllowRequest(cb)` |
| `adaptRoutePolicy(key, success, score)` | `adaptPolicyFn(adj, success, score)` → запись политики |
| `getStreamingEnabled(key)` | Чтение `streamingPreference.enabled` (авто-тюн стриминга) |

**Streaming preference — второй контур обратной связи:**
- 3 последовательных провала на стриминговом роуте → `enabled = false`
- 5 последовательных успехов → `enabled = true`
- При `enabled = false`, `effectiveStream` в `wrapFetch` становится `false` → **другой RouteKey** (stream: false) → отдельный CB, health window, политика

### 8.6 Полный поток данных (ошибка → метрики → здоровье → breaker → политика)

```
 HTTP ошибка / исход
      │
      ▼
 Errors.normalizeError(err) / status-code mapping      ← errors.ts
      │  category ∈ {rate_or_rejection, conn_reset, tls_error, goaway,
      │              refused_stream, read_timeout, server_5xx, ...}
      ▼
 Store.recordError(routeKey, category, latencyMs)      ← store.ts
      │
      ├─► HealthWindow.recordError(window, category)   ← health-window.ts
      │        · error decay (×0.5 каждые 10 мин)
      │        · +1 к 429/5xx/connReset/readTimeout
      │        · totalSamples++  (successRate падает)
      │
      └─► (latency записана) → p50Latency/TTFT
      │
      ▼
 HealthWindow.getMetrics(window) → HealthMetrics       ← health-window.ts
      │   successRate, errorRate, p50s, recent429/5xx/...
      │
      ├─────────────────────────────────────────────────┐
      ▼                                                 ▼
 Store.recordCircuitBreakerFailure(routeKey)     healthScore(metrics)   ← health-window.ts
      │                                           0..1 взвешенная оценка
      ▼                                                 │
 CircuitBreaker.recordFailure(cb)                       ▼
      │  failCount++; ≥5 → state=open,           Store.adaptRoutePolicy(routeKey,
      │  openedAt=now, probeCount=0                    success=false, score)
      │                                                 │
      ▼                                                 ▼
 следующий запрос:                              adjustment-store.adaptPolicy()
 Store.isCircuitBreakerOpen(routeKey)                · intervals ×1.5
      │  open + cooldown не истёк → THROW           · maxInflight/streams ×0.5
      │  open + cooldown истёк → probe (≤3)         · cooldown ×2
      │  probe 3 успеха → closed (сброс)             ▼
      │  probe провал → переоткрытие          policy записана в store.data
      ▼                                            → следующий запрос читает
 (breaker изолирует роут                         более жёсткую политику
  на время восстановления)                        через Store.getRoute()

   УСПЕШНЫЙ ПУТЬ (инверсный):
      recordSuccess (health ↑)
      recordCircuitBreakerSuccess (probe/close)
      adaptRoutePolicy(success=true, score):
         интервалы сжимаются, maxInflight ↑,
         streaming снова включается через 5 успехов
```

### 8.7 Краевые случаи и наблюдения

1. **Breaker — шлюз; health score + policy — дроссель.** Breaker жёстко отклоняет запросы при 5 последовательных ошибках. Health score управляет throttling через `adaptPolicy`, но сам breaker не открывает.
2. **Breaker срабатывает на ВСЕ non-2xx исходы**, включая 4xx client errors и `unknown`. Нет фильтрации не-transient ошибок — устойчивый поток 401/403 поднимет breaker.
3. **При streaming-ошибках** `streamingPreference` отключает streaming после 3 провалов → другой RouteKey → отдельный CB и health window.
4. **Персистентность:** состояние CB, health windows и retry budgets **не сохраняются** между перезапусками — только `data.routes` (политики + последний health snapshot). Открытый перед перезапуском breaker стартует заново.
5. **`score = 0`** на транспортной ошибке в `catch`-блоке форсирует ветку `score < 0.5` в `adaptPolicy`, даже если роут был здоров.
6. **`healthScore` пересчитывается** каждый раз (не кэшируется) — на строке 710 после `recordSuccess`, так что `adaptRoutePolicy` получает актуальный счёт.
7. **Dead/legacy код:** `DelayBuffer`, `lastProbeAt`, и весь API `retry-budget` (`recordRetryRequest`, `recordTotalRequest`, `getRetryBudget`) определены, но не имеют вызовов в кодовой базе.

---

## 9. H2 Транспорт — глубокое погружение

### 9.1 Обзор файлов

| Файл | Роль | Строки |
|------|------|--------|
| `h2-transport.ts` | Ядро H2: пул сессий, мультиплексирование, `request()` / `requestStream()` | 587 |
| `h1-transport.ts` | H1 fallback через нативный `fetch()` | 100 |
| `errors.ts` | Нормализация ошибок → `NormalizedError`, `shouldFallbackToH1()` | 121 |

### 9.2 Управление H2 сессиями (`h2-transport.ts`)

**Состояние модуля:** `sessions = new Map<string, H2Session>()`, `MAX_IDLE_SESSIONS = 10`

**Структура H2Session:**
```ts
interface H2Session {
  session: ClientHttp2Session
  remoteMaxConcurrentStreams: number
  activeStreams: number
  waitQueue: Waiter[]       // FIFO очередь при насыщении
  createdAt: number
  lastUsedAt: number
  pingRttMs: number
}
```

**Ключевые функции:**

| Функция | Поведение |
|---------|-----------|
| `getSessionKey(baseUrl)` | Нормализация: `protocol://hostname:port` — сессии per-origin |
| `getOrCreateSession(baseUrl)` | Переиспользование существующей (bump `lastUsedAt`) или `http2.connect()`. Подписывается на `remoteSettings` (обновление `remoteMaxConcurrentStreams`), `error`/`close`/`goaway` → `closeSessionState` (отклоняет всех waiters). LRU eviction при ≥ 10 сессий. Ошибка подключения → `warn("bug: ...")` + `null` |
| `getOrCreateHealthySession(baseUrl)` | Health-gated: пингует существующую (`session.ping()` с 3s таймаутом), при провале закрывает и создаёт новую |
| `acquireStreamSlot(session)` | Если `activeStreams < remoteMaxConcurrentStreams` → инкремент; иначе push waiter в очередь (асинхронный admission control) |
| `releaseStreamSlot(session)` | Декремент + передача слота следующему waiter'у из очереди |
| `closeSession(baseUrl)` | Используется при H2→H1 fallback |
| `closeAll()` | При shutdown gateway |
| `getMaxRemoteConcurrentStreamsAcrossSessions()` | Максимум среди всех сессий (default 100) |

### 9.3 `request()` vs `requestStream()`

**`request(options) → Promise<H2Response>`** — буферизированный (не-streaming):
- Собирает чанки в `bodyChunks` до `maxBodyBytes = 10MB`
- Возвращает `{ status, headers, body: string, error?: NormalizedError, metrics, requestId }`
- **НИКОГДА не режектится** — при ошибке резолвится с `error: NormalizedError`, чтобы вызывающий код мог проверить категорию и принять решение о fallback

**`requestStream(options) → Promise<{ response: Response, metrics }>`** — streaming:
- Ответ возвращается немедленно при получении заголовков (через `settle()`)
- Данные пробрасываются через `TransformStream` (писатель → читатель)
- Ошибка стрима → `writer.abort()` + reject; сигнал отмены → `request.destroy()`
- Используется для `stream: true` запросов — токены доставляются инкрементально

**Обе функции:**
- Вычищают `x-opencode-*` заголовки перед отправкой
- Заполняют `MetricsSample` (queuedAt, socketAcquiredAt, headersReceivedAt, firstChunkAt, lastChunkAt, chunks, endedAt)

### 9.4 Нормализация ошибок (`errors.ts`)

**Категории (`ErrorCategory`):**
```
rate_or_rejection  conn_reset   tls_error      read_timeout
write_timeout      goaway       refused_stream  server_5xx
client_pool_pressure  context_overflow  auth_error  abort  unknown
```

**`normalizeError(error) → NormalizedError`:**
- `429` или паттерны rate-limit (включая китайские: `频率过高`, `请求过于频繁`, `限流`) → `rate_or_rejection`, retryable
- `ECONNRESET` / `connection reset` / `ECONNREFUSED` / `EPIPE` / `broken pipe` / socket hang → `conn_reset`, retryable
- `TLS`/`SSL`/`CERT`/certificate/handshake → `tls_error`, **не** retryable
- `GOAWAY` → `goaway`, retryable; `REFUSED_STREAM`/`RST_STREAM` → `refused_stream`, retryable
- read timeout / `ETIMEDOUT` → `read_timeout`; write timeout → `write_timeout` (оба retryable)
- 5xx → `server_5xx`; 401/403 → `auth_error` (не retryable); `AbortError` → `abort`
- context overflow / token-limit → `context_overflow` (не retryable)
- default → `unknown`

**`shouldFallbackToH1(error) → boolean`:**
- `true` для: `goaway`, `refused_stream`, `conn_reset`, `unknown`, `client_pool_pressure`
- `true` для `read_timeout`/`write_timeout` только если сообщение содержит session/idle/h2/stream timeout
- `true` для `rate_or_rejection` только если похоже на stream rejection / "too many streams"

### 9.5 H1 Fallback (`h1-transport.ts`)

Тонкая обёртка над нативным `fetch()`:
- Возвращает `{ status, headers: Headers, body: ReadableStream|null, metrics, requestId }`
- Оборачивает response body в `TransformStream` для записи `firstChunkAt`/`lastChunkAt`/`chunks`
- При ошибке нормализует и **бросает** структурированный объект (в отличие от H2, который резолвит с `error`)
- Логирует `warn("bug: h1 request error", ...)`

### 9.6 Интеграция в `adaptive-client.ts`

Полный путь принятия решений о транспорте:

```
wrapFetch():
  │
  ├─ resolveGatewayProtocol(provider, configured)
  │    · "openai" → "h2" (по умолчанию)
  │    · остальные → "http/1.1"
  │
  ├─ useH2 = modelProtocol === "h2"
  │
  ├─ ЕСЛИ useH2:
  │    ├─ streaming → H2.requestStream({baseUrl, url, method, headers, body})
  │    │    └─ успех → response = h2Result.response (WHATWG Response)
  │    │
  │    └─ не-streaming → H2.request({...})
  │         ├─ h2Result.error И shouldFallbackToH1(normalized):
  │         │    · log WARN "gateway.protocol.fallback"
  │         │    · H2.closeSession(baseUrl)  ← убить отравленную сессию
  │         │    · → H1.request({url, method, headers, body, signal})
  │         │    · response = new Response(h1Result.body, ...)
  │         │
  │         ├─ h2Result.error И НЕ fallback:
  │         │    · Store.recordError(routeKey, category, elapsed)
  │         │    · Store.recordCircuitBreakerFailure(routeKey)
  │         │    · throw Error(h2Result.error.message)
  │         │
  │         └─ успех → response = new Response(h2Result.body, ...)
  │
  └─ ИНАЧЕ (H1):
       H1.request({url, method, headers, body, signal})
         ├─ успех → response
         └─ ошибка → throw (уже нормализована)
```

**Health recording после ответа:**
- **Streaming:** данные проходят через `CoalescingTransform` (50ms / 10-chunk батчинг). По завершении стрима — `computeMetrics`, затем `Store.recordSuccess(routeKey, totalMs, ttftMs)` + `recordCircuitBreakerSuccess` + `adaptRoutePolicy(true, score)`
- **Non-streaming:** `success = status 200-299`. Успех → та же тройка. Ошибка → категоризация (`429`/`5xx`/`unknown`) → `recordError` + `recordCircuitBreakerFailure` + `adaptRoutePolicy(false, score)`
- **Транспортная ошибка в catch:** `recordError` + `recordCircuitBreakerFailure` + `adaptRoutePolicy(false, 0)` (score=0 форсирует деградацию)

### 9.7 Connection pooling summary

Одно физическое TCP-соединение (HTTP/2) мультиплексирует до `remoteMaxConcurrentStreams` потоков. При насыщении запросы ставятся в FIFO-очередь. При ошибках H2 сессия закрывается и запросы переходят на H1. Сессии переиспользуются между запросами к одному origin, LRU-вытесняются при ≥ 10 сессий, и проверяются на здоровье (ping) перед использованием.

---

## 10. Plugin System — глубокое погружение

### 10.1 Обзор архитектуры

Плагинная система OpenCode — это **Effect-сервис** (`Plugin.Service`), который регистрирует per-directory наборы хуков (внутренние + внешние плагины) и диспетчеризует их последовательно через `Plugin.trigger(name, input, output)` — мутируя `output` на каждом этапе LLM-пайплайна.

**Файлы:**

| Файл | Роль |
|------|------|
| `plugin/index.ts` (299 строк) | `Plugin.Service` (Effect), реестр хуков, `trigger()`, загрузка плагинов |
| `plugin/loader.ts` (216 строк) | `PluginLoader`: resolve/load внешних плагинов с staged error reporting |
| `plugin/shared.ts` (326 строк) | Разбор спецификаций, entrypoint resolution, compatibility gate |
| `plugin/meta.ts` (188 строк) | Персистентные метаданные плагинов (`plugin-meta.json`) |
| `plugin/install.ts` (439 строк) | `installPlugin`, `readPluginManifest`, `patchPluginConfig` |
| `packages/plugin/src/index.ts` | **Контракт `Hooks`** (plugin SDK) — интерфейс, который реализуют плагины |
| `plugin/github-copilot/copilot.ts` (396 строк) | Copilot proxy shim |
| `plugin/github-copilot/models.ts` (153 строки) | Живой каталог моделей Copilot |
| `plugin/codex.ts` (625 строк) | Codex (OpenAI OAuth) |
| `plugin/gemini.ts` (463 строки) | Gemini (Google OAuth) |
| `plugin/cloudflare.ts` (76 строк) | Cloudflare Workers AI + AI Gateway |
| `plugin/xai.ts` (742 строки) | xAI (Grok) |
| `plugin/azure.ts` (26 строк) | Azure API-key auth |
| `plugin/digitalocean.ts` (393 строки) | DigitalOcean OAuth + Inference Routers |

### 10.2 Контракт `Hooks` (plugin SDK)

```ts
// packages/plugin/src/index.ts:227
interface Hooks {
  // Auth + Catalog (provider injection)
  auth?: { provider: string; loader: (getAuth, provider) => Promise<AuthResult>; methods: AuthMethod[] }
  catalog?: { id: string; transform: (provider, ctx) => Promise<Record<string, Model>> }

  // LLM Pipeline hooks (все следуют паттерну (input, output) => Promise<void>)
  "chat.message"?: (input, output: { message, parts }) => Promise<void>
  "chat.params"?: (input, output: { temperature, topP, topK, maxOutputTokens, options }) => Promise<void>
  "chat.headers"?: (input, output: { headers }) => Promise<void>
  "experimental.chat.system.transform"?: (input, output: { system: string[] }) => Promise<void>
  "experimental.chat.messages.transform"?: (input, output: { messages }) => Promise<void>
  "experimental.text.complete"?: (input, output: { text }) => Promise<void>

  // Tool hooks
  "tool.execute.before"?: (input, output: { args }) => Promise<void>
  "tool.execute.after"?: (input, output: { title, output, metadata }) => Promise<void>
  "tool.definition"?: (input: { toolID }, output: { description, parameters }) => Promise<void>

  // Other
  "shell.env"?: (input, output: { env }) => Promise<void>
  "command.execute.before"?: (input, output: { parts }) => Promise<void>
  "permission.ask"?: (input, output: { status }) => Promise<void>
  "experimental.session.compacting"?: (input, output: { context, prompt? }) => Promise<void>
  "experimental.compaction.autocontinue"?: (input, output: { enabled }) => Promise<void>

  // Lifecycle
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }
}
```

### 10.3 Регистрация и диспетчеризация (`plugin/index.ts`)

**Встроенные плагины** (`INTERNAL_PLUGINS`):
- `CodexAuthPlugin`, `CopilotAuthPlugin`, `GitlabAuthPlugin`, `PoeAuthPlugin`
- `CloudflareWorkersAuthPlugin`, `CloudflareAIGatewayAuthPlugin`
- `AzureAuthPlugin`, `DigitalOceanAuthPlugin`, `XaiAuthPlugin`

**Слой создаёт per-directory состояние** через `InstanceState.make`:
1. Строит `PluginInput` (SDK client → локальный сервер, project, worktree, directory, control-plane adaptors)
2. Загружает каждый внутренний плагин (`plugin(input)`) — ошибки логируются и оборачиваются в `Option`
3. Загружает внешние плагины из `cfg.plugin_origins` (пропускается при `OPENCODE_PURE` флаге) через `PluginLoader.loadExternal()`
4. `applyPlugin()`: предпочитает V1 плагин (`readV1Plugin` → default export с `server()`), иначе legacy module exports
5. После загрузки: вызывает `hook.config?.(cfg)`, подписывается на шину событий (`hook.event?.({event})`), регистрирует `dispose` finalizer

**Диспетчеризация (`trigger`):**
```ts
const trigger = (name, input, output) => {
  for (const hook of hooks) {
    const fn = hook[name]
    if (!fn) continue
    yield* Effect.promise(async () => fn(input, output))
  }
  return output
}
```
Хуки вызываются **последовательно в порядке регистрации** (внутренние → внешние в порядке конфига). Каждый хук может мутировать `output` на месте.

### 10.4 Точки интеграции в LLM-пайплайне

| Хук | Где вызывается | Эффект |
|-----|---------------|--------|
| `chat.message` | `session/prompt.ts:1062` (после resolve частей + UTC timestamp, до сохранения) | Мутация `{ message, parts }` |
| `chat.params` | `session/llm.ts:398` (после сборки system, до `streamText`) | Мутация `{ temperature, topP, topK, maxOutputTokens, options }` |
| `chat.headers` | `session/llm.ts:449` | Мутация `{ headers }` |
| `experimental.chat.system.transform` | `session/llm.ts:339` **и** `agent/agent.ts:508` | Мутация `{ system: string[] }`, затем коллапс |
| `experimental.chat.messages.transform` | `session/prompt.ts:1688` (перед отправкой) | Мутация `{ messages }` |
| `tool.execute.before` | `session/tools.ts:215` (tools), `:262` (MCP tools); `session/prompt.ts:401` (task) | Мутация `{ args }` |
| `tool.execute.after` | `session/tools.ts:230`, `:271`; `session/prompt.ts:480` | Мутация `{ title, output, metadata }` |
| `tool.definition` | `tool/registry.ts:394` | Мутация `{ description, parameters }` |
| `experimental.text.complete` | `session/processor.ts:748` (на `text-end`) | Мутация `{ text }` (итоговый текст ассистента) |
| `shell.env` | `tool/bash.ts:609`, `tool/cmd.ts:390`, `pty/index.ts:210` | Мутация `{ env }` |

**Auth хуки** — `provider/provider.ts:1246-1266`: для каждого плагина с `auth` + запись в хранилище, вызывает `plugin.auth.loader(getAuth, provider)` → возвращает `{ apiKey, fetch, getModel, vars, discoverModels }` — сливается в опции провайдера (source `"custom"`).

**Catalog хуки** — `provider/provider.ts:1313-1338`: для каждого плагина с `catalog.transform`, вызывает `transform(provider, { auth })` и **заменяет `provider.models`** возвращённой картой.

### 10.5 Реализации плагинов

#### 10.5.1 GitHub Copilot (`copilot.ts`)

- **`catalog.transform`**: без OAuth → перезапись `api.url` на `https://api.githubcopilot.com` + `npm: @ai-sdk/github-copilot`. С OAuth → живой каталог моделей (`CopilotModels.get(...)`) с `Authorization: Bearer <refresh>`, fallback на URL rewrite.
- **`auth.loader`**: возвращает `fetch`-обёртку, которая инспектирует тело запроса (completions/responses/messages API), детектит **vision** и **agent vs user**, выставляет `x-initiator` (agent/user), `User-Agent: opencode/<version>`, `Authorization: Bearer <refresh>`, `Openai-Intent: conversation-edits`, `Copilot-Vision-Request: true` для vision.
- **`chat.params`**: для `github-copilot` — дропает `maxOutputTokens` для `gpt*`; для `@ai-sdk/anthropic` — `options.toolStreaming = false`.
- **`chat.headers`**: `anthropic-beta: interleaved-thinking-2025-05-14` для anthropic; `x-initiator: agent` при compaction или subagent (session с `parentID`).

#### 10.5.2 Codex (`codex.ts`)

- Полный OAuth: browser flow (loopback port 1455, PKCE S256, CSRF state) + **headless device flow**
- **`auth.loader`** (provider `"openai"`): фильтрует модели до Codex-разрешённых (gpt-5.x-codex), обнуляет стоимость, твикает контекст gpt-5.5. Возвращает `{ apiKey: OAUTH_DUMMY_KEY, fetch }` с проактивным рефрешем токена, `ChatGPT-Account-Id`, `originator: codex_cli_rs`, `User-Agent: Codex/0.300.0`, перезапись URL на `https://chatgpt.com/backend-api/codex/responses`.
- **`chat.headers`**: `originator: opencode`, UA с платформой/релизом/архитектурой, `session_id`.
- **`chat.params`**: `maxOutputTokens = undefined` (как codex CLI).

#### 10.5.3 Gemini (`gemini.ts`)

- Google OAuth PKCE (port 1456), требует `GOOGLE_OAUTH_CLIENT_ID` env.
- **`auth.loader`** (provider `"google"`): фильтрует до `gemini*` моделей, создаёт модель через `createGeminiProvider({ accessToken })`.
- **`chat.headers`**: `User-Agent: opencode/<version> (<platform> <release>)`.

#### 10.5.4 Cloudflare (`cloudflare.ts`)

- Два плагина: `cloudflare-workers-ai` и `cloudflare-ai-gateway` — чистый API-key auth.
- **`chat.params`** для `cloudflare-ai-gateway` + OpenAI reasoning моделей: дропает `maxOutputTokens` (шлюз идёт через `@ai-sdk/openai-compatible`, который всегда эмитит `max_tokens`, отвергаемый reasoning моделями).

#### 10.5.5 xAI (`xai.ts`)

- OAuth через Grok-CLI `client_id`. Два потока: **browser loopback** (`127.0.0.1:56121`) и **RFC 8628 device flow** (headless/VPS).
- **`auth.loader`**: single-flight proactive refresh (JWT `exp` decode, 120s skew), `Bearer <access>` + UA.

#### 10.5.6 DigitalOcean (`digitalocean.ts`)

- Implicit-token OAuth (loopback), кэширует токен в auth `metadata`.
- **`catalog.transform`**: подтягивает **Inference Routers** (5-min кэш), добавляет `router:<name>` модели через `@ai-sdk/openai-compatible`.

### 10.6 Загрузчик (`loader.ts`) и общая механика

**`PluginLoader.resolve(plan, kind)`** — staged pipeline:
1. **install** — `resolvePluginTarget` → `Npm.add` для npm, path resolution для `file://`/relative
2. **entry detection** — `createPluginEntry`, `./server`/`./tui` exports, `main` fallback
3. **compatibility** — npm плагины должны удовлетворять `engines.opencode` semver; file плагины пропускают
4. **load** — `import(entry)`

**`loadExternal()`** — параллельные кандидаты, **retry file-based плагинов** после `wait()` (для локальных плагинов, зависящих от install-шага). Staged reporting: `start` / `missing` / `error` с этапом `install | entry | compatibility | load`.

**`shared.ts`** — `parsePluginSpecifier` (npm-package-arg alias handling), `pluginSource` (file vs npm), `readV1Plugin` (default export с `server()` или `tui()`), `resolvePluginId`, `readPackageThemes`, `checkPluginCompatibility`.

**`meta.ts`** — `touch`/`touchMany` персистят `plugin-meta.json` под flock: `first_time`, `last_time`, `time_changed`, `load_count`, `fingerprint`.

**`install.ts`** — `installPlugin` (npm install target), `readPluginManifest` (server/tui targets из package exports + `main` + `oc-themes`), `patchPluginConfig` (добавление/замена в `plugin` массиве `.opencode/opencode.json` через jsonc-parser с дедупликацией по package name).
