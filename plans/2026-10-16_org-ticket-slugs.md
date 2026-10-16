<!-- intention: from_state="tickets are known only by a hex id; nobody can tell what 355f6a3d4d is about" -> to_state="every ticket carries a required kebab slug, unique among open tickets, and every verb and report shows slug + title" -->

# org-ticket-slugs — человеческий slug у каждого тикета организации

Owner, 2026-10-14: «есть номера тикетов, а о чем они никому не известно».

- sv: { keywords: { ticket-slug 0.30, kebab-uniqueness 0.20, slug-resolution 0.18, inbox-report 0.17, supersede-cancel 0.15 },
        dominant: "Every organization ticket carries a required kebab slug shown beside its title in every verb and report." }

## Задача

Каждый тикет получает короткий человеческий slug: `delegate` требует `--slug`
(kebab-case, уникален среди открытых тикетов, дубликат refused с понятной
ошибкой); каждый глагол, принимающий тикет, понимает slug или id;
`inbox --json` и отчёт «Active tasks» печатают slug + title; тикеты без slug
(старые) остаются читаемыми (slug «-»); вытесненный тикет закрывается
`cancel --successor <slug>` с кодом, называющим slug преемника; правило
задокументировано в `scripts/org-genesis/Protocol.md`.

Связанные пути (от корня репо): `scripts/org-genesis/org.py`,
`scripts/org-genesis/ticket-schema.sql` (поле `slug`), `scripts/org-genesis/branding.sql`
(отчёт «Active tasks»), `scripts/org-genesis/init.py` (`ensure_ticket_fields`),
`scripts/org-genesis/Protocol.md`, новый `scripts/org-genesis/test_ticket_slugs.py`.

Открытое множество для уникальности: `agent_state NOT IN ('VERIFIED','CANCELLED')`
(READY/WORKING/BLOCKED/DONE); после VERIFIED/CANCELLED slug можно переиспользовать.

## Smoke Tests

Oracle (по одному файлу за запуск, через `python -m pytest <file> -q`):

- `scripts/org-genesis/test_ticket_slugs.py` — новый oracle этой задачи; до правок
  ПАДАЕТ на отсутствующем `--slug` (T1), после — зелёный (T1–T7 ниже).
- `scripts/org-genesis/test_cross_handoff.py` — существующий; остаётся зелёным
  (его `cross_delegate` получает `--slug`; S11-чанк чужой — hunks не пересекаются).
- `scripts/org-genesis/test_queue_contract.py` — существующий; остаётся зелёным
  (его `delegate()` получает `--slug`).

Кейсы нового oracle (настоящий изолированный org.fossil под `.temp/test/`, без моков):

- [ ] T1 — `delegate` без `--slug` refused; мусор (`Bad_Slug!`, `-lead`, `trail-`,
      65 символов) refused; валидный slug создаёт тикет с полем `slug`.
- [ ] T2 — второй `delegate` с тем же slug среди открытых refused с понятной ошибкой;
      после VERIFIED тот же slug снова свободен.
- [ ] T3 — полный цикл по slug: claim/heartbeat/report/done/verify + `--parent <slug>`.
- [ ] T4 — `inbox --json` и текст показывают slug + title; legacy-тикет без slug
      читается (текст «-»).
- [ ] T5 — sqlcode отчёта «Active tasks» содержит slug; SELECT отдаёт slug + title.
- [ ] T6 — `cancel --successor <slug>` закрывает с `failure_code`, называющим slug
      преемника; неизвестный преемник refused; тикет-аргумент принимает slug.
- [ ] T7 — неизвестный slug: «no ticket» с понятным текстом.

## Задачи

- [x] S1 — схема и документы: `slug TEXT` в ticket-schema.sql, upgrade-чек в init.py,
      колонка slug в branding.sql «Active tasks», раздел slug в Protocol.md.
- [x] S2 — org.py: `--slug` в delegate (валидация + уникальность), резолвер
      slug|id в `ticket()`, slug в inbox/watching (json+текст), `--successor` в cancel.
- [x] S3 — существующие тесты: `--slug` в хелперах test_queue_contract.py и
      test_cross_handoff.py (только свои hunks, чужой S11 не трогать). Oracle 8+9+8 PASS.
- [ ] S4 — oracle-прогоны (3 файла по одному) + коммит своих путей через
      commit_own с сообщением org-ticket-slugs; org.py — только когда чужие hunks
      уже в HEAD (иначе целый файл снесёт/захватит чужое).
