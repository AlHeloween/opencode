# Plan: Replace dead cache_state columns with hit_rate_is_null

## Goal

Удалить 4 неиспользуемые колонки `cache_hit_steps`, `cache_miss_steps`, `cache_unknown_steps`, `cache_state_observed` и заменить одной `hit_rate_is_null` — флагом, который TUI может использовать для отображения "(null)" когда провайдер не отдаёт cache-метрики.

## Prior art / reuse

- `reuse: N/A` — internal schema cleanup, grounded on code analysis above.

## Grounding (что меняется)

### Удаляем (4 колонки, мёртвые)

| Колонка | Файлы |
|---------|-------|
| `cache_hit_steps` | `session.sql.ts`, `db.ts`, `session.ts:244`, `processor.ts:760`, `session.ts:1049`, migration `20260817000000` |
| `cache_miss_steps` |同上 |
| `cache_unknown_steps` |同上 |
| `cache_state_observed` |同上 |

### Добавляем (1 колонка, полезная)

| Колонка | Тип | Семантика |
|---------|-----|-----------|
| `hit_rate_is_null` | `integer` (nullable) | `NULL` = не наблюдался, `0` = hit rate доступен, `1` = hit rate недоступен (KAT/null) |

### Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `migration/20260817000000_cache_state_statistics.ts` | Добавить ADD COLUMN hit_rate_is_null, DROP COLUMN для 4 старых |
| `packages/opencode/src/session/session.sql.ts` | Заменить 4 колонки на hit_rate_is_null |
| `packages/opencode/src/storage/db.ts` | Заменить 4 колонки на hit_rate_is_null |
| `packages/opencode/src/session/session.ts` | `Info` schema: `cache.state` → `cache.hitRateIsNull`, `fromRow`/`toRow` |
| `packages/opencode/src/session/processor.ts` | Писать `hit_rate_is_null = cacheState === "unknown" ? 1 : 0` |
| `packages/opencode/src/session/projectors.ts` | Добавить hit_rate_is_null в проектор |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Добавить `hitRateIsNull` в `SessionSummary.tokens.cache` |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx` | Использовать hit_rate_is_null для отображения |

## Tasks

### T1 — MIGRATION — [x]
- **what**: обновить миграцию `20260817000000_cache_state_statistics.ts`:
  - ADD COLUMN `hit_rate_is_null integer`
  - DROP COLUMN `cache_hit_steps`, `cache_miss_steps`, `cache_unknown_steps`, `cache_state_observed`
- **files**: `packages/opencode/migration/20260817000000_cache_state_statistics.ts`
- **oracle**: `bun typecheck` exit 0; миграция валидна (SQLite ALTER TABLE)

### T2 — SCHEMA_SQL — [x]
- **what**: заменить 4 колонки на `hit_rate_is_null` в Drizzle схеме
- **files**: `packages/opencode/src/session/session.sql.ts`, `packages/opencode/src/storage/db.ts`
- **oracle**: `bun typecheck` exit 0

### T3 — SESSION_SCHEMA — [x]
- **what**: обновить `Session.Info` schema — заменить `cache.state` на `cache.hitRateIsNull`
- **files**: `packages/opencode/src/session/session.ts`
- **oracle**: `bun typecheck` exit 0

### T4 — FROMROW_TOROW — [x]
- **what**: обновить `fromRow`/`toRow` для чтения/записи `hit_rate_is_null`
- **files**: `packages/opencode/src/session/session.ts`
- **oracle**: `bun typecheck` exit 0

### T5 — PROCESSOR — [x]
- **what**: в processor.ts при записи в БД устанавливать `hit_rate_is_null`:
  - `cacheState === "unknown"` → `1`
  - `cacheState === "hit" || cacheState === "miss"` → `0`
  - `cacheState === undefined` → не писать (NULL)
- **files**: `packages/opencode/src/session/processor.ts`
- **oracle**: `bun typecheck` exit 0

### T6 — PROJECTOR — [x]
- **what**: добавить `hit_rate_is_null` в `Session.toRow` проектор
- **files**: `packages/opencode/src/session/projectors.ts`
- **oracle**: `bun typecheck` exit 0

### T7 — SDK_TYPES — [x]
- **what**: добавить `hitRateIsNull?: number` в `SessionSummary.tokens.cache` и `AssistantMessage.tokens.cache`
- **files**: `packages/sdk/js/src/v2/gen/types.gen.ts`
- **oracle**: `bun typecheck` exit 0

### T8 — TUI_SIDEBAR — [x]
- **what**: обновить `cacheTokens()` и отображение cache stats в sidebar context.tsx:
  - если `hit_rate_is_null === 1` → возвращать `{ read: null, miss: null }` для отображения "(null)"
  - если `hit_rate_is_null === 0` → нормальная статистика
  - если `hit_rate_is_null` undefined/NULL → не показывать
- **files**: `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx`
- **oracle**: `bun typecheck` exit 0

### T9 — ORACLES_AND_TESTS — [x]
- **what**: финальная проверка: typecheck + targeted tests
- **oracle**: `bun typecheck` exit 0; `bun test test/session/` — PASS

## Smoke Tests

### baseline (до первой правки)
- `bun typecheck` из `packages/opencode` — exit 0
- `bun test test/session/cache-injection.test.ts` — PASS (зафиксировать текущее число тестов)

### post-impl (после T1-T8)
- `bun typecheck` — exit 0
- `bun test test/session/` — PASS
- `git diff` — 4 колонки удалены, 1 добавлена

## Risks

- **R1**: SQLite не поддерживает DROP COLUMN в старых версиях. Проверить минимальную версию SQLite. Принято: opencode требует SQLite 3.35+ (DROP COLUMN добавлен в 3.35.0).
- **R2**: Существующие БД пользователей уже имеют 4 колонки. Миграция должна быть backward-compatible — ADD COLUMN перед DROP COLUMN.
- **R3**: SDK types генерируются автоматически из OpenAPI schema. Ручное изменение `types.gen.ts` может быть перезаписано при следующей генерации. Нужно обновить источник (OpenAPI schema) или зафиксировать ручное изменение.

## Status

state: COMPLETED — все задачи выполнены, typecheck PASS, tests PASS (12/12).
