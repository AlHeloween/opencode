# Planexit Canonical Name Mismatch — Fix

**Date:** 2026-08-03
**Completed:** 2026-08-03T12:35 UTC
**Status:** ✅ DONE

---

## 1. Root Cause

После канонизации имён тулов (убрали `_`, `-`, `.` → только `[a-z0-9]`), бэкенд хранит в `part.tool` каноническое имя: `planexit`, `reasoningenter`, `reasoningexit`.

Но TUI (`session/index.tsx:343-355`) проверяет СТАРЫЕ имена с подчёркиваниями:

```typescript
// session/index.tsx — ТЕКУЩИЙ (сломаный) код
if (part.tool === "plan_exit") {        // ❌ не совпадает с "planexit"
  local.agent.set("build")
} else if (part.tool === "plan_enter") { // ❌ не совпадает с "planenter"
  local.agent.set("plan")
} else if (part.tool === "reasoning_enter") { // ❌ не совпадает с "reasoningenter"
  local.agent.set("reasoning")
} else if (part.tool === "reasoning_exit") {  // ❌ не совпадает с "reasoningexit"
  local.agent.set("build")
}
```

**Следствие:** `local.agent` никогда не обновляется при срабатывании этих тулов. TUI продолжает показывать старый режим. Когда пользователь отправляет следующее сообщение, TUI передаёт `agent: "plan"` (из `local.agent.current()`), и бэкенд создаёт user message с plan-агентом, возвращая сессию в plan mode.

### Связанные файлы

| Файл | Проблема |
|------|----------|
| `packages/opencode/src/tool/plan.ts:22,73` | tool id=`"planexit"`, policy=`"plan_exit"` |
| `packages/opencode/src/tool/reasoning.ts:23,57` | tool id=`"reasoningenter"`, policy=`"reasoning_enter"` |
| `packages/opencode/src/tool/reasoning.ts` (exit) | tool id=`"reasoningexit"`, policy=`"reasoning_exit"` |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:343-355` | **Баг:** проверяет policy-имена вместо canonical |

---

## 2. Fix

### 2.1 TUI: использовать canonical имена

**Файл:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

```diff
-    if (part.tool === "plan_exit") {
+    if (part.tool === "planexit") {
       local.agent.set("build")
       lastSwitch = part.id
-    } else if (part.tool === "plan_enter") {
+    } else if (part.tool === "planenter") {
       local.agent.set("plan")
       lastSwitch = part.id
-    } else if (part.tool === "reasoning_enter") {
+    } else if (part.tool === "reasoningenter") {
       local.agent.set("reasoning")
       lastSwitch = part.id
-    } else if (part.tool === "reasoning_exit") {
+    } else if (part.tool === "reasoningexit") {
       local.agent.set("build")
       lastSwitch = part.id
     }
```

**Риск:** `plan_enter` — не нашёл реализации тула `planenter` в регистре. Возможно, `plan_enter` приходит через другой механизм. Нужно проверить, существует ли tool `planenter` и как он попадает в `part.tool`.

### 2.2 Бэкенд (профилактика): `getLastModel` first-match → last-match

**Файл:** `packages/opencode/src/tool/plan.ts:12-16`

```typescript
function getLastModel(sessionID: SessionID) {
  for (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model  // ❌ first match
  }
  return undefined
}
```

Функция называется `getLastModel`, но возвращает ПЕРВОЕ совпадение (если стрим oldest-first). Нужно возвращать ПОСЛЕДНЕЕ.

**Проверить:** направление `MessageV2.stream`. Если newest-first — бага нет.

### 2.3 Бэкенд (профилактика): `planexit` user message без parts

**Файл:** `packages/opencode/src/tool/plan.ts:55-63`

User message создаётся без текстовых частей. `insertReminders` потом добавляет synthetic part с mode instruction. Это рабочий паттерн, но стоит убедиться что нет краевых случаев (фильтрация пустых сообщений и т.п.).

---

## 3. Почему это объясняет симптом

1. Пользователь в plan mode
2. LLM вызывает `planexit` → вопрос "Switch to build?" → пользователь жмёт "Yes"
3. `planexit` создаёт user message с `agent: "build"` в БД
4. Бэкенд-loop подхватывает, создаёт build-assistant, инжектит build mode prompt
5. LLM (build agent) генерирует ответ: "Готов к реализации!"
6. **TUI:** событие `message.part.updated` для planexit тула → проверка `part.tool === "plan_exit"` — **MISMATCH** → `local.agent` остаётся `"plan"`
7. Пользователь видит ответ build-agent (но TUI показывает plan mode)
8. Пользователь отправляет следующий запрос → TUI передаёт `agent: "plan"` (из `local.agent`)
9. Бэкенд создаёт plan user message → loop переключается обратно на plan agent
10. **Итог:** агент "не может выйти" из plan mode

---

## 4. Smoke Tests

### 4.1 TUI canonical names (ручная проверка)

1. Запустить TUI, войти в plan mode
2. Вызвать `planexit`, подтвердить "Yes"
3. **Проверить:** TUI переключил агента на "build" (индикатор режима)
4. Отправить сообщение — должно уйти с `agent: "build"`
5. Повторить для `reasoningenter` / `reasoningexit`

### 4.2 Unit-тест

Добавить в `session/index.test.tsx` (если существует) или `mode-transition.test.ts`:

```typescript
test("TUI detects planexit/planenter/reasoningenter/reasoningexit with canonical names", () => {
  const cases = [
    { tool: "planexit", expectedAgent: "build" },
    { tool: "planenter", expectedAgent: "plan" },
    { tool: "reasoningenter", expectedAgent: "reasoning" },
    { tool: "reasoningexit", expectedAgent: "build" },
  ]
  for (const { tool, expectedAgent } of cases) {
    // simulate part.tool and verify local.agent.set(expectedAgent) is called
  }
})
```

### 4.3 `getLastModel` (если баг подтверждён)

```typescript
test("getLastModel returns the LAST model, not first", () => {
  // session with 2 user messages: model-A then model-B
  // expect getLastModel(sessionID) === model-B
})
```

### 4.4 Регресс: planexit + отправка сообщения

1. Plan mode → planexit → Yes → дождаться build-ответа
2. Отправить "создай файл test.txt"
3. **Проверить:** файл создан (build agent имеет write-доступ)
4. **Проверить:** агент остаётся в build mode

---

## 5. Prior Art

- GitHub PR #23971 — `plan_exit` model carry bug (упомянут в `plans_completed/2026-07-31-svm-anchor-planning-bugs.md:28`)
- Канонизация имён тулов: `canonicalName()` в `tool.ts:83` убирает все `[^a-z0-9]`
