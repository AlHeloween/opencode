# Plan: Excise orphaned `injectSummaryRequest` (Layer-1 in-loop summary trigger)

## Goal

Убрать осиротевший триггер `injectSummaryRequest` + его теперь-мёртвые хелперы и тесты.
Сайдкар-рефакторинг (`5dfba45086`, `de9ab2677f`) заменил in-loop инъекцию саммари на
`captureSidecar`; `injectSummaryRequest` имеет **0 продакшн-вызовов**. Это чистое
удаление мёртвого кода — без изменения поведения.

## Prior art / reuse

- `reuse: N/A` — внутреннее удаление мёртвого кода, загрунтовано call-site анализом ниже.

## Grounding (карта вызовов, проверено grep'ом)

### Удаляем (орфанед)

| Символ | Файл:строка | Единственный вызов |
|---|---|---|
| `injectSummaryRequest` (impl) | `compaction.ts:1049-1134` | — (0 продакшн-вызовов) |
| `injectSummaryRequest` (interface) | `compaction.ts:755` | — |
| `injectSummaryRequest` (Service.of) | `compaction.ts:1139` | — |
| `injectSummaryRequest` (export wrapper) | `compaction.ts:1167-1174` | — |
| `summaryRangeSystemMarker` | `compaction.ts:552` | только `:1115` (внутри inject) |
| `trimToLastInterval` | `compaction.ts:232` | только `:1080` (внутри inject) |

### Оставляем (живое)

| Символ | Почему живой |
|---|---|
| `summaryRequestProse` (`:560`) | используется сайдкаром `prompt.ts:875` |
| `summaryAttempt`-обработчик (`prompt.ts:1767/2208/2248/2546`) | restart-recovery + terminal-marker |
| `hasPendingSummaryRequest` / `isSummaryRequestMessage` / `isTerminalSummaryRequestMessage` / `summaryTerminalMarker` / `summaryAttemptCount` / `isLayer1SummaryMessage` | живой обработчик + compact (`prompt.ts:1739/1770/1771/1823/2248/2268`, `compaction.ts:214/274/301`) |

## Tasks

### T1 — REMOVE_INJECT_SUMMARY_REQUEST — [ ]
- **what**: удалить `injectSummaryRequest` целиком: interface-поле (`compaction.ts:755`), impl (`:1049-1134`), `Service.of`-запись (`:1139`), export-wrapper (`:1167-1174`).
- **files**: `packages/opencode/src/session/compaction.ts`
- **oracle**: typecheck PASS (tsgo exit 0).

### T2 — REMOVE_ORPHANED_HELPERS — [ ]
- **what**: удалить `summaryRangeSystemMarker` (`compaction.ts:552`) и `trimToLastInterval` (`:232`) — оба стали неиспользуемы после T1.
- **files**: `packages/opencode/src/session/compaction.ts`
- **oracle**: typecheck PASS; grep подтверждает 0 ссылок на оба символа.

### T3 — REMOVE_DEAD_TESTS — [ ]
- **what**: удалить тесты, которые дёргают мёртвый триггер:
  - `compaction.test.ts` — блок `describe("session.compaction.injectSummaryRequest")` (`:1610-1727`, 2 теста);
  - `prompt.test.ts` — тест `"Layer-1 in-loop summary turn keeps the full tool catalog on the wire"` (`:834-868`, добавлен в `eb4408bcd6`; дёргает `injectSummaryRequest` на `:856`).
- **files**: `packages/opencode/test/session/compaction.test.ts`, `packages/opencode/test/session/prompt.test.ts`
- **oracle**: `bun test test/session/compaction.test.ts test/session/prompt.test.ts` — PASS, удалённые тесты отсутствуют.

### T4 — ORACLES_AND_TESTS — [ ]
- **what**: финальная проверка: typecheck + таргетированный прогон compaction/prompt-тестов; план → `plans_completed/`; `_progress_log.md` обновлён.
- **oracle**: typecheck exit 0; targeted tests PASS; git diff — только удаления (0 новых строк, кроме тестов-чистки).

## Smoke Tests

### baseline (до первой правки)
- `tsgo --noEmit` из `packages/opencode` — exit 0 (ожидаемо).
- `bun test test/session/compaction.test.ts` — PASS (зафиксировать текущее число).
- `bun test test/session/prompt.test.ts` — целевые тесты PASS (legacy in-loop тест в списке — он удаляется в T3).

### post-impl (после T1-T3)
- `tsgo --noEmit` — exit 0.
- `bun test test/session/compaction.test.ts test/session/prompt.test.ts` — PASS без удалённых тестов.

## Risks

- **R1**: удаление теста T1 теряет покрытие guard'а `setSummaryMode` на `summaryAttempt`-обработчике. Обработчик теперь недостижим в проде (новые summary-range сообщения не создаются), но сохранён как recovery для старых сессий. Принято: мёртвый код, оракл до него не достучаться.
- **R2**: `trimToLastInterval` может иметь скрытые вызовы — explorer обязан подтвердить 0 других ссылок до T2.
- **R3**: file-level ассерты числа тестов в `compaction.test.ts` (если есть) потребуют правки при удалении блока.

## Status

state: DRAFT — ждёт explorer-валидации + G4-авторизации.
