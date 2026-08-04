# Orchestrator AGI Mode — From Talker to Driver

**Date:** 2026-08-03
**Status:** 🔴 OPEN

---

## 1. Диагноз

Оркестратор без AGI — «говорилка с фишками»:
- Читает планы ✅
- Делегирует explore ✅
- Диспатчит coder ❌
- Исполняет сам ❌
- Трекает задачи ❌
- Верифицирует ❌

AGI mode = оркестратор ведёт полный цикл автономно. Без этого он не оркестратор, а советник.

---

## 2. Что такое AGI mode

```
ОРКЕСТРАТОР (primary, одна сессия, полный цикл)

  ┌── PLAN   ── читает plans/, проектирует, пишет задачи
  │            (сегодня: отдельный plan agent → planexit → build)
  │
  ├── RESEARCH ── task(explore) для разведки перед каждым шагом
  │
  ├── EXECUTE ── task(coder) для реализации
  │              (сегодня: build agent в main session)
  │
  ├── VERIFY  ── getPlanStatus(), smoke oracles, transition [ ]→[x]
  │
  └── REPEAT или TERMINAL ── residual_recluster vs Goal SV
```

**Ключевое отличие от plan/build цикла:** нет ручных переключений. Оркестратор сам решает когда планировать, когда исполнять, когда завершать.

---

## 3. Что сломано / отсутствует

### 3.1 ❌ `subagents: ["explore"]` — не может диспатчить coder

```typescript
// agent.ts:253
subagents: ["explore"],
```

**Нужно:** `["explore", "coder", "general"]` или хотя бы `["explore", "coder"]`

### 3.2 ❌ `reasoning_enter`/`reasoning_exit` — permission denied

Оркестратор — единственный с `requireNativeOrchestrator`, но defaults блокируют.

**Фикс:** добавить `reasoning_enter: "allow"`, `reasoning_exit: "allow"` в конфиг оркестратора.

### 3.3 ❌ Task store — kernel spec есть, реализации нет

`run_task_geometry()` → k-medoids → CENTRAL_TASKS — это в Python-спеке, не в TypeScript.

**Реальность:** оркестратор трекает задачи через `[ ]`/`[x]` чекбоксы в `.md` планах + `getPlanStatus()`.

**Решение на сейчас:** разрешить `todowrite` для оркестратора как projection-интерфейс к task store. Когда kernel task store будет реализован — переключиться.

### 3.4 ❌ `planenter` нет, `planexit` denied

Оркестратор не может переключать режимы. Но в AGI mode это и не нужно — он всегда primary, фазы внутри него.

**Решение:** не добавлять planenter. Оркестратор работает в одном режиме, фазы — логические, не агент-сменные.

### 3.5 ⚠️ Нет AGI loop в TypeScript

Kernel (`14_plan_cluster.py`, `24_specs_policies.py`) описывает ADID цикл: GOAL_SVM_PREP → ... → STATE_EVAL. Но это Python-спека, не исполняемый код.

**Нужно:** цикл в `prompt.ts` или отдельный `agi-loop.ts`, который:
1. Определяет активную фазу (plan/execute/verify)
2. Диспатчит правильных sub-agents
3. Проверяет `getPlanStatus()`
4. Принимает решение continue/terminal

---

## 4. Минимальный viable AGI (план реализации)

### Шаг 1: Разрешить оркестратору работать

| # | Изменение | Файл | 
|---|-----------|------|
| 1 | `subagents: ["explore", "coder"]` | `agent.ts:253` |
| 2 | `reasoning_enter: "allow"`, `reasoning_exit: "allow"` | `agent.ts:218-248` |
| 3 | `todowrite: "allow"` (временно, пока нет kernel store) | `agent.ts:218-248` |
| 4 | Убрать `plan_enter`/`plan_exit` deny из дефолтов оркестратора (не нужны) | `agent.ts:107-108` → override |

### Шаг 2: Базовый AGI loop

В `prompt.ts` (или новом `agi-loop.ts`):

```
while (true) {
  status = getPlanStatus()
  if (isPlanHygieneClean(status)) → TERMINAL
  
  task = selectNextMedoid(status.active)
  
  // Phase: RESEARCH
  if (task.needsResearch)
    dispatch(task("explore", { prompt: researchPrompt(task) }))
  
  // Phase: PLAN
  if (task.needsPlanning)
    editPlan(task)
  
  // Phase: EXECUTE  
  dispatch(task("coder", { prompt: implementPrompt(task) }))
  
  // Phase: VERIFY
  runSmokeOracles(task)
  transitionTask(task, done)
}
```

### Шаг 3: Интеграция с сессией

Оркестратор — это просто `default_agent: "orchestrator"` в конфиге. Пользователь открывает сессию, пишет «реализуй X», и оркестратор ведёт.

---

## 5. Smoke Tests

### 5.1 Оркестратор диспатчит coder

1. `default_agent: "orchestrator"`
2. Отправить: «создай plans/test.md с планом из одного шага: добавить комментарий в README»
3. **Проверить:** оркестратор диспатчит `task(coder, ...)`, coder редактирует README
4. **Проверить:** оркестратор верифицирует и двигает план в `plans_completed/`

### 5.2 Оркестратор входит в reasoning

1. Оркестратор сталкивается с проблемой
2. Вызывает `reasoningenter` → должно сработать (не permission denied)
3. Анализирует → `reasoningexit` → продолжает

### 5.3 Полный цикл

1. Пользователь: «почини баг X»
2. Оркестратор исследует → пишет план → диспатчит coder → верифицирует → terminal
3. Всё без ручных переключений режимов
