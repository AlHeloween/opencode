# SVM Anchor & Planning Bugs — Comprehensive Fix

**Date:** 2026-07-31  
**Status:** plan — Bug A fixed (2026-07-31), B–F + epistemic FSM pending  
**Scope:** `opencode_prompts_kernel/` + `packages/opencode/src/` (plan-mode permissions)

---

## 1. Context / Goal

Два класса багов в системе планирования:

### Класс 1: Kernel SVM-Anchor bugs (5 багов)
Некорректная классификация сигналов, узкий детектор шума, пропуск deadloop, несогласованные пороги, отсутствие тестов. Агент реагирует на каскадный шум как на значимые сигналы, застревает в петлях.

### Класс 2: **Self-referential plan-mode bug (КРИТИЧЕСКИЙ)**
**Plan mode запрещает запись в `plans/` несмотря на то, что system prompt явно говорит: «Exception (required): you MAY create and edit files under `plans/`».**

Этот баг делает невозможной доставку Final Plan — фундаментальное нарушение контракта plan mode.

---

## 2. Prior Art (REUSE.BEFORE)

| Source | Finding |
|--------|---------|
| GitHub PR #33640, #24110 | Plan-mode bash permission enforcement gaps |
| GitHub PR #23971 | `plan_exit` model carry bug |
| GitHub issue #1682 | Plan-mode prompt loop |
| `24_specs_policies.py:127-131` | SVM NOISE rule: δ<0.5 + cardinality>1 + same source = NOISE |
| `04_delta.py` | `DELTA_STABLE=0.3`, `DELTA_SHIFT=0.6` |

**reuse: N/A** — баги внутренние, внешних аналогов нет.

---

## 3. Bug A (КРИТИЧЕСКИЙ): Plan mode blocks writes to `plans/`

### Симптом
В plan mode инструмент `write` возвращает: `Permission denied: tool "write" is not authorized in plan mode.` При этом system prompt plan mode содержит:
> **Exception (required):** you MAY create and edit files under `plans/` (write/edit/apply_patch). That is how Final Plan is delivered.

### Root Cause Analysis (confirmed)

**Два gate'а, первый блокирует ошибочно:**

**Gate A — грубый `denied()` pre-check** (`packages/opencode/src/session/tools.ts:65-78`, вызывается на L161):
```typescript
// tools.ts:65-78
function denied(toolID: string): boolean {
  const keys = TOOL_PERMISSION_KEYS[toolID] ?? [toolID];
  for (const perm of keys) {
    if (Permission.evaluate(perm, "*", input.agent.permission).action === "deny") return true;
    if (Permission.evaluate(perm, "*", input.session.permission ?? []).action === "deny") return true;
  }
  return false;
}
```
Для `write`/`edit`: `perm = "edit"`, pattern = **хардкоженный `"*"`**. Plan agent имеет правила:
```
edit: {"*": "deny", "plans/*": "allow"}
```
`Wildcard.match("*", "plans/*")` = **false** (паттерн требует `plans/` префикс, а передан `"*"`). Last match = `* → deny` → **блок**.

**Gate B — path-aware `ctx.ask`** (внутри `edit.ts:164-172`, `write.ts:60-68`, `applypatch.ts:200-209`):
Передаёт **реальный относительный путь** файла. `Permission.evaluate("edit", "plans/foo.md", ruleset)` → последний matching rule = `plans/* → allow` → **разрешает**. Но Gate B **недостижим** из-за Gate A.

**Конфиг уже правильный** (`packages/opencode/src/agent/agent.ts:158-165`):
```typescript
edit: { "*": "deny", [path.join("plans", "*")]: "allow" }
```
Исключение существует в конфиге и в prompt (`plan.txt:20`), но **затенено** грубым `denied()`.

### Fix (Option 1 — recommended, mirrors `Permission.disabled`)

В `denied()` (`tools.ts:65-78`): если ruleset содержит scoped allow (напр. `plans/* → allow`) для edit/write — **не блокировать на Gate A**, делегировать проверку Gate B (`ctx.ask` с реальным путём).

Логика уже существует в `Permission.disabled` (`permission/index.ts:370-375`) — `hasScopedOpen` проверяет, есть ли правила кроме `* → deny`. Её нужно применить в `denied()`.

### Fix (Option 2 — path-aware denied)

Передавать `args` в `denied()`, извлекать `filePath`, нормализовать до worktree-relative, и вызывать `Permission.evaluate("edit", relPath, …)`. Сложнее: apply_patch оперирует несколькими файлами.

### Affected tests
- **`test/session/tools.test.ts:136-139`** — сейчас **assert'ит баг** (пустые args → "not authorized in plan mode"). Нужно обновить: `plans/…` path → success, non-`plans/` → deny via DeniedError.

---

## 4. Bug B–F: SVM Anchor Kernel Bugs

### Bug B: NOISE/CONFIRMATION order inversion → `05_svm_anchor.py:69-101`

`classify_signal` проверяет `d < 0.3 → CONFIRMATION` **до** проверки `_same_source_repeated → NOISE`. Нарушает документированное правило: repeated same-source сигнал = NOISE независимо от близости к anchor.

**Fix:** Переставить: `_same_source_repeated` первой проверкой.

### Bug C: Узкое покрытие `_same_source_repeated` → `05_svm_anchor.py:48-66`

Хардкоженные compiler/linter sources + patterns. Runtime-ошибки, test-output bursts, log cascades не детектируются.

**Fix:**
- Pure cardinality rule: `cardinality >= 5` → suspect cascade
- Content similarity: общий префикс ≥ 30 chars
- Расширить `cascade_sources` → `"test-output"`, `"runtime-error"`, `"log"`

### Bug D: Deadloop detector gap → `13_bug_fix.py:165-169`

`_detect_deadloop` требует consecutive STUCK. STUCK→REFINING→STUCK не триггерит.

**Fix:** Sliding window: ≥2 STUCK в последних 3 попытках.

### Bug E: Threshold inconsistency

| Component | Threshold | Value |
|-----------|-----------|-------|
| `04_delta.py` STABLE | 0.3 | ok |
| `04_delta.py` SHIFT | 0.6 | → 0.5 |
| `05_svm_anchor.py` CONFIRMATION | 0.3 | ok |
| `13_bug_fix.py` STUCK | 0.5 | → 0.3 |
| `13_bug_fix.py` REFINING | 0.8 | → 0.5 |
| `24_specs_policies.py` NOISE | 0.5 | ok |

**Fix:** Унифицировать: 0.3 = stable/same, 0.5 = shift/refining/noise-boundary, 0.6 = divergence.

### Bug F: No tests for `05_svm_anchor.py`

**Fix:** Создать `tests/kernel/test_svm_anchor.py` с тестами на все сценарии.

---

## 5. Implementation Plan

### Phase 1 (КРИТИЧЕСКИЙ): Plan-mode plans/ exception → `packages/opencode/src/session/tools.ts`

- [ ] **A1.** `tools.ts:65-78` `denied()`: добавить `hasScopedOpen`-логику (mirror `permission/index.ts:370-375`) — если для `edit` есть scoped allow кроме `* → deny`, не блокировать на Gate A, делегировать Gate B
- [ ] **A2.** Обновить `test/session/tools.test.ts:136-139`: убрать assert бага; `plans/…` path → success, non-`plans/` → DeniedError

### Phase 2: SVM Anchor fixes

- [ ] **B1.** `05_svm_anchor.py`: переставить порядок в `classify_signal` — `_same_source_repeated` первой
- [ ] **C1.** `05_svm_anchor.py`: расширить `_same_source_repeated` (cardinality ≥5, content similarity, sources)
- [ ] **D1.** `13_bug_fix.py`: sliding-window deadloop detector
- [ ] **E1.** `04_delta.py`: `DELTA_SHIFT = 0.5`
- [ ] **E2.** `13_bug_fix.py`: `STUCK_THRESHOLD = 0.3`, `REFINING_THRESHOLD = 0.5`
- [ ] **E3.** `05_svm_anchor.py`: использовать `DELTA_STABLE` вместо магического 0.3

### Phase 3: Tests

- [ ] **F1.** Создать `tests/kernel/test_svm_anchor.py`
- [ ] **F2.** `test_noise_cascade_lsp` — документированный пример (60× LSP → NOISE)
- [ ] **F3.** `test_confirmation_genuine` — одиночный близкий сигнал → CONFIRMATION
- [ ] **F4.** `test_divergence_new_info` — далёкий сигнал не-каскад → DIVERGENCE
- [ ] **F5.** `test_noise_runtime_cascade` — 60× KeyError → NOISE
- [ ] **F6.** `test_filter_signal_storm` — интеграционный
- [ ] **F7.** `test_bug_fix.py`: `test_deadloop_non_consecutive`

### Phase 4: Verify

- [ ] **V1.** `pytest tests/kernel/ -v` → все тесты pass
- [ ] **V2.** Ручная проверка: docstring-пример возвращает NOISE
- [ ] **V3.** Ручная проверка: write в `plans/` работает в plan mode

---

## 6. Smoke Tests

### Baseline (до исправлений)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `python -m pytest tests/kernel/ -v --tb=short` (repo root) | Все тесты pass | |
| 2 | `python -c "from opencode_prompts_kernel import classify_signal, SvmAnchor, Signal, build_semantic_vector; anchor = SvmAnchor(sv=build_semantic_vector(['DirectoryBrowser','add','component'],[0.5,0.3,0.2],'Adding DirectoryBrowser'), phase='implementation'); s = Signal(source='LSP', pattern='JSX-unresolved-reference', cardinality=60, content=\"';' expected\"); print(classify_signal(anchor, s))"` | `DIVERGENCE` (BUG — должно быть NOISE) | |

### Post-implementation oracles

| # | Command | Pass criteria |
|---|---------|---------------|
| 1 | `pytest tests/kernel/ -v` | Все тесты pass (включая новые) |
| 2 | Docstring example one-liner (см. выше) | `NOISE` |
| 3 | Deadloop sliding-window test | `True` (deadloop detected) |

### Gate

- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

---

## 7. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `plans/` exception слишком широкий (разрешает запись в plans вне plan mode) | Medium | Проверить guard только в plan mode context |
| Threshold changes ломают BugFixSvmTracker | Medium | Существующие тесты + новые edge-case тесты |
| Cardinality ≥5 false-positive NOISE | Low | Только для одинаковых (source, pattern) кластеров |
| Sliding-window false-positive deadloop | Low | ≥2 из 3 + max_attempts достигнут |
