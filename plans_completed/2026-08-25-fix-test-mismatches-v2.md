# Plan: Fix Test Mismatches in prompts_kernel/tests/

**Goal**: Исправить 3 failing теста в `prompts_kernel/tests/` без нарушения kernel generation pipeline.

**Status**: COMPLETED

**Smoke Tests**:
```bash
python -m pytest prompts_kernel/tests/ -q
```
Expected: 489 passed, 0 failed

---

## Analysis

### Kernel Generation Pipeline

```
prompts_kernel/reasoning/*.txt (fragments with @schema: markers)
    ↓ assemble_reasoning()
prompts_kernel/dist/{date}_reasoning_prompt.mdc (review artifact)
prompts_kernel/dist/{date}_reasoning_prompt.txt (runtime artifact)
    ↓ manual promotion
packages/opencode/src/session/prompt/reasoning_prompt.txt (production)
```

### Failing Tests

| Test | Root Cause | Fix |
|------|-----------|-----|
| `test_pocket_protocol_files_exist_and_markers` | Expects `reasoning_prompt.mdc` in `SESSION_PROMPT_DIR` | Check `.mdc` in `KERNEL_DIST_DIR` |
| `test_schema_refs_resolve` | Line 363 uses `SESSION_PROMPT_DIR` for `.mdc` | Use `KERNEL_DIST_DIR` |
| `test_reasoning_artifacts_match_generator` | Stale files in `dist/` | Regenerate artifacts |

---

## Tasks

### T1: Fix `test_pocket_protocol_files_exist_and_markers`

**What**: Обновить тест для проверки файлов в правильных директориях.

**Files**: `prompts_kernel/tests/test_prompt_schema.py`

**Changes**:
1. Добавить `KERNEL_DIST_DIR` константу (строка 36)
2. Разделить `POCKET_PROTOCOL_FILES` по директориям:
   - `reasoning_prompt.mdc` → проверять в `KERNEL_DIST_DIR`
   - `reasoning_prompt.txt` → проверять в `SESSION_PROMPT_DIR`
   - Mode tails (`build.txt`, `plan.txt`, `reasoning-mode.txt`) → проверять в `SESSION_PROMPT_DIR`
3. Обновить функцию `test_pocket_protocol_files_exist_and_markers` для использования разных директорий

**Oracle**: `python -m pytest prompts_kernel/tests/test_prompt_schema.py::test_pocket_protocol_files_exist_and_markers -v`

### T2: Fix `test_schema_refs_resolve`

**What**: Исправить путь к `reasoning_prompt.mdc` в тесте.

**Files**: `prompts_kernel/tests/test_prompt_schema.py`

**Changes**:
1. Строка 363: заменить `SESSION_PROMPT_DIR` на `KERNEL_DIST_DIR`

**Oracle**: `python -m pytest prompts_kernel/tests/test_prompt_schema.py::test_schema_refs_resolve -v`

### T3: Regenerate `dist/` artifacts

**What**: Перегенерировать staging artifacts в `prompts_kernel/dist/`.

**Files**: `prompts_kernel/dist/*`

**Changes**:
1. Запустить `write_reasoning()` для создания `2026-08-25_reasoning_prompt.mdc` и `.txt`
2. Скопировать в `reasoning_prompt.mdc` и `reasoning_prompt.txt` (default names)

**Note**: Это НЕ модификация production kernel — это обновление staging artifacts.

**Oracle**: `python -m pytest prompts_kernel/tests/test_runtime.py::TestRuntimePromptCompiler::test_reasoning_artifacts_match_generator -v`

---

## Key Decisions

1. **Не трогать production kernel** — `packages/opencode/src/session/prompt/reasoning_prompt.txt` остаётся без изменений
2. **Не добавлять skip guards** — файлы должны существовать в правильных директориях
3. **Разделить проверку по директориям** — `.mdc` в `KERNEL_DIST_DIR`, `.txt` в `SESSION_PROMPT_DIR`

---

## Verification

```bash
# Run all tests
python -m pytest prompts_kernel/tests/ -q

# Expected: 489 passed, 0 failed
```
