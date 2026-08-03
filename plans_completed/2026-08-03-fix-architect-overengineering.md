# Fix: Architect Over-engineering → Builder Prompt Delegation

**Дата:** 2026-08-03
**Статус:** 📐 ПЛАН
**Причина:** Architect = лишняя сущность. Builder уже умеет всё. Достаточно prompt.

---

## 1. Диагноз

| Проблема | Почему |
|----------|--------|
| Создан отдельный `architect` agent | Builder имеет те же permissions + больше. Отдельный agent → фреймворк, TUI, ACP, тесты |
| Architect prompt содержит тулзы | Architect НЕ вызывает тулзы сам — он делегирует. SEARCH_ORDER/RAG/index-check — это инструкции для explorer/coder, не для architect |
| `sendToWorker` захардкожен на `agent: "architect"` | main session должна использовать build (или default агент сессии) |
| Index freshness не проверяется | Никто не вызывает `codegraphcodegraphstatus` перед codegraph-запросами |

## 2. План

### Шаг 1: Удалить architect agent

**Файл:** `packages/opencode/src/agent/agent.ts`

- Удалить строки 259-297 (architect: { ... })
- Удалить `import PROMPT_ARCHITECT from "./prompt/architect.txt"` (строка 16)
- Удалить файл `packages/opencode/src/agent/prompt/architect.txt`

### Шаг 2: Модифицировать build prompt — совмещение ролей

**Файл:** `packages/opencode/src/agent/prompt/build.txt` (создать, если нет)

Build agent = builder + архитектор. Prompt:

```
Ты совмещаешь две роли:
  BUILDER   — можешь edit/write/bash (полные права, как обычно)
  ARCHITECT — хранишь Goal SVM, декомпозируешь, делегируешь coder'ам

ПРИОРИТЕТ: delegate implementation to task("coder").
  • Каждую атомарную задачу реализации → task("coder", ...)
  • Coder — чистая сессия: одна задача, нет побочных эффектов
  • После каждого coder'а: проверь smoke oracles
  • Implementation noise остаётся в coder-сессиях — Goal SVM чистый

НО: если нужно что-то быстро поправить самому (мелкий фикс, опечатка) —
  делай. Права есть. Просто приоритет — делегирование.

После compaction: переформулируй Goal SVM перед следующим делегированием.
```

**Или** — если build prompt это kernel-stub (CONTRACT/PACK), то:
- Изменения в `prompts_kernel/20_specs_agents.py` секция build
- Добавить `agent.build` contract с ролью "builder+architect"

### Шаг 3: Explorer — SEARCH_ORDER + index freshness

**Файл:** `packages/opencode/src/agent/prompt/explore.txt` ИЛИ `prompts_kernel/26_specs_grounding.py`

Добавить в SEARCH_ORDER:
```
Перед codegraph-запросами: codegraphcodegraphstatus() → убедись что индекс синхронизирован.
Перед RAG-запросами: проверь наличие .adid_rag/data, статус индекса (dbread).
Если индекс устарел → доложи, используй grep/read как fallback.
```

### Шаг 4: sendToWorker — убрать хардкод agent

**Файл:** `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx`

- Строка 361: убрать `agent: "architect"` 
- Либо: оставить без agent (сессия использует default = build)
- Либо: `agent: "build"` явно

### Шаг 5: Семантика агентов (итоговая)

```
ОРКЕСТРАТОР (orchestrator)
  ├─ plans/, delegates, verifies
  ├─ NO shell, NO edit (только plans/*)
  └─ subagents: ["explore", "coder"]

BUILDER (build, main session)  ← БЫВШИЙ "ARCHITECT"
  ├─ Принимает директивы оркестратора
  ├─ Хранит Goal SVM
  ├─ Декомпозирует задачи
  ├─ Делегирует ИМПЛЕМЕНТАЦИЮ → task("coder")
  ├─ Делегирует RESEARCH → task("explore")
  ├─ Сам: read-only анализ (read, codegraph, glob, grep, list)
  ├─ МОЖЕТ сам редактировать (права есть), но prompt говорит НЕ ДЕЛАЙ
  └─ Верифицирует smoke oracles

CODER (sub-agent)
  ├─ Получает атомарную задачу от builder
  ├─ Полный доступ: edit, write, bash, run
  ├─ Одна задача → одна сессия → результат → сессия забыта
  └─ Implementation noise остаётся в coder-сессии

EXPLORER (sub-agent)
  ├─ Research: codegraph, grep, glob, read
  ├─ Перед codegraph: codegraphcodegraphstatus() — проверка индекса
  ├─ Перед RAG: проверка .adid_rag/data
  └─ Докладывает builder'у
```

## 3. Почему build, а не architect

| Критерий | Architect (отдельный) | Build (изменённый prompt) |
|----------|----------------------|---------------------------|
| **Сущности** | +1 agent type | 0 новых |
| **Permissions** | deny edit/write/bash | allow всё → prompt ограничивает |
| **Фреймворк** | Новый agent → TUI, ACP, SDK, тесты | Ничего не меняется |
| **Гибкость** | Жёсткий deny — нельзя самому если нужно | Мягкий prompt — может сам если coder недоступен |
| **Откат** | Сложно (удалить agent type) | Легко (вернуть старый prompt) |
| **Goal SVM** | Да (prompt) | Да (prompt) |

**Вывод:** Build = архитектор с правами. Prompt гибче permissions. Не плодим сущности.

## Smoke Tests

1. **Build prompt делегирует:** отправить build agent задачу "добавь комментарий в README" → проверить что вызван `task("coder")`, а не `edit`
2. **Explorer проверяет индекс:** explorer получает задачу с codegraph → в логах есть `codegraphcodegraphstatus`
3. **sendToWorker без architect:** AGI mode активирован → main session использует build agent
4. **Typecheck:** `bun typecheck` после удаления architect
5. **Agent list:** `bun test` agent-related тесты проходят
