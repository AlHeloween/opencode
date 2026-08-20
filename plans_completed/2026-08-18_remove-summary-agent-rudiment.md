# Удаление мёртвого кода: summary_agent

## Abstract

summary_agent — скрытый агент, определённый в `packages/opencode/src/agent/agent.ts`, который **нигде не вызывается**. Весь путь от определения до потребителя обрывается на самом определении. Единственный импорт (`PROMPT_SUMMARY`) используется только для этого агента. Промпт-файл содержит 14-строчную заглушку, ссылающуюся на `CONTRACTS["agent.summary_agent"]` и `PACKS["agent.summary_agent"]` — сгенерированные артефакты, которые больше не существуют в кодовой базе.

Ссылки на summary_agent также присутствуют в `prompts_kernel/` — спецификациях агентов, runtime dict, render, reasoning map и тестах. Все подлежат удалению.

**Важно:** функции `summaryNeedsCompactFirst`, `summaryWindowLimit`, `summaryResponseBudget` в `overflow.ts` — часть системы компакции (Layer-1/Layer-2). Они НЕ связаны с summary_agent и НЕ подлежат удалению.

### Input
- `packages/opencode/src/agent/agent.ts` — определение summary_agent + import PROMPT_SUMMARY
- `packages/opencode/src/session/mode-identity.ts` — алиас `summary → summary_agent`
- `packages/opencode/src/agent/prompt/summary.txt` — промпт-файл агента
- `prompts_kernel/20_specs_agents.py` — SUMMARY_AGENT spec
- `prompts_kernel/27_runtime_dict.py` — 4 ссылки (inherits, contract_ids, contracts, tier_a)
- `prompts_kernel/28_runtime_render.py` — RENDER_SPECS dict
- `prompts_kernel/reasoning/00_map.txt` — таблица агентов
- `prompts_kernel/tests/test_runtime.py` — тест промпт-файлов

### Output
- summary_agent удалён из кодовой базы и prompts_kernel
- Все тесты проходят
- Никаких runtime-изменений (агент не использовался)

### Implementation sketch
Удаление 8 точек в src/ + 5 точек в prompts_kernel/, проверка typecheck + tests.

---

## Preconditions (verified [Exact])

- summary_agent **нигде не вызывается** — 0 результатов по `agents.get("summary_agent")` и `agents.get("summary")`
- PROMPT_SUMMARY **импортируется только в agent.ts:17** и используется только в определении summary_agent:462
- summary.txt **потребитель только summary_agent**
- `summaryNeedsCompactFirst` и `summaryWindowLimit` — ALIVE, часть compaction; НЕ удалять
- `2026-08-09-historical-stable_kernel.txt` — historical record; НЕ трогать

## Smoke Tests

### Pre-Flight Baseline

| Command | cwd | Expected |
|---------|-----|----------|
| `bun typecheck` | `packages/opencode` | exit 0 |
| `bun test -- --testPathPattern="agent\|mode-identity\|mode-transition"` | `packages/opencode` | exit 0 |
| `python -m pytest prompts_kernel/tests/test_runtime.py -q` | repo root | exit 0 |

### Post-Implementation Oracle

| Command | cwd | Expected |
|---------|-----|----------|
| `bun typecheck` | `packages/opencode` | exit 0 |
| `bun test -- --testPathPattern="agent\|mode-identity\|mode-transition"` | `packages/opencode` | exit 0 |
| `python -m pytest prompts_kernel/tests/test_runtime.py -q` | repo root | exit 0 |
| `grep -r "summary_agent" packages/opencode/src` | — | 0 results |
| `grep -r "summary_agent" prompts_kernel` (excl. historical) | — | 0 results |

---

## Tasks

### T1: Удалить summary_agent из agent.ts

**what:** Удалить импорт PROMPT_SUMMARY (строка 17) и определение summary_agent (строки 449-463) из `packages/opencode/src/agent/agent.ts`.

**files:**
- `packages/opencode/src/agent/agent.ts`

**depends_on_claims:** []

**oracle:**
- typecheck: `bun typecheck` → exit 0

**Реализация:**
1. Удалить строку 17: `import PROMPT_SUMMARY from "./prompt/summary.txt"`
2. Удалить строки 449-463 (объект summary_agent внутри identities)

---

### T2: Удалить алиас summary из mode-identity.ts

**what:** Удалить запись `summary: "summary_agent"` (строка 19) из `IDENTITY_ALIASES` в `packages/opencode/src/session/mode-identity.ts`.

**files:**
- `packages/opencode/src/session/mode-identity.ts`

**depends_on_claims:** []

**oracle:**
- grep: `grep -r "summary_agent" packages/opencode/src` → 0 results

---

### T3: Удалить промпт-файл summary.txt

**what:** Удалить файл `packages/opencode/src/agent/prompt/summary.txt`.

**files:**
- `packages/opencode/src/agent/prompt/summary.txt` (DELETE)

**depends_on_claims:** [T1]

---

### T4: Удалить SUMMARY_AGENT из prompts_kernel/20_specs_agents.py

**what:** Удалить определение SUMMARY_AGENT (строки 145-156) из `prompts_kernel/20_specs_agents.py`.

**files:**
- `prompts_kernel/20_specs_agents.py`

**depends_on_claims:** []

---

### T5: Удалить summary_agent из prompts_kernel/27_runtime_dict.py

**what:** Удалить 4 ссылки на summary_agent:
1. `SPEC_INHERITS`: строка 322 — `"agent.summary_agent": ("universal",),`
2. `SPEC_CONTRACT_IDS`: строка 363 — `"SUMMARY_AGENT": "agent.summary_agent",`
3. `RUNTIME_CONTRACTS`: строки 444-450 — `"agent.summary_agent": (...)`
4. `_TIER_A_AGENTS`: строка 572 — `"SUMMARY_AGENT",`

**files:**
- `prompts_kernel/27_runtime_dict.py`

**depends_on_claims:** []

---

### T6: Удалить SUMMARY_AGENT из prompts_kernel/28_runtime_render.py

**what:** Удалить строку 199 `"SUMMARY_AGENT": SUMMARY_AGENT,` из RENDER_SPECS dict.

**files:**
- `prompts_kernel/28_runtime_render.py`

**depends_on_claims:** [T4]

---

### T7: Удалить summary_agent из prompts_kernel/reasoning/00_map.txt

**what:** Удалить строку 85 `| summary_agent | Hidden summary only | system |` из таблицы агентов.

**files:**
- `prompts_kernel/reasoning/00_map.txt`

**depends_on_claims:** []

---

### T8: Исправить тест в prompts_kernel/tests/test_runtime.py

**what:** Удалить `"summary.txt": "agent.summary_agent"` (строка 150) из словаря prompts в тесте `test_agent_prompt_files_reference_generated_contract_ids`.

**files:**
- `prompts_kernel/tests/test_runtime.py`

**depends_on_claims:** [T3]

---

### T9: Финальная проверка

**what:** Запустить все тесты и typecheck для финальной верификации.

**depends_on_claims:** [T1, T2, T3, T4, T5, T6, T7, T8]

**oracle:**
- typecheck: `bun typecheck` → exit 0
- tests: `bun test -- --testPathPattern="agent|mode-identity|mode-transition"` → exit 0
- kernel tests: `python -m pytest prompts_kernel/tests/test_runtime.py -q` → exit 0
- grep: `grep -r "summary_agent" packages/opencode/src prompts_kernel --exclude="2026-08-09*"` → 0 results

---

## Claim Ledger

| ID | Text | Status | Provenance |
|----|------|--------|------------|
| C1 | summary_agent нигде не вызывается | [Exact] | grep: agents.get("summary_agent") → 0 results |
| C2 | PROMPT_SUMMARY импортируется только в agent.ts:17 | [Exact] | grep: PROMPT_SUMMARY → 2 results (import + usage) |
| C3 | summary.txt потребитель только summary_agent | [Exact] | grep: summary.txt → только в agent.ts import |
| C4 | summaryNeedsCompactFirst — НЕ summary_agent, а compaction | [Exact] | grep: используется в prompt.ts:827 для compaction |
| C5 | summary алиас в mode-identity.ts не используется | [Exact] | grep: canonicalIdentity("summary") → 0 results |
| C6 | 8 ссылок на summary_agent в prompts_kernel | [Exact] | grep: 11 matches в prompts_kernel (excl. historical) |

---

## Out of Scope

- **`prompts_kernel/2026-08-09-historical-stable_kernel.txt`** — historical record, не трогать
- **`prompts_kernel/tools/_gen_summary.py`** — утилита для semantic map analysis, не связана с summary_agent
- **Кэш-баг с shared prompt_cache_key** — отдельная проблема (build_mode vs title_agent). Решается включением agent в cache key.
- **summaryNeedsCompactFirst / summaryWindowLimit / summaryResponseBudget** — ALIVE, часть compaction. Не удалять.
- **title_agent** — активно используется (prompt.ts:317). Не трогать.
- **reasoning_mode** — активно используется (TUI tools, mode transitions). Не трогать.
