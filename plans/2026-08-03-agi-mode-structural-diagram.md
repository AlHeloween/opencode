# AGI Mode — Структурная диаграмма (расширенная)

**Дата:** 2026-08-03
**Статус:** 📐 ПЛАН (диаграмма для анализа/документации)
**Связан с:** `plans/2026-08-03-orchestrator-agi-mode.md`

---

## 0. Текущее состояние plans/ (моментальный снимок)

```
plans/  (13 записей)
├── 2026-07-22_epistemic_guardrails.md          [ ] открыт → ACTIVE
├── 2026-07-25_remove_external_skills_kernel.md  [ ] открыт → ACTIVE
├── 2026-08-03-agi-mode-structural-diagram.md    [x] всё → MISPLACED (должен быть в completed/)
├── 2026-08-03-orchestrator-agi-mode.md          [ ] открыт → ACTIVE
├── 2026-08-03-orchestrator-plan-analysis.md     [x] всё → MISPLACED
├── README.md                                     [ ] открыт → ACTIVE (но это README, не план!)
├── memory after compaction report.md            ? → ?
├── pre-existing-stuff.md                        ? → ?
├── shell-output-parsing-bug.md                  [x] всё → MISPLACED
├── shell-output-reliability.md                   [ ] открыт → ACTIVE
├── state before compaction rev3.md              ? → ?
├── summary-system-audit.md                      ? → ?
└── abstract_futures/                            ★ SUBDIR: НЕ ДОЛЖЕН СЧИТАТЬСЯ!
    ├── 20260625_http_api_v2_plan.md              [ ] → но это "futures" (никогда)
    └── zig-0.16-migration.md                     [ ] → но это "futures" (никогда)

plans_completed/ (238 записей)
├── emergency/                                    ★ SUBDIR: та же проблема
└── vcs-master-plan/                              ★ SUBDIR: та же проблема

ПРОБЛЕМА: collectPlans() рекурсивно заходит в поддиректории.
abstract_futures/ — это явно "то, чего делать никогда не надо".
README.md — не план.
Решение: фильтровать только прямые .md файлы в plans/, исключая поддиректории.
```

---

## 1. Общая архитектура (Data Flow) — расширено

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        AGI MODE ARCHITECTURE v2                           │
│                                                                          │
│  ┌──────────────────────────────┐          ┌───────────────────────────┐ │
│  │     ORCHESTRATOR             │  XML     │      WORKER (main)        │ │
│  │                              │─────────►│                           │ │
│  │  agent: orchestrator         │directives│  agent: build             │ │
│  │  session: orch_* (hidden)    │◄─────────│  session: main (visible)  │ │
│  │  native: true                │ results  │  native: true             │ │
│  │  mode: primary               │          │  mode: primary            │ │
│  │                              │          │                           │ │
│  │  PERMISSIONS (детально §5):  │          │  PERMISSIONS:             │ │
│  │   ✓ task: allow              │          │   ✓ все инструменты       │ │
│  │   ✓ edit: plans/*,           │          │   ✓ bash/cmd/ps/run       │ │
│  │          plans_completed/*,  │          │   ✗ destructive: deny     │ │
│  │          memory/*_orch.md    │          │   ✗ plan_enter/exit: deny │ │
│  │   ✓ write:同上               │          │   ✗ reasoning_*: deny     │ │
│  │   ✓ read/glob/grep/list      │          │                           │ │
│  │   ✓ messagesearch/sessionread│          │                           │ │
│  │   ✓ universalsearch/webfetch │          │                           │ │
│  │   ✗ bash/cmd/ps/run: deny   │          │                           │ │
│  │   ✗ plan_enter/exit: deny   │          │                           │ │
│  │   ✗ reasoning_*: deny ⚠️    │          │                           │ │
│  │   ✗ todowrite: deny ⚠️      │          │                           │ │
│  │   subagents: ["explore"] ⚠️  │          │                           │ │
│  └──────────┬───────────────────┘          └───────────┬───────────────┘ │
│             │                                          │                 │
│             │          ┌─────────────────┐             │                 │
│             ├─────────►│  PLAN HYGIENE   │◄────────────┘                 │
│             │          │  ENGINE         │                               │
│             │          │                 │                               │
│             │          │ getPlanStatus() │  классификация .md файлов     │
│             │          │   └─ plans/*.md (flat, НЕ рекурсивно!)          │
│             │          │   └─ plans_completed/*.md (flat)                │
│             │          │                                                │
│             │          │ classify:                                      │
│             │          │   active    = plans/X.md с [ ] (открыт)        │
│             │          │   completed = completed/X.md без [ ]           │
│             │          │   misplaced = plans/X.md без [ ] (долг)        │
│             │          │             + completed/X.md с [ ] (рано)      │
│             │          │                                                │
│             │          │ reconcilePlans()                                │
│             │          │   └─ механическое перемещение между папками    │
│             │          │                                                │
│             │          │ isPlanHygieneClean()                            │
│             │          │   ⇔ active=0 && misplaced=0                    │
│             │          │   (completed>0 — ок, терминал)                 │
│             │          │                                                │
│             │          │ BUG: collectPlans() рекурсивно заходит         │
│             │          │ в abstract_futures/, emergency/,               │
│             │          │ vcs-master-plan/ — лечит перемещением!         │
│             │          │ Нужно: flat-перечисление *.md в корне.         │
│             └──────────┬──────────────────┘                             │
│                        │                                                 │
│            ┌───────────┴───────────┐                                    │
│            ▼                       ▼                                    │
│      plans/                plans_completed/                             │
│      (только *.md            (только *.md                               │
│       в корне,               в корне,                                   │
│       НЕ в поддиректориях)   НЕ в поддиректориях)                       │
│                                                                          │
│  PERSISTENCE:                                                            │
│    {worktree}/.opencode/data/state/agi-state.json                        │
│      ├── orchSessionID : string                                          │
│      ├── mainSessionID : string                                          │
│      ├── evolvingMode   : boolean                                        │
│      ├── cycleCount     : number                                         │
│      └── turnCount      : number                                         │
│                                                                          │
│    {worktree}/.opencode/data/memory/{orchID}_orchestrator.md             │
│      └── Память оркестратора между сессиями                              │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Конечный автомат (State Machine) — углублённый

### 2.1 Диаграмма с guard-условиями

```
                        ┌──────────┐
                        │BOOTSTRAP │ ◄── activate / resume
                        └────┬─────┘
                             │ guard: orchBusy() → true
                             │ action: seed lastDispatchedOrchMsgID
                             ▼
                   ┌─────────────────┐
          ┌───────►│   ORCH_BUSY     │◄────────────────────────────┐
          │        └────────┬────────┘                             │
          │                 │ guard: orchBusy() → false             │
          │                 │   AND новый completed assistant msg   │
          │                 │   (lastDispatchedOrchMsgID ≠ latest)  │
          │                 │                                      │
          │                 │ action: runPlanHygiene()              │
          │                 │                                      │
          │          ┌──────┴──────┐                               │
          │          │             │                               │
          │          ▼             ▼                               │
          │   ┌──────────┐  ┌─────────────┐                       │
          │   │ TERMINAL │  │ORCH_DISPATCH│                       │
          │   │(hygiene  │  └──────┬──────┘                       │
          │   │ clean)   │         │                               │
          │   └────┬─────┘         │ action:                       │
          │        │               │ 1. parseOrchestratorDirectives│
          │   ┌────┴────┐          │ 2. inject hygiene debt (если) │
          │   │         │          │ 3. append workerFooter        │
          │   ▼         ▼          │ 4. safety: MAX_TURNS/MAX_TIME │
          │ ┌─────┐ ┌──────┐       │ 5. sendToWorker(каждому)      │
          │ │STOP│ │EVOLVE│        ▼                              │
          │ └─────┘ │(cycle)│  ┌─────────────────┐                 │
          │         └──┬───┘  │  WORKERS_BUSY   │                 │
          │            │      └────────┬────────┘                 │
          │            │               │ guard: все workers        │
          │            │               │   idle или error          │
          │            │               │   (нет статуса ≠ idle!)  │
          │            │               ▼                           │
          │            │      ┌─────────────────┐                 │
          │            │      │WORKERS_COLLECT  │─────────────────┘
          │            │      └────────┬────────┘  action:
          │            │               │            1. collectWorkerMessages
          │            │               │            2. runPlanHygiene()
          │            │               │            3. sendToOrchestrator(ctx)
          │            │               │            4. clear dispatch state
          │            ◄───────────────┘
          │            (evolving: новый цикл)
          │
          └── (если evolving — возврат в ORCH_BUSY с evolving prompt)
```

### 2.2 Детальные guard-условия каждой фазы

```typescript
// Псевдокод guard-условий (из agi-mode.tsx:412-671)

switch (phase()) {

  case "BOOTSTRAP":
    // GUARD: orchBusy() → true (сессия оркестратора в статусе "busy")
    // ACTION: зафиксировать lastDispatchedOrchMsgID
    // NEXT:   ORCH_BUSY
    if (ob) {
      lastDispatchedOrchMsgID = lastCompletedAssistantMsg.id
      setPhase("ORCH_BUSY")
    }
    break

  case "ORCH_BUSY":
    // GUARD: orchBusy() → false (оркестратор idle)
    //   AND новый completed assistant msg появился
    //   (level-triggered: проверка lastDispatchedOrchMsgID ≠ latest)
    if (ob) break  // ещё busy — ждём

    const lastCompleted = msgs.findLast(...)
    if (!lastCompleted || lastCompleted.id === lastDispatchedOrchMsgID)
      break  // нет нового — ждём

    lastDispatchedOrchMsgID = lastCompleted.id

    // ACTION: runPlanHygiene()
    const hygiene = runPlanHygiene()

    // ── TERMINAL CHECK ──
    if (isPlanHygieneClean(hygiene.status)) {
      if (evolvingMode()) {
        // → создать improvement/cycle-N ветку, отправить evolving prompt
        // → setPhase("ORCH_BUSY") — ждать ответа orch
        // → return
      } else {
        // → deactivate() (успех)
        // → return
      }
    }

    // ── ORCH "complete" но hygiene debt ──
    if (/\b(session complete|terminating|deactivate agi)\b/i.test(orchOutput)
        && !isPlanHygieneClean(status)) {
      // ИГНОРИРУЕМ "complete" — впереди hygiene debt
      console.debug("orch said complete but hygiene debt remains")
    }

    // ── PARSE DIRECTIVES ──
    const directives = parseOrchestratorDirectives(orchOutput)

    // ── HYGIENE DEBT INJECTION ──
    if (status.misplaced.length > 0 || hygiene.reopenedToActive.length > 0) {
      const hasHygieneFocus = /plan hygiene|plans_completed|misplaced/i.test(orchOutput)
      if (!hasHygieneFocus) {
        directives.length = 0  // ВСЕ директивы заменяются!
        directives.push({ workerId: mainSessionID, message: HYGIENE_DEBT_MSG })
      }
    }

    // ── EMPTY OUTPUT RECOVERY ──
    if (directives.length === 0) {
      if (orchOutput.trim()) {
        // Само-закрывающийся тег? Пропускаем.
        // Иначе — fallback: весь вывод как директива
        directives.push({ workerId: mainSessionID, message: orchOutput + footer })
      } else {
        // Оркестратор выдал пустой ответ → continuation prompt
        sendToOrchestrator("CRITICAL: Your previous response was empty...")
        setPhase("ORCH_BUSY")
        return
      }
    }

    // ── WORKER FOOTER ──
    for (const d of directives) {
      if (!d.message.includes("PLAN HYGIENE"))
        d.message += planHygieneWorkerFooter()
    }

    // ── SAFETY CHECKS ──
    if (turnCount() + 1 > MAX_TURNS) { deactivate(); return }
    if (Date.now() - activationStartedAt > MAX_RUNTIME_MS) { deactivate(); return }

    // ── DISPATCH ──
    setTurnCount(turnCount() + 1)
    for (const d of directives) sendToWorker(d.workerId, d.message)
    setPhase("WORKERS_BUSY")
    break

  case "WORKERS_BUSY":
    // GUARD: activeWorkers.every(wid =>
    //   session_status[wid]?.type === "idle" || "error"
    // )
    // ВАЖНО: отсутствие status ≠ idle! Сессия может ещё стартовать.
    if (allIdle) setPhase("WORKERS_COLLECT")
    break

  case "WORKERS_COLLECT":
    // ACTION:
    //   1. collectWorkerMessages(wid, dispatchTime[wid])
    //   2. runPlanHygiene()
    //   3. sendToOrchestrator(context) — контекст + результаты + статус
    //   4. clear dispatchTime, activeWorkers
    // NEXT: ORCH_BUSY
    setPhase("ORCH_BUSY")
    break
}
```

### 2.3 Edge Cases & Recovery

| Ситуация | Поведение | Код |
|----------|-----------|-----|
| **Оркестратор выдал пустой ответ** | continuation prompt: «CRITICAL: Your previous response was empty. IGNORE Instruction Format. Wrap in `<worker1_id>...</worker1_id>`» | `agi-mode.tsx:541-555` |
| **Оркестратор сказал «complete» но есть hygiene debt** | Игнорируем «complete», продолжаем цикл (hygiene injection сработает) | `agi-mode.tsx:493-503` |
| **Нет XML-тегов, но есть текст** | Весь вывод оркестратора → как одна директива main-воркеру | `agi-mode.tsx:534-539` |
| **Само-закрывающийся тег `<worker1_id/>`** | Пропускаем (log debug) | `agi-mode.tsx:532-533` |
| **Misplaced файлы + orch не фокусируется на гигиене** | ВСЕ директивы заменяются на PLAN HYGIENE DEBT task | `agi-mode.tsx:508-528` |
| **MAX_TURNS=100 достигнут** | deactivate(silent=false) с toast | `agi-mode.tsx:573-578` |
| **MAX_RUNTIME=24h достигнут** | deactivate с toast (часы) | `agi-mode.tsx:580-586` |
| **session.error event** | deactivate(true) + toast с ошибкой (кроме ContextOverflowError) | `agi-mode.tsx:752-761` |
| **sendToWorker HTTP error** | toast warning, не блокирует цикл | `agi-mode.tsx:598-602` |
| **Worker session не существует** | console.debug, возврат false | `agi-mode.tsx:353-355` |
| **Возобновление после рестарта TUI** | resume prompt: «Resuming. Plan progress: … Continue from where you left off.» | `agi-mode.tsx:801-823` |
| **Все worker-ы idle но нет нового orch-сообщения** | level-triggered guard: lastDispatchedOrchMsgID не даст повторно обработать | `agi-mode.tsx:443` |
| **Несколько useAgiMode() call sites** | Shared module-level signals: фаза, workers, dispatchTime — только первый реагирует | `agi-mode.tsx:209-217` |

---

## 3. Определение выполненности планов (Completion Detection)

### 3.1 Алгоритм `getPlanStatus()`

```
ВХОД: worktree (путь к проекту)

ШАГ 1: Собрать все .md файлы
  allActive    = collectPlans(worktree/plans/)           ← ⚠️ РЕКУРСИВНО!
  allCompleted = collectPlans(worktree/plans_completed/)  ← ⚠️ РЕКУРСИВНО!

ШАГ 2: Классифицировать по наличию [ ] (regex: /^\s*- \[ \]/m)
  active    = files in plans/           with    [ ]  → открытые задачи
  completed = files in plans_completed/ without [ ]  → завершённые
  misplaced = files in plans/           without [ ]  → ДОЛГ (пора в completed/)
            + files in plans_completed/ with    [ ]  → ДОЛГ (перенесли рано)

ШАГ 3: Подсчёт статистики
  totalPlans    = allActive.length + allCompleted.length
  totalTasks    = Σ countTasks(файл).total
  completedTasks = Σ countTasks(файл).done
  completion%   = completed.length / totalPlans * 100

countTasks(файл):
  pending = match(/^\s*- \[ \]/gm)    ← [ ]  (открыто)
  done    = match(/^\s*- \[[x~]\]/gm) ← [x] или [~] (закрыто)
  return { total: pending + done, done }

ВЫХОД: PlanStatus { active, completed, misplaced, totalPlans, totalTasks, completedTasks, completion }
```

### 3.2 Ключевое правило выполненности

> **План выполнен ⇔ в файле НЕТ строк `- [ ]`**
> `[x]` и `[~]` считаются выполненными.
> Выполненность определяется **исключительно** наличием/отсутствием открытых чекбоксов.
> **Содержательная проверка (smoke oracles) — зона ответственности модели, не движка.**

### 3.3 Проблема: рекурсивный `collectPlans()`

```
ТЕКУЩЕЕ ПОВЕДЕНИЕ (BUG):
  collectPlans("plans/")
    → plans/2026-07-22_epistemic_guardrails.md     ← OK
    → plans/README.md                                ← НЕ план!
    → plans/abstract_futures/20260625_http_api.md    ← НЕ план! (futures)
    → plans/abstract_futures/zig-0.16-migration.md   ← НЕ план! (futures)

  collectPlans("plans_completed/")
    → plans_completed/emergency/...                  ← не должно считаться
    → plans_completed/vcs-master-plan/...            ← не должно считаться

  ПОСЛЕДСТВИЯ:
    1. abstract_futures/* — если там нет [ ], reconcilePlans переместит
       их в plans_completed/ («завершённые» планы, которые никогда не делались)
    2. README.md — если там [ ], считается активным планом
    3. Искажает статистику (totalPlans, completion%)

НУЖНО:
  collectPlans() должна брать ТОЛЬКО .md файлы в корне папки,
  НЕ заходя в поддиректории.

  ИСКЛЮЧЕНИЕ: plans_completed/ может иметь поддиректории
  для организации (emergency/, vcs-master-plan/). Но их содержимое
  не должно учитываться в getPlanStatus().
```

### 3.4 Сравнение: Plan Hygiene Engine vs Todo System

```
┌─────────────────────────────────────────────────────────────────┐
│            ДВА СЛОЯ ТРЕКИНГА ЗАДАЧ                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PLAN HYGIENE (plan-status.ts)           TODO (todowrite)       │
│  ─────────────────────────────           ────────────────       │
│  Уровень: ПРОЕКТ (файлы .md)             Уровень: СЕССИЯ (in-memory)│
│  Персистентность: Файловая система       Персистентность: Session DB │
│  Формат: markdown checkboxes             Формат: JSON Array     │
│  «План»: .md файл                        «Задача»: todo item    │
│  Статусы: [ ]/[x]/[~] (в тексте)        Статусы: pending/      │
│                                                   in_progress/  │
│                                                   completed/    │
│                                                   cancelled     │
│  Перемещение: reconcilePlans()           Перемещение: нет       │
│    (механическое, по чекбоксам)          (внутри сессии)        │
│                                                                 │
│  СВЯЗЬ:                                                         │
│  ┌───────────────────────────────────────────────────────┐     │
│  │ AGI Mode использует plan hygiene как terminal gate.   │     │
│  │ Todo (todowrite) — пока DENIED для оркестратора.      │     │
│  │                                                       │     │
│  │ ADID kernel (prompts_kernel) предполагает:             │     │
│  │   task store (k-medoids) → CENTRAL_TASKS → todowrite  │     │
│  │   Пока нет TypeScript-реализации.                     │     │
│  │                                                       │     │
│  │ План: todowrite как projection-интерфейс               │     │
│  │       к будущему task store (см. секцию 7).           │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                 │
│  ADID Workflow (из todowrite.txt):                              │
│    GOAL_SVM_PREP → SVM_INGESTION → PRE_FLIGHT                   │
│    → EXECUTION → VERIFICATION → STATE_EVAL                      │
│                                                                 │
│  vs AGI Loop (текущий):                                         │
│    BOOTSTRAP → ORCH_BUSY → ORCH_DISPATCH                        │
│    → WORKERS_BUSY → WORKERS_COLLECT → ...                       │
│                                                                 │
│  РАЗРЫВ: ADID предполагает k-medoids кластеризацию задач,       │
│  AGI loop — линейный цикл с одним worker'ом.                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Диспатч-протокол (Dispatch Protocol) — детально

### 4.1 Формат XML-директив

```
ОРКЕСТРАТОР → ВОРКЕР:
  <worker1_{sessionID}>
  ## Task: Add dark mode toggle
  **Plan**: plans/dark-mode.md
  **Files**: src/components/ThemeToggle.tsx, src/theme.css
  ...
  </worker1_{sessionID}>

  <worker2_{otherSessionID}>
  ## Task: Update tests
  ...
  </worker2_{otherSessionID}>

ПРАВИЛА:
  • Открывающий и закрывающий теги — на отдельных строках
  • ID воркера = sessionID (реальный, не хардкод)
  • Между тегами — полная инструкция (Markdown)
  • Можно несколько воркеров в одном ответе
  • Если тегов нет → весь ответ считается директивой main-воркеру
  • Само-закрывающийся тег <worker1_id/> — пропускается (нет контента)
```

### 4.2 Парсинг: `parseOrchestratorDirectives()`

```typescript
// agi-mode.tsx:337-348
function parseOrchestratorDirectives(text: string): WorkerDirective[] {
  const regex = /<worker\d+_([a-zA-Z0-9_-]+)>([\s\S]*?)<\/worker\d+_\1>/g
  //            ─────────┬─────────  ───┬───  ───────┬───────
  //                     │              │             └─ backref: тот же ID
  //                     │              └─ content (lazy)
  //                     └─ capture worker ID

  // Возвращает: [{ workerId: "abc123...", message: "## Task: ..." }, ...]
}
```

### 4.3 Полный flow диспатча

```
ORCH_BUSY → orch idle → новый completed msg
  │
  ├─ 1. lastAssistantText(orchSessionID)
  │     └─ last completed assistant msg → last text part → slice(0, 4000)
  │
  ├─ 2. parseOrchestratorDirectives(orchOutput)
  │     └─ regex /<worker\d+_([a-zA-Z0-9_-]+)>([\s\S]*?)<\/worker\d+_\1>/g
  │
  ├─ 3. Hygiene injection (если misplaced > 0)
  │     └─ directives = [{ workerId: mainID, message: PLAN_HYGIENE_DEBT }]
  │
  ├─ 4. Worker footer append
  │     └─ каждая директива += planHygieneWorkerFooter()
  │
  ├─ 5. Safety checks
  │     └─ turnCount > 100? runtime > 24h? → deactivate
  │
  ├─ 6. Dispatch
  │     └─ for each directive:
  │         sendToWorker(workerId, message)
  │           └─ sdk.client.session.promptAsync({
  │                 sessionID, messageID: ascending(),
  │                 parts: [{ type: "text", text: message }]
  │              })
  │
  └─ 7. setPhase("WORKERS_BUSY")
       └─ activeWorkers = [directive.workerId, ...]
       └─ dispatchTime = { [workerId]: Date.now() }

WORKERS_BUSY → все idle
  │
  ├─ 1. collectWorkerMessages(wid, sinceTimestamp)
  │     └─ все completed assistant msgs после since → join text → slice(0, 4000)
  │
  ├─ 2. runPlanHygiene()
  │
  └─ 3. sendToOrchestrator(context)
        └─ context = Turn {N} complete. Plan hygiene: {status}.
           Worker results: <data_from_worker_{wid}>{output}</data_from_worker_{wid}>
           Analyze the results. What was accomplished?
           FORMAT OVERRIDE: wrap ENTIRE response in XML tags.
```

### 4.4 Sub-agent dispatch (task tool)

```
Оркестратор вызывает task("explore", { prompt: "..." })

task.ts:
  ├─ 1. Permission check: caller.subagents includes "explore"?
  │     └─ agent.ts:253 → subagents: ["explore"] → OK
  │
  ├─ 2. Permission check: explore agent has "task" allow?
  │     └─ Permission.evaluate("task", "*", explore.permission)
  │
  ├─ 3. Permission check: explore agent has "todowrite" allow?
  │     └─ Если нет → deny todowrite в дочерней сессии
  │
  ├─ 4. Создание дочерней сессии
  │     └─ session.create({ parentID, title, permission })
  │
  └─ 5. prompt → runLoop → result

ОГРАНИЧЕНИЕ: subagents: ["explore"] — оркестратор НЕ может
  вызвать task("coder", ...) или task("general", ...).
  При попытке → Error: 'Agent "orchestrator" cannot delegate to "coder".
  Allowed: explore'
```

---

## 5. Полная матрица разрешений (Permissions Matrix)

### 5.1 Default permissions (все агенты)

```
agent.ts:91-110 — Permission.fromConfig({
  "*":                  "allow",
  "ai-call":            "deny",
  doom_loop:            "ask",

  // Constitution buckets:
  "destructive-file":   "deny",
  "destructive-db":     "deny",
  "destructive-git":    "deny",
  "destructive-fossil": "deny",
  destructive:          "deny",   // legacy catch-all

  external_directory:   { "*": "ask", ...whitelistedDirs: "allow" },
  question:             "deny",
  plan_enter:           "deny",   // ← оркестратору тоже deny
  plan_exit:            "deny",   // ← оркестратору тоже deny
  reasoning_enter:      "deny",   // ← оркестратору тоже deny!
  reasoning_exit:       "deny",   // ← оркестратору тоже deny!
})
```

### 5.2 Orchestrator permissions

| Permission | Rule | Пути |
|------------|------|------|
| `edit` | `"*": "deny"` | Кроме: `plans/*`, `plans_completed/*`, `.opencode/data/memory/*_orchestrator.md` |
| `write` | `"*": "deny"` | Кроме: `plans/*`, `plans_completed/*`, `.opencode/data/memory/*_orchestrator.md` |
| `bash` | **deny** | — |
| `cmd` | **deny** | — |
| `powershell` | **deny** | — |
| `run` | **deny** | — |
| `task` | **allow** | `*` (но subagents: ["explore"]) |
| `todowrite` | **не указан** → наследует default `"*": "allow"`? Нет! Явно не указан → **deny** (не в списке allow) |
| `read` | **allow** | `*` |
| `glob` | **allow** | `*` |
| `grep` | **allow** | `*` |
| `list` | **allow** | `*` |
| `messagesearch` | **allow** | `*` |
| `session-read` | **allow** | `*` |
| `universalsearch` | **allow** | `*` |
| `webfetch` | **allow** | `*` |
| `plan_enter` | **deny** (default) | — |
| `plan_exit` | **deny** (default) | — |
| `reasoning_enter` | **deny** (default) ⚠️ | — |
| `reasoning_exit` | **deny** (default) ⚠️ | — |
| `subagents` | `["explore"]` | — |

### 5.3 Worker (build) permissions

| Permission | Rule |
|------------|------|
| `*` | **allow** (default) |
| `destructive` | **deny** (default) |
| `bash`, `cmd`, `powershell`, `run` | **allow** (через `"*"`) |
| `plan_enter`, `plan_exit` | **deny** |
| `reasoning_enter`, `reasoning_exit` | **deny** |
| `subagents` | не ограничены |

### 5.4 Mode transitions: кто может

| Transition | Инструмент | Guard | Сейчас для orch |
|------------|-----------|-------|-----------------|
| `→ reasoning` | `reasoningenter` | `requireNativeOrchestrator()` + `reasoning_enter: allow` | ❌ deny |
| `reasoning →` | `reasoningexit` | `requireNativeOrchestrator()` + `reasoning_exit: allow` | ❌ deny |
| `→ plan` | `planenter` | (не в коде — plan.ts только planexit) | ❌ deny |
| `plan → build` | `planexit` | user confirmation через question.ask() | ❌ deny |
| `AGI toggle` | клавиша `<leader>o` | TUI level, не tool | ✅ (не зависит от permissions) |

### 5.5 Блокировки и их причины

```
ПРОБЛЕМА 1: reasoning_enter/exit denied для оркестратора
  ├── agent.ts:109-110 → defaults deny reasoning_enter, reasoning_exit
  ├── agent.ts:218-248 → orchestrator permissions НЕ переопределяют
  │   (нет строк reasoning_enter: "allow")
  └── ФИКС: добавить reasoning_enter: "allow", reasoning_exit: "allow"
            в Permission.fromConfig оркестратора

ПРОБЛЕМА 2: coder sub-agent denied
  ├── agent.ts:253 → subagents: ["explore"]
  └── ФИКС: subagents: ["explore", "coder"]

ПРОБЛЕМА 3: todowrite denied
  ├── agent.ts:218-248 → нет todowrite в списке allow
  └── ФИКС: добавить todowrite: "allow"

ПРОБЛЕМА 4: plan_enter/exit denied
  └── Это КОРРЕКТНО: оркестратор всегда primary,
      фазы логические, не агент-сменные. НЕ надо фиксить.
```

---

## 6. Evolving Mode — детально

### 6.1 Полный workflow

```
┌──────────────────────────────────────────────────────────────┐
│                    EVOLVING MODE WORKFLOW                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  АКТИВАЦИЯ (пользователь):                                    │
│    agi.setEvolvingMode(true)  — через TUI или конфиг         │
│    → persists evolvingMode: true в agi-state.json            │
│                                                              │
│  ЦИКЛ (автоматически после каждого clean состояния):          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. isPlanHygieneClean() → true                       │   │
│  │ 2. evolvingMode() → true                             │   │
│  │ 3. cycleCount++ (persist)                            │   │
│  │ 4. createImprovementBranch(cycleNum)                  │   │
│  │    └─ git checkout -b improvement/cycle-{N}          │   │
│  │ 5. sendToOrchestrator(EVOLVING_PROMPT)               │   │
│  │    └─ «All plans standardized. EVOLVING MODE:         │   │
│  │        Cycle N. Analyze: Stability, Performance,      │   │
│  │        Observability, Testing, UX. Propose 2-4        │   │
│  │        tasks per category. WAIT for user acceptance.  │   │
│  │        Do NOT auto-execute.»                          │   │
│  │ 6. Оркестратор создаёт plans/ с новыми задачами       │   │
│  │ 7. Пользователь принимает/отклоняет                   │   │
│  │ 8. Цикл продолжается → execute → verify → clean      │   │
│  │ 9. mergeImprovementBranch(branchName)                │   │
│  │    └─ git checkout main && git merge branch --no-ff  │   │
│  │ 10. → п.1 (новый цикл)                               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ДЕАКТИВАЦИЯ:                                                │
│    agi.setEvolvingMode(false)                                │
│    → после clean: deactivate() (успех), не новый цикл        │
│                                                              │
│  GIT BRANCHES:                                               │
│    main ←── improvement/cycle-1 (merged)                     │
│         ←── improvement/cycle-2 (merged)                     │
│         ←── improvement/cycle-3 (active)                     │
│                                                              │
│  MERGE STRATEGY:                                             │
│    └─ detect main branch (origin/HEAD → main → master)      │
│    └─ git merge {branch} --no-ff -m "merge {branch}"         │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Git auto-init

```
ensureGitInit(worktree):
  ├─ .git существует? → return true
  ├─ git init
  ├─ Создать .gitignore (если нет):
  │   node_modules/  .opencode/data/  .temp/  dist/  build/  *.log  .env
  └─ git add -A && git commit -m "initial commit (auto-init by AGI mode)" --allow-empty
```

---

## 7. ADID Kernel Gap — полный анализ

### 7.1 Что есть в Python spec (`prompts_kernel/14_plan_cluster.py`)

| Функция | Строки | Назначение | TS-эквивалент |
|---------|--------|------------|---------------|
| `ClusterResult` dataclass | 16-22 | centroid, members, cluster_size | ❌ нет |
| `MedoidModifications` dataclass | 26-32 | original, modifications, centroid | ❌ нет |
| `cosine_similarity(a, b)` | 34-45 | Косинусное сходство векторов | ❌ нет |
| `k_medoids_modifications(points, k)` | 98-230 | K-medoids кластеризация с модификациями | ❌ нет |
| `select_fractal_model(task_count)` | 236-252 | Выбор фрактальной модели (Sierpinski/Quad-Oct-tree/L-System) | ❌ нет |
| `select_medoids_tasks(clusters, goal_sv)` | 254-306 | Выбор центральных задач через cosine-filter к Goal SV | ❌ нет |
| `adaptive_k(task_count)` | 308-330 | Адаптивный k ≈ ceil(N/2) | ❌ нет |
| `run_task_geometry(goal, tasks)` | 1178-1275 | Полный пайплайн: ground→seeds→fractal→filter→residual_recluster | ❌ нет |
| `execute_medoid(task, ctx)` | 1277-1295 | Исполнение медоида | ❌ нет |
| `verify_oracles(task)` | 1297-1308 | Проверка oracles (PASS/FAIL) | ❌ нет |

### 7.2 Что есть в TypeScript сейчас

| Компонент | Файл | Функция |
|-----------|------|---------|
| Plan status | `plan-status.ts` | `getPlanStatus()`, `reconcilePlans()`, `isPlanHygieneClean()` |
| AGI loop | `agi-mode.tsx` | `useAgiMode()` — линейный цикл, не fractal |
| Todo write | `todo.ts` | `todowrite` — per-session task list, не k-medoids |
| Agent dispatch | `task.ts` | `task()` — sub-agent spawn, не medoid execution |

### 7.3 Конкретный GAP: что нужно портировать

```typescript
// Будущий agi-loop.ts (не существует)

interface TaskVector {
  goal_alignment: number    // cosine similarity к Goal SV
  dependencies: string[]    // блокирующие задачи
  estimated_effort: number  // часы/сложность
  epistemic_weight: number  // Exact > Inferred > Hypothetical > Guess
}

function selectFractalModel(taskCount: number): FractalModel {
  // Sierpinski: задачи делятся на 3 подзадачи
  // Quad-Oct-tree: 4 или 8 подзадач
  // L-System F→F+F-F: рекурсивное branching
}

function kMedoidsModifications(tasks: Task[], k: number): Cluster[] {
  // 1. Инициализировать k медоидов (случайно или из seeds)
  // 2. Назначить каждую задачу ближайшему медоиду
  // 3. Для каждого кластера: найти точку с мин. суммой расстояний → новый медоид
  // 4. Повторять пока медоиды стабильны
}

function selectMedoidsTasks(clusters: Cluster[], goalSV: number[]): Task[] {
  // cosine_filter: отбросить кластеры с cos_sim < порога
  // вернуть медоиды оставшихся кластеров как CENTRAL_TASKS
}

function runTaskGeometry(goal: string, allTasks: Task[]): CentralTasks {
  // GROUND → SEEDS → FRACTAL_OVERGEN → COSINE_FILTER → K_MEDOIDS → CENTRAL_TASKS
}

// Интеграция с AGI loop:
// while (!isPlanHygieneClean()) {
//   const central = runTaskGeometry(goal, getPlanStatus().active)
//   for (const medoid of central) {
//     if (medoid.needsResearch) task("explore", ...)
//     if (medoid.needsImplementation) task("coder", ...)
//   }
//   verify_oracles(medoid)
// }
```

### 7.4 Промежуточное решение (план)

```
Сейчас:                              План (шаг 1):                       Будущее:
┌──────────────────┐                ┌──────────────────┐                ┌──────────────────┐
│ [ ]/[x] чекбоксы │                │ todowrite как    │                │ k-medoids        │
│ в .md файлах     │                │ projection       │                │ task store       │
│                  │                │ интерфейс        │                │ (TypeScript)     │
│ getPlanStatus()  │                │                  │                │                  │
│ reconcilePlans() │                │ Оркестратор      │                │ run_task_        │
│                  │                │ пишет задачи     │                │ geometry()       │
│ НЕТ task store   │                │ через todowrite  │                │                  │
│ НЕТ k-medoids    │                │ вместо .md       │                │ Полный ADID      │
│ НЕТ fractal      │                │ чекбоксов        │                │ цикл             │
└──────────────────┘                └──────────────────┘                └──────────────────┘
```

---

## 8. Полная карта файлов (расширенная)

```
packages/opencode/src/
├── cli/cmd/tui/
│   ├── context/
│   │   └── agi-mode.tsx (906 lines)  ★ ЯДРО: state machine, dispatch, signals
│   │       ├── L1-19     Архитектурный комментарий
│   │       ├── L42-70    AgiState, loadAgiState, saveAgiState
│   │       ├── L76-158   Git: ensureGitInit, createImprovementBranch, mergeImprovementBranch
│   │       ├── L160-168  Safety: MAX_OUTPUT_CHARS, MAX_TURNS, MAX_RUNTIME_MS
│   │       ├── L173-217  Module-level shared signals
│   │       ├── L220-226  LoopPhase type (5 фаз)
│   │       ├── L228-231  WorkerDirective interface
│   │       ├── L233-290  useAgiMode hook setup, signals, helpers
│   │       ├── L292-305  orchBusy / mainBusy memos
│   │       ├── L309-348  lastAssistantText, collectWorkerMessages, parseOrchestratorDirectives
│   │       ├── L352-395  sendToWorker, sendToOrchestrator
│   │       ├── L412-671  ★ createEffect state-machine loop
│   │       ├── L674-687  deactivate
│   │       ├── L694-834  toggleAgiMode (activate/resume)
│   │       └── L837-906  orchStats, compactOrchestrator, estimateCost, getAgiStatus
│   │
│   ├── app.tsx                        — "agi.toggle" command, useAgiMode() call
│   ├── routes/session/
│   │   └── index.tsx                  — AGI badge, auto-composite, orch routing
│   └── feature-plugins/sidebar/
│       └── context.tsx                — orch/main sessions в cache stats
│
├── agent/
│   ├── agent.ts (260 lines)
│   │   ├── L30-53    Info Schema (subagents field at L50-52)
│   │   ├── L91-110   defaults permissions (*=allow, plan_*=deny, reasoning_*=deny)
│   │   ├── L107-108  plan_enter: deny, plan_exit: deny
│   │   ├── L109-110  reasoning_enter: deny, reasoning_exit: deny
│   │   ├── L211-254  orchestrator agent definition
│   │   │   ├── L223-227  edit: plans/*, plans_completed/*, memory/*_orch.md
│   │   │   ├── L229-234  write: same
│   │   │   ├── L235-238  bash/cmd/ps/run: deny
│   │   │   ├── L239      task: allow
│   │   │   ├── L240-247  read/glob/grep/list/messagesearch/session-read/universalsearch/webfetch: allow
│   │   │   ├── L250      mode: primary
│   │   │   ├── L251      native: true
│   │   │   └── L253      subagents: ["explore"]
│   │   └── L255-259  general agent definition
│   └── prompt/
│       └── orchestrator.txt (14 lines) — prompt-заглушка (CONTRACT + PACK)
│
├── util/
│   └── plan-status.ts (265 lines)    ★ ПЛАН-ГИГИЕНА
│       ├── L21-29   PlanStatus interface
│       ├── L31-38   ReconcileResult interface
│       ├── L41-48   hasOpenItems(filePath): regex /^\s*- \[ \]/m
│       ├── L52-61   countTasks(filePath): counts [ ] + [x] + [~]
│       ├── L64-81   collectPlans(dir): РЕКУРСИВНЫЙ сбор .md ⚠️
│       ├── L84-132  getPlanStatus(worktree): классификация
│       ├── L135-137 isPlanHygieneClean(status): active=0 && misplaced=0
│       ├── L139-154 movePlanFile, uniqueDest: вспомогательные
│       ├── L160-213 reconcilePlans(worktree): механическое перемещение
│       ├── L217-229 planHygieneWorkerFooter(): напоминалка для воркеров
│       ├── L232-255 formatPlanHygiene(status, reconcile?): одна строка для orch
│       └── L258-265 formatProgressBar(status): ASCII progress bar
│
├── tool/
│   ├── reasoning.ts (91 lines)
│   │   ├── L15-18   requireNativeOrchestrator(ctx)
│   │   ├── L23-57   ReasoningEnterTool: switch agent → "reasoning"
│   │   └── L59-91   ReasoningExitTool:  switch agent → "build"
│   ├── plan.ts (74 lines)
│   │   └── L21-73   PlanExitTool: question.ask → switch agent → "build"
│   ├── todo.ts (57 lines)
│   │   └── TodoWriteTool: per-session task list (pending/in_progress/completed/cancelled)
│   ├── task.ts (201 lines)
│   │   ├── L108-120 Parameters: subagent_type, prompt, task_id, run_in_background
│   │   ├── L154-160 subagent delegation check: caller.subagents.includes(type)
│   │   └── L162-164 todowrite permission for child session
│   ├── todowrite.txt (196 lines)     — ADID workflow instructions
│   └── registry.ts                   — L373-376 enter/exit tools = orchestrator-facing
│
├── config/
│   ├── agent.ts                      — загрузка кастомных режимов из {mode,modes}/*.md
│   └── keybinds.ts                   — agi_toggle = <leader>o
│
├── session/
│   ├── schema.ts                     — MessageID, SessionID типы
│   └── todo.ts                       — Todo.Service (per-session task CRUD)
│
└── permission/
    └── (Permission.evaluate, Permission.merge, Permission.fromConfig)

prompts_kernel/
├── 14_plan_cluster.py (1308 lines)   ★ ADID KERNEL: k-medoids, fractal pipeline
│   ├── L16-22   ClusterResult dataclass
│   ├── L26-32   MedoidModifications dataclass
│   ├── L34-45   cosine_similarity(a, b)
│   ├── L98-230  k_medoids_modifications(points, k, ...)
│   ├── L236-252 select_fractal_model(task_count)
│   ├── L254-306 select_medoids_tasks(clusters, goal_sv)
│   ├── L308-330 adaptive_k(task_count)
│   ├── L1178-1275 run_task_geometry(goal, tasks)
│   ├── L1277-1295 execute_medoid(task, ctx)
│   └── L1297-1308 verify_oracles(task)
├── 20_specs_agents.py                — ORCHESTRATOR spec: v6 kernel-managed
├── 24_specs_policies.py              — PLANNING policy: "fractal_only"
├── 27_runtime_dict.py                — FRACTAL_CANDIDATES, GOAL_PEAKS, DECOMPOSE
└── 28_runtime_render.py              — ALGORITHM_CARD из run_task_geometry

docs/
├── agi-workflow.md                   ★ Основная документация AGI mode
└── adid_15_4_3/
    └── fragments/06_agi_kernel_fractal.txt — §15 AGI Kernel детали

plans/
├── 2026-08-03-orchestrator-agi-mode.md       — план развития (блокировки)
├── 2026-08-03-orchestrator-plan-analysis.md  — анализ оркестратора
└── 2026-08-03-agi-mode-structural-diagram.md ← этот документ
```

---

## 9. Builder-as-Architect — Goal SVM после Compaction

### 9.1 Проблема: Worker теряет фокус

```
ТЕКУЩАЯ МОДЕЛЬ (проблемная):

  ORCHESTRATOR                     WORKER (main session, build agent)
  ┌──────────┐                     ┌─────────────────────────────────┐
  │ plan,    │  XML directive      │                                 │
  │ delegate,│────────────────────►│  Читает директиву               │
  │ verify   │                     │  Исследует (explore)            │
  │          │                     │  Редактирует файлы (edit/write) │
  │          │                     │  Запускает тесты (bash)         │
  │          │                     │  Коммитит (git)                 │
  │          │                     │  ...вся имплементация в сессии  │
  │          │                     │                                 │
  │          │◄────────────────────│  Результаты                     │
  └──────────┘                     └─────────────────────────────────┘

  ПОСЛЕ COMPACTION (контекст сжат):
  ┌──────────────────────────────────────────────────┐
  │ Compaction summary: "User asked for X.            │
  │  I read file A, edited B, ran test C, fixed D..." │
  │                                                   │
  │  ■ Goal SVM: РАЗМЫТ ← implementation details      │
  │    перемешались с архитектурным видением           │
  │                                                   │
  │  ■ Builder начинает «терять мысль»:               │
  │    - Забывает ПОЧЕМУ мы это делаем                │
  │    - Помнит только ЧТО сделали                    │
  │    - Следующий шаг — микро-оптимизация,            │
  │      а не движение к Goal                         │
  └──────────────────────────────────────────────────┘
```

### 9.2 Решение: Builder = Архитектор + Диспетчер Coder'ов

```
ЦЕЛЕВАЯ МОДЕЛЬ (трёхуровневая):

  ORCHESTRATOR              BUILDER/ARCHITECT            CODER SUB-AGENTS
  (hidden session)          (main session, visible)       (child sessions, ephemeral)
  ┌──────────────┐          ┌─────────────────────┐      ┌──────────────────┐
  │              │  XML     │                     │      │                  │
  │  plan        │─────────►│  Принимает директиву │      │                  │
  │  delegate    │          │                     │      │                  │
  │  verify      │          │  Сохраняет Goal SVM  │      │                  │
  │              │          │  (архитектурное      │      │                  │
  │              │          │   видение)           │      │                  │
  │              │          │                     │      │                  │
  │              │          │  Анализирует:        │      │                  │
  │              │          │  "Что нужно сделать  │      │                  │
  │              │          │   для достижения     │      │                  │
  │              │          │   Goal?"             │      │                  │
  │              │          │                     │      │                  │
  │              │          │  Декомпозирует:      │      │                  │
  │              │          │  → research задача   │      │                  │
  │              │          │  → implementation    │      │                  │
  │              │          │    задача            │      │                  │
  │              │          │                     │      │                  │
  │              │          │  Диспатчит:          │      │                  │
  │              │          │  ────────────────────┼─────►│  task("explore") │
  │              │          │                     │      │  (read-only)     │
  │              │          │                     │      └──────┬───────────┘
  │              │          │                     │             │ результат
  │              │          │                     │◄────────────┘
  │              │          │                     │
  │              │          │  ────────────────────┼─────►│  task("coder")   │
  │              │          │                     │      │  (edit, write,    │
  │              │          │                     │      │   bash, test)     │
  │              │          │                     │      └──────┬───────────┘
  │              │          │                     │             │ результат
  │              │          │                     │◄────────────┘
  │              │          │                     │
  │              │          │  Верифицирует:       │      │                  │
  │              │          │  "Goal достигнут?"   │      │                  │
  │              │          │  "Smoke oracles      │      │                  │
  │              │          │   PASS?"             │      │                  │
  │              │          │                     │      │                  │
  │◄─────────────┼──────────│  Результаты +        │      │                  │
  │              │          │  Goal SVM status     │      │                  │
  └──────────────┘          └─────────────────────┘      └──────────────────┘

  ПОСЛЕ COMPACTION (контекст builder'а сжат):
  ┌──────────────────────────────────────────────────┐
  │ Compaction summary: "Goal: реализовать X.         │
  │  Делегировал research → explore.                  │
  │  Делегировал implementation → coder.              │
  │  Coder: отредактировал A, B, C.                   │
  │  Smoke oracles: PASS.                             │
  │  Goal SVM: СОХРАНЁН."                             │
  │                                                   │
  │  ■ Goal SVM: УСИЛЕН ← implementation details     │
  │    вынесены в coder-сессии, архитектор помнит     │
  │    только архитектурные решения и результаты      │
  │                                                   │
  │  ■ Builder НЕ теряет фокус:                       │
  │    - Помнит ПОЧЕМУ (Goal)                         │
  │    - Помнит ЧТО делегировал                       │
  │    - Детали реализации — в дочерних сессиях       │
  │    - Каждый новый turn: свежий взгляд на Goal     │
  └──────────────────────────────────────────────────┘
```

### 9.3 Механика: почему Goal SVM усиливается после compaction

```
ДО COMPACTION (сырой контекст):
┌────────────────────────────────────────────────────────────┐
│ Context window:                                            │
│                                                            │
│  [Goal SVM] ████████░░░░░░░░░░░░  (40% окна)              │
│  "Реализовать тёмную тему с уважением к системным          │
│   настройкам, плавным переходом, и accessibility"          │
│                                                            │
│  [Implementation noise] ░░░░░░░░████████████████  (60%)   │
│  "Прочитал ThemeContext.tsx строки 45-89...                │
│   Добавил CSS custom properties в :root...                 │
│   --color-bg: #1a1a2e; --color-surface: #16213e...        │
│   Изменил usePrefersColorScheme() → добавил 'auto'...     │
│   Тест theme.test.ts: ожидал 'dark' получил 'light'...    │
│   Пофиксил: забыл fallback в media query..."              │
│                                                            │
│  РЕЗУЛЬТАТ COMPACTION:                                     │
│  "Реализовал тёмную тему, были проблемы с тестами,         │
│   пофиксил media query fallback"                           │
│                                                            │
│  Goal SVM: ░░░░░░ (размыт, потерян среди деталей)         │
└────────────────────────────────────────────────────────────┘

ПОСЛЕ ДЕЛЕГИРОВАНИЯ (coder вне сессии):
┌────────────────────────────────────────────────────────────┐
│ Context window (builder):                                  │
│                                                            │
│  [Goal SVM] ████████████████████  (80% окна)              │
│  "Реализовать тёмную тему с уважением к системным          │
│   настройкам, плавным переходом, и accessibility.          │
│   Декомпозиция:                                            │
│   1. ThemeContext: auto/dark/light + CSS custom props     │
│   2. Transition system: CSS transition + 200ms easing     │
│   3. Accessibility: prefers-reduced-motion, contrast      │
│   Статус: п.1 → coder, п.2 → pending, п.3 → pending"     │
│                                                            │
│  [Delegation log] ████░░░░░░░░░░░░  (20%)                 │
│  "task(coder, 'ThemeContext + CSS props'): COMPLETED       │
│   Результат: +45/-12 строк, smoke PASS"                   │
│                                                            │
│  РЕЗУЛЬТАТ COMPACTION:                                     │
│  "Goal: тёмная тема (auto/dark/light, плавный переход,     │
│   a11y). Выполнено: ThemeContext+CSS. Осталось: transition │
│   system, accessibility. Smoke: PASS."                     │
│                                                            │
│  Goal SVM: ██████████████ (УСИЛЕН — архитектурная суть    │
│  сохранилась, implementation details ушли в coder-сессии)  │
└────────────────────────────────────────────────────────────┘
```

### 9.4 Что нужно изменить в коде

```
СЕЙЧАС (agi-mode.tsx + agent.ts):

  1. Worker = main session, agent = build
     └─ build agent делает ВСЁ сам: read → edit → bash → test

  2. Build agent permissions:
     └─ task: (через "*": allow) — МОЖЕТ диспатчить
     └─ subagents: не ограничены
     └─ НО: prompt build agent'а не инструктирует его
        быть архитектором-диспетчером

  3. AGI loop: sendToWorker(mainSessionID, message)
     └─ вся директива → build agent → он всё делает сам

НУЖНО:

  1. Build agent → Architect agent (новый prompt)
     └─ Роль: "Ты архитектор. Твоя задача — хранить Goal SVM,
        декомпозировать задачи, диспатчить coder-под-агентов,
        верифицировать результаты. НЕ реализовывать самому."
     └─ Prompt инструктирует:
        • Прочитай директиву оркестратора
        • Сформулируй Goal SVM (архитектурное видение)
        • Декомпозируй на шаги
        • Для КАЖДОГО шага имплементации → task("coder", ...)
        • Сам только: read, glob, grep, list (read-only)
        • После каждого coder'а: верифицируй smoke oracles
        • Докладывай оркестратору: Goal SVM status, что сделано

  2. Architect permissions:
     └─ edit/write: DENY (только coder'ы редактируют)
     └─ bash/cmd/run: DENY (только coder'ы запускают)
     └─ task: allow, subagents: ["explore", "coder", "general"]
     └─ read/glob/grep/list: allow (для анализа)

  3. AGI loop (без изменений):
     └─ sendToWorker(mainSessionID, directive)
     └─ Архитектор получает директиву → диспатчит coder'ов
     └─ Возвращает результаты оркестратору

  4. Преимущества:
     └─ Compaction: Goal SVM сохраняется, implementation noise уходит
     └─ Parallelism: архитектор может диспатчить нескольких coder'ов
     └─ Чистота: каждая coder-сессия = одна задача, не зашумлена
     └─ Откат: coder-сессию можно пересоздать (нет побочных эффектов)
```

### 9.5 Сравнение: Build (сейчас) vs Architect (нужно)

| Аспект | Build Agent (сейчас) | Architect Agent (нужно) |
|--------|---------------------|------------------------|
| **Роль** | Исполнитель: читает, редактирует, тестирует | Архитектор: хранит Goal SVM, декомпозирует, диспатчит |
| **Редактирование** | Сам edit/write | Только через task("coder") |
| **Запуск команд** | Сам bash/cmd/run | Только через task("coder") |
| **Sub-agents** | Не использует (всё сам) | explore (research), coder (impl), general (design) |
| **Контекст** | Зашумлён реализацией | Чистый: Goal SVM + delegation log |
| **После compaction** | Goal размыт | Goal усилен |
| **Параллелизм** | Последовательный | Параллельные coder'ы |
| **Откат** | Сложно (всё в одной сессии) | Легко (пересоздать coder-сессию) |

### 9.6 Файлы для изменения

```
packages/opencode/src/agent/agent.ts:
  └─ Новый agent: "architect" (или переопределить "build")
     ├── mode: "primary"
     ├── native: true
     ├── permission:
     │   ├── edit: deny
     │   ├── write: deny
     │   ├── bash/cmd/ps/run: deny
     │   ├── task: allow
     │   ├── read/glob/grep/list: allow
     │   └── subagents: ["explore", "coder", "general"]
     └── prompt: PROMPT_ARCHITECT

packages/opencode/src/agent/prompt/architect.txt:
  └── Новый prompt: "Ты архитектор. Храни Goal SVM. Делегируй coder'ам."

packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx:
  └── sendToWorker(mainSessionID, message) — без изменений
      (worker использует architect agent через agent: "architect")

packages/opencode/src/util/plan-status.ts:
  └── collectPlans(): flat вместо recursive (баг из §3.3)
```

---

## 10. Сводная таблица: Production vs Blocked vs Missing

| # | Компонент | Статус | Файл | Проблема |
|---|-----------|--------|------|----------|
| 1 | State machine (5 фаз) | ✅ | `agi-mode.tsx:412-671` | — |
| 2 | Plan hygiene engine | ✅ | `plan-status.ts` | ⚠️ `collectPlans()` рекурсивный |
| 3 | Persistence | ✅ | `agi-state.json` | — |
| 4 | Git auto-init | ✅ | `agi-mode.tsx:76-106` | — |
| 5 | Evolving branches | ✅ | `agi-mode.tsx:112-158` | — |
| 6 | TUI badge | ✅ | `index.tsx:1507-1515` | — |
| 7 | Safety limits | ✅ | `MAX_TURNS=100, MAX_RUNTIME=24h` | — |
| 8 | XML parsing | ✅ | `agi-mode.tsx:337-348` | — |
| 9 | Orchestrator agent | ✅ | `agent.ts:211-254` | — |
| 10 | Sub-agent: explore | ✅ | `task.ts` | — |
| 11 | **reasoning_enter/exit для orch** | ⚠️ BLOCKED | `agent.ts:109-110` | defaults deny, нет override |
| 12 | **Sub-agent: coder (для orch)** | ⚠️ BLOCKED | `agent.ts:253` | `subagents: ["explore"]` |
| 13 | **todowrite для orch** | ⚠️ DENIED | `agent.ts:218-248` | Нет в списке allow |
| 14 | **collectPlans flat (не рекурсивно)** | ❌ BUG | `plan-status.ts:64-81` | Заходит в abstract_futures/ |
| 15 | AGI loop (fractal) | ❌ НЕТ | — | Только Python spec |
| 16 | k-medoids task store | ❌ НЕТ | — | Только Python spec |
| 17 | Multi-worker | ⚠️ PARTIAL | `agi-mode.tsx` | Framework есть, workers>1 не tested |
| 18 | `plan_enter/exit` для orch | ✅ ПРАВИЛЬНО DENY | `agent.ts:107-108` | Орк всегда primary |
| 19 | **Builder-as-Architect** | ❌ НЕТ | `agent.ts:255-259` | Build agent всё делает сам → теряет Goal SVM после compaction. Нужен отдельный "architect" agent с deny на edit/write/bash и subagents: ["coder"] |

---

## Smoke Tests

1. **Диаграмма State Machine:** пройти по коду `agi-mode.tsx:412-671` — все transition guard'ы соответствуют documented
2. **Permissions Matrix:** сверить `agent.ts:91-110` (defaults) и `agent.ts:218-248` (orchestrator) с таблицей в §5
3. **Plan Completion Detection:** `hasOpenItems()` regex `/^\s*- \[ \]/m` — проверить на реальных планах из `plans/`
4. **collectPlans bug:** запустить `getPlanStatus(worktree)` — убедиться что `abstract_futures/*` попадают в `active`/`misplaced`
5. **Dispatch Protocol:** проверить `parseOrchestratorDirectives()` regex на валидных XML-строках
6. **Evolving Mode:** проверить `ensureGitInit` + `createImprovementBranch` + `mergeImprovementBranch` на чистом репо
7. **Builder-as-Architect:** симулировать — build agent получает директиву, выполняет 3+ шагов имплементации сам, после compaction проверить сохранился ли Goal SVM (должен быть размыт). Сравнить с delegating architect: тот же сценарий, но через task("coder") — Goal SVM должен быть чистым.
