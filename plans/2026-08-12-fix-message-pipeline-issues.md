# Fix Message Sending Pipeline Issues

**plan_id:** `pl_20260812_msg_pipeline_fix`
**revision:** 2
**created_by:** plan_mode (Smit)
**state:** DRAFT
**lineage:**
  parent_goal_id: null
  generation_id: 0
  evolution_candidate_id: null
  parent_project_snapshot: null

## Description

Устранение 10 проблем в пайплайне отправки сообщений (prompt.ts → llm.ts → provider), выявленных
при анализе 2026-08-12. Проблемы охватывают гонку фингерпринт/plugin-transform, потерю
сегментных границ в system.join(""), неверный systemForDiff, отсутствие ratelimit на
sidecar checkpoint, избыточную инвалидацию чекпоинта при structured output, never-reset
флага логирования, отсутствие инструментирования legacy fallback, и architectural drift
между assemblePathSystem / assembleSystemMessages.

## Premises (⊆ G)

| Claim | Status | Text |
|-------|--------|------|
| C1 | Exact | `prompt.ts:1846` — `currentFP` вычисляется до `handle.process()` |
| C2 | Exact | `llm.ts:336-340` — `chat.system.transform` модифицирует `system` по ссылке |
| C3 | Exact | `prompt.ts:1923-1929` — `finalFP` перевычисляется при `systemChanged` |
| C4 | Exact | `llm.ts:362` — `system.join("")` в `checkSystemStability` |
| C5 | Exact | `prompt.ts:1841` — `systemForDiff = [...system]` до plugin transform |
| C6 | Exact | `prompt.ts:1226-1228` — `sidecarInFlight` guard без frequency limit |
| C7 | Exact | `prompt.ts:1805-1810` — structured output инвалидирует checkpoint |
| C8 | Exact | `llm.ts:33,345` — `loggedSystemPrompt = false` never reset |
| C9 | Exact | `prompt.ts:1884-1886` — legacy checkpoint fallback без warn |
| C10 | Exact | `system-compose.ts:123-135` vs `system-compose.ts:52-82` — порядок не верифицирован |

## Open Questions

- Q1: Нужен ли `debounce` для sidecar capture или только `cooldown`?
- Q2: Для Problem 5 — стоит ли хранить `structuredOutputPrompt` в самом `CheckpointData`?

---

## Goals

### G1: Fix fingerprint/audit timing (Problems 1, 3)

**sv:** fingerprint, audit, plugin-transform, timing, cache-control, systemForDiff
**document:** Переместить вычисление фингерпринта и захват `systemForDiff` на момент ПОСЛЕ
`handle.process()`, когда плагин `chat.system.transform` уже отработал.
**done_pct:** 0

**Tasks:**

- **T1.1 — Move fingerprint + audit to post-process**
  - **what:** В `prompt.ts` runLoop: вычислить `currentFP` и выполнить `auditCache()` ПОСЛЕ
    `handle.process()`, используя `finalFP` (который сейчас вычисляется на строках 1923-1929).
    Удалить раннее вычисление `currentFP` на строке 1846 и `auditCache` на строке 1852.
  - **files:** [`packages/opencode/src/session/prompt.ts`]
  - **depends_on_claims:** [C1, C2, C3]
  - **oracle:** `bun typecheck` → PASS; unit test `cache-control.test.ts` → PASS
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

- **T1.2 — Fix systemForDiff capture timing**
  - **what:** Перенести `const systemForDiff = [...system]` (строка 1841) на позицию ПОСЛЕ
    `handle.process()` (перед строкой 1922), чтобы RequestDiff логировал реально
    отправленную систему, а не pre-transform состояние.
  - **files:** [`packages/opencode/src/session/prompt.ts`]
  - **depends_on_claims:** [C5, C2]
  - **oracle:** `bun typecheck` → PASS; визуальная проверка диффа в `.opencode/data/log/`
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

### G2: Fix system.join("") segment boundary (Problem 2)

**sv:** system-join, segment-boundary, checkSystemStability, llm
**document:** Заменить `system.join("")` на `system.join("\n")` в `checkSystemStability`
вызове, чтобы границы сегментов не терялись при детекте system-prompt дрифта.
**done_pct:** 0

**Tasks:**

- **T2.1 — Replace join("") with join("\n")**
  - **what:** В `llm.ts:362` заменить `content: system.join("")` →
    `content: system.join("\n")`. Это делает сравнение длин и контента семантически
    корректным: каждый сегмент разделён `\n`, и сдвиг текста между сегментами
    будет обнаружен.
  - **files:** [`packages/opencode/src/session/llm.ts`]
  - **depends_on_claims:** [C4]
  - **oracle:** `bun typecheck` → PASS; `bun test llm.test.ts` → PASS
  - **note:** При первом запуске после изменения будет одноразовый false-positive
    срабатывание `warn("bug: system prompt content changed")` из-за того, что
    предыдущая сохранённая длина (без `\n`) не совпадёт с новой (с `\n`).
    Это безопасно — после одного цикла сохранения обе длины используют `\n`.
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

### G3: Add sidecar checkpoint rate limiting (Problem 4)

**sv:** sidecar, ratelimit, cooldown, checkpoint, summary-frequency
**document:** Добавить временной кулдаун между последовательными sidecar checkpoint
захватами (не чаще одного раза в N секунд), чтобы избежать избыточной LLM-нагрузки
при быстрых turn'ах.
**done_pct:** 0

**Tasks:**

- **T3.1 — Add cooldown to sidecar capture**
  - **what:** В `maybeCaptureSidecar()` добавить проверку `lastSidecarTime`:
    если с момента последнего успешного захвата прошло менее `SIDECAR_COOLDOWN_MS`
    (рекомендуемое значение: 30_000 мс = 30 секунд), пропустить захват.
    Сброс при compaction (открывает новое окно).
  - **files:** [`packages/opencode/src/session/prompt.ts`]
  - **depends_on_claims:** [C6]
  - **oracle:** `bun typecheck` → PASS; логи показывают ≤1 sidecar за 30-секундное окно
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

### G4: Optimize structured output checkpoint handling (Problem 5)

**sv:** structured-output, checkpoint, system-prompt, incremental-update
**document:** Вместо полной пересборки system prompt при переключении structured output,
только добавлять/удалять `STRUCTURED_OUTPUT_SYSTEM_PROMPT` из существующего массива.
**done_pct:** 0

**Tasks:**

- **T4.1 — Incremental structured output prompt in checkpoint**
  - **what:** В логике определения `checkpointUsable` (строки 1793-1810):
    если identity fingerprint совпадает и messages совпадают, но
    `checkpointHasStructuredPrompt !== (format.type === "json_schema")` —
    вместо полного отбрасывания чекпоинта, мутировать `systemPrompt` in-place:
    - Если нужен structured prompt → добавить `STRUCTURED_OUTPUT_SYSTEM_PROMPT` в конец
    - Если не нужен → удалить `STRUCTURED_OUTPUT_SYSTEM_PROMPT` из system
    - Установить `checkpointUsable` в модифицированный объект
    - Пропустить `assemblePathSystem()` (не пересобирать skills/env/rules/instructions)
  - **files:** [`packages/opencode/src/session/prompt.ts`]
  - **depends_on_claims:** [C7]
  - **oracle:** `bun typecheck` → PASS; переключение формата не вызывает чтение skills с диска
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

### G5: Reset loggedSystemPrompt per session (Problem 7)

**sv:** logging, system-prompt, observability, session-scope
**document:** Заменить модульный `let loggedSystemPrompt = false` на per-session tracking,
чтобы system prompt логировался один раз для каждой новой сессии, а не только для самой
первой в жизни процесса.
**done_pct:** 0

**Tasks:**

- **T5.1 — Per-session loggedSystemPrompt**
  - **what:** В `llm.ts`: заменить `let loggedSystemPrompt = false` (строка 33) на
    `Map<string, boolean>` с ключом `sessionID`. При старте новой сессии флаг сбрасывается.
    Альтернативно: использовать `providerCacheKey` как ключ (более точно отражает
    «новый system prompt»).
  - **files:** [`packages/opencode/src/session/llm.ts`]
  - **depends_on_claims:** [C8]
  - **oracle:** `bun typecheck` → PASS; логи показывают system prompt для каждой новой сессии
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

### G6: Add observability for legacy checkpoint fallback (Problem 9)

**sv:** checkpoint, legacy, fallback, instrumentation, warn
**document:** Добавить `log.warn("bug: ...")` при обнаружении legacy checkpoint без
`modelMessageCounts`, чтобы разработчики видели деградацию производительности.
**done_pct:** 0

**Tasks:**

- **T6.1 — Warn on legacy checkpoint fallback**
  - **what:** В `prompt.ts:1884-1886` (блок `prefixModel === null`): добавить
    `log.warn("bug: legacy checkpoint without modelMessageCounts — full reconvert")`
    с context-полями (sessionID, modelID, agent).
  - **files:** [`packages/opencode/src/session/prompt.ts`]
  - **depends_on_claims:** [C9]
  - **oracle:** `bun typecheck` → PASS; при наличии legacy checkpoint — warn в логах
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

### G7: Add path system order assertion (Problem 10)

**sv:** path-system, order, assertion, assemble, validation
**document:** Добавить runtime-assertion (development-only) что порядок в `assemblePathSystem()`
соответствует ожидаемому порядку в `assembleSystemMessages()`. Использовать существующую
`validateSystemOrder()`.
**done_pct:** 0

**Tasks:**

- **T7.1 — Assert path system ↔ compose order consistency**
  - **what:** Вызывать `validateSystemOrder()` в dev-режиме после `assemblePathSystem()`
    в prompt.ts (строка 1829) и после `assembleSystemMessages()` в llm.ts (строка 323).
    При несовпадении — `console.warn` в dev, `log.warn("bug: ...")` в production.
  - **files:** [`packages/opencode/src/session/system-compose.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/llm.ts`]
  - **depends_on_claims:** [C10]
  - **oracle:** `bun typecheck` → PASS; существующие тесты `system-compose.test.ts` → PASS
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

### G8: Document kernel-change checkpoint invalidation (Problem 6 + 8)

**sv:** documentation, kernel-change, checkpoint-invalidation, atomicity, map
**document:** Документировать поведение глобальной инвалидации чекпоинтов при изменении
ядра в AGENTS.md. Для Problem 8 (Map atomicity) — добавить комментарий о
кооперативной природе Effect файберов.
**done_pct:** 0

**Tasks:**

- **T8.1 — Document checkpoint invalidation behavior**
  - **what:** Добавить секцию в `AGENTS.md` → `## Checkpoint Invalidation on Kernel Change`:
    описать, что изменение `reasoning_prompt.txt` меняет `identityFingerprint` (SHA-256)
    и инвалидирует ВСЕ зашифрованные чекпоинты ВСЕХ сессий. Указать, что это
    дизайн-решение для KV-cache непрерывности, и что пользователи должны ожидать
    «холодный старт» после kernel update.
  - **files:** [`AGENTS.md`]
  - **depends_on_claims:** []
  - **oracle:** review — документация присутствует и корректна
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

- **T8.2 — Add comment on Map atomicity in checkSystemStability**
  - **what:** В `llm.ts` над `systemContentLen` и `systemContentPrev` Map-ами добавить
    комментарий: «Effect fibers are cooperative (no preemptive yield in synchronous code);
    the two-Map update in checkSystemStability is atomic within one Effect.gen block.»
  - **files:** [`packages/opencode/src/session/llm.ts`]
  - **depends_on_claims:** []
  - **oracle:** review — комментарий присутствует
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

### G9: Fix agent-dependent Skill tool description (KV-cache break root cause)

**sv:** describeSkill, tool-description, agent-independent, kv-cache, mode-switch
**document:** `describeSkill(agent)` в `registry.ts:348` вызывает `skill.available(agent)` —
возвращает agent-зависимый список skills. При plan↔build переключении tool JSON (описание
инструмента Skill) меняется → провайдер видит другой tools блок → KV-cache miss.
Исправить: всегда использовать самого permissive агента (build_mode), как уже
сделано в `describeTask(_agent)` где параметр agent игнорируется.
**done_pct:** 0

**Tasks:**

- **T9.1 — Make describeSkill agent-independent**
  - **what:** В `registry.ts:348-365`: заменить `skill.available(agent)` на
    `skill.available(buildModeAgent)` — всегда полный список skills, независимо
    от режима. ACL гейтит выполнение в SessionTools, а не в описании.
  - **files:** [`packages/opencode/src/tool/registry.ts`]
  - **depends_on_claims:** []
  - **oracle:** `bun typecheck` → PASS; переключение plan→build → tool JSON идентичен
  - **status:** [ ]
  - **attempts:** 0
  - **last_failure:** null
  - **worker_id:** null
  - **lease_expires_at:** null
  - **action_class:** MODIFY_CANDIDATE

---

## Claim Ledger

| Claim | Text | Status | Provenance | Reason |
|-------|------|--------|------------|--------|
| C1 | `currentFP` вычисляется до `handle.process()` | Exact | CONTEXT | `prompt.ts:1846` |
| C2 | `chat.system.transform` модифицирует `system` по ссылке | Exact | CONTEXT | `llm.ts:336-340` |
| C3 | `finalFP` перевычисляется при `systemChanged` | Exact | CONTEXT | `prompt.ts:1923-1929` |
| C4 | `system.join("")` в `checkSystemStability` | Exact | CONTEXT | `llm.ts:362` |
| C5 | `systemForDiff` захватывается до plugin transform | Exact | CONTEXT | `prompt.ts:1841` |
| C6 | `sidecarInFlight` без frequency limit | Exact | CONTEXT | `prompt.ts:1226-1228` |
| C7 | structured output инвалидирует checkpoint | Exact | CONTEXT | `prompt.ts:1805-1810` |
| C8 | `loggedSystemPrompt` never reset | Exact | CONTEXT | `llm.ts:33,345` |
| C9 | legacy checkpoint fallback без warn | Exact | CONTEXT | `prompt.ts:1884-1886` |
| C10 | порядок `assemblePathSystem` vs `assembleSystemMessages` не верифицирован | Exact | CONTEXT | `system-compose.ts:123-135` vs `:52-82` |

---

## Dependency Graph (Tasks)

```
T1.1 ──┐
T1.2 ──┤ (независимы, оба в prompt.ts)
        │
T2.1 ──┤ (независим, llm.ts)
        │
T3.1 ──┤ (независим, prompt.ts)
        │
T4.1 ──┼── зависит от T1.1 (fingerprint timing влияет на checkpoint save)
        │
T5.1 ──┤ (независим, llm.ts)
        │
T6.1 ──┤ (независим, prompt.ts)
        │
T7.1 ──┤ (независим, system-compose.ts)
        │
T8.1 ──┤ (независим, docs)
T8.2 ──┘ (независим, llm.ts)
```

### Execution Order

```
Phase 1 (parallel):  T1.1, T1.2, T2.1, T3.1, T5.1, T6.1, T7.1, T8.1, T8.2
Phase 2 (after T1.1): T4.1
```

---

## Smoke Tests

**smoke_na:** false

### Baseline (before any edits)

| Label | Command | Expected Exit | Tolerance | Reason |
|-------|---------|---------------|-----------|--------|
| typecheck | `bun typecheck` from `packages/opencode` | 0 | 0 | — |
| unit-cache | `bun test cache-control.test.ts` from `packages/opencode` | 0 | 0 | — |
| unit-system | `bun test system-compose.test.ts` from `packages/opencode` | 0 | 0 | — |
| unit-llm | `bun test llm.test.ts` from `packages/opencode` | 0 | 0 | — |
| unit-prompt | `bun test prompt.test.ts` from `packages/opencode` | 0 | 0 | — |

### Post-Implementation Checks

| Label | Command | Expected Exit | Description |
|-------|---------|---------------|-------------|
| typecheck-post | `bun typecheck` from `packages/opencode` | 0 | All changes typecheck |
| unit-all | `bun test` from `packages/opencode` | 0 | Existing tests pass |
| audit-log | grep `[cache:` in `.opencode/data/log/` | N/A | Cache audit logs appear AFTER transform |
| sidecar-log | grep `sidecar` in `.opencode/data/log/` | N/A | Sidecar shows cooldown skips |
| struct-output | Manual: switch json_schema → text → json_schema | N/A | No skills/env/rules recompute in logs |

**blast_radius:** `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/llm.ts`,
`packages/opencode/src/session/system-compose.ts`, `packages/opencode/src/session/cache-control.ts`, `AGENTS.md`

---

## Risk Ledger

| ID | Risk | Type | Blocks Outcome? |
|----|------|------|----------------|
| R1 | T1.1: fingerprint timing change может вызвать одноразовый baseline-reset | architecture_concern | No |
| R2 | T2.1: join("\n") — одноразовый false-positive `warn("bug: ...")` | unverified_acceptance_criterion | No |
| R3 | T4.1: мутация systemPrompt in-place требует аккуратности с structured output prompt | unresolved_safety_risk | No |
| R4 | T3.1: cooldown может пропустить нужный summary при burst-трафике | architecture_concern | No |

---

## Outcome Contract

**acceptance_criteria:**
1. Все oracle-проверки из Smoke Tests → PASS
2. Кеш-аудит логируется ПОСЛЕ plugin transform (T1.1)
3. systemForDiff содержит post-transform состояние (T1.2)
4. checkSystemStability использует join("\n") (T2.1)
5. sidecar захват имеет кулдаун не менее 30s (T3.1)
6. Structured output не вызывает пересборку path system (T4.1)
7. loggedSystemPrompt сбрасывается для каждой новой сессии (T5.1)
8. Legacy checkpoint fallback логирует warn (T6.1)
9. validateSystemOrder вызывается в dev-режиме (T7.1)
10. Документация в AGENTS.md обновлена (T8.1)

**coverage_threshold:** 1.0
**critical_risks:** []
