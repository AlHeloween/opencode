<!-- intention: замена CodeGraph предложена без проверенных привязок -> имеются source pins, живой Fossil receipt и проверяемый контракт миграции -->
# Zoekt / SCIP / Fossil / SV — первый проход

```yaml
Keywords: fossil-provenance 0.30, zoekt-search 0.25, migration-seams 0.20, scip-navigation 0.15, oracle-boundaries 0.10
Semantic dominant: Проверить исходные предпосылки локальной code intelligence и сохранить конкретные точки миграции без заявления о готовой замене.
md5: 3d96b8fa1c704e2bbf562f08a79d435e
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e8a16f092bce49a5b9f4130dd7c26e84
```

План: `plans/2026-10-16_zoekt-scip-fossil-sv.md`. Дата: 2026-10-16.

## Результат и границы

✓ CONFIRMED, `exec_command` receipts: два вызова `cmd_runner start ... git clone`
отклонены автоматической политикой до запуска: `rejected: blocked by policy`.
Причина подробнее не предоставлена, run id не создан. Повторное `fs.stat`
подтвердило отсутствие `external/zoekt` и `external/scip`. Клонирование,
сборка Zoekt, индексирование, SCIP indexer и production cutover НЕ выполнены.
Обход запрета через другой launcher/download не предпринимался.

✓ CONFIRMED, GitHub API: запрошенные репозитории существуют, `fork=false`;
default branches — Zoekt `main`, SCIP `folding`. Отдалённые revisions ниже —
прочитанные source pins, НЕ HEAD локальных клонов.

| источник | revision | SHA256 прочитанного файла |
|---|---|---|
| `sourcegraph/zoekt`, `cmd/zoekt-index/main.go` | `74e1e85839697c4c4eb8a6223cc3971e6c26da45` | `bfbf83e19a405b9a6f27ee4348547b070dcf49f8f82785a389bfe018aeac6616` |
| `scip-code/scip`, `scip.proto` | `e26a0b0fc83424dbfe6c703c0437d4703aec4aa0` | `fd5c58c4d140cdef9fff936dfc33d3459ab5b6cfbb9a24a8bde163cf45194ef3` |

Primary authorities:

- [Zoekt README](https://github.com/sourcegraph/zoekt): ordinary-directory indexing,
  CLI, webserver; JSON API requires `-rpc`.
- [Pinned directory indexer](https://github.com/sourcegraph/zoekt/blob/74e1e85839697c4c4eb8a6223cc3971e6c26da45/cmd/zoekt-index/main.go):
  `indexArg`, `filepath.Walk`, `builder.Add`, `builder.Finish`; `-meta` accepts
  repository description; default ignored directories `.git,.hg,.svn`.
- [SCIP schema](https://github.com/scip-code/scip/blob/e26a0b0fc83424dbfe6c703c0437d4703aec4aa0/scip.proto):
  documents, symbols, occurrences and relationships; precision belongs to the producer.

Inferred по этим исходникам: Fossil checkout подходит как вход директории.
Unknown до запуска: Windows portability, правильные file paths, полнота индекса,
удаление прежних shards, стоимость обновления и производительность на нашем корпусе.
`mlink` сообщает изменения, но сам по себе НЕ делает Zoekt/SCIP инкрементальными.

## Живой Fossil receipt

✓ CONFIRMED, `node:sqlite DatabaseSync` readonly, без Fossil write:

```text
repo: D:/zPython/opencode/.opencode/data/fossil/4b0ea68d7af9a6031a7ffda7ad66e0cb83315750/snapshot.fsl
checkins: 496
signed comments (LIKE '%sv:%'): 272
latest signed checkin: cf64f467b5b2d6deed2bcb38d88740397a3dd32aa794f3f93a60f4bd5ca19b7a
event.objid: 16214
event datetime: 2026-10-16 09:15:27 (SQLite UTC)
sv: 1a2b3c4d5e6f708192a3b4c5d6e7f809
full-vector fields present: Keywords, Semantic dominant, prev-md5, parent-goal-md5
mlink rows: 3
docs/robot-protocol-log.md                         pid=16194 fid=16211 pfnid=0
packages/opencode/src/provider/models-snapshot.js pid=16202 fid=16212 pfnid=0
plans/2026-10-16_presence-revoke-and-test-guard.md  pid=16207 fid=16213 pfnid=0
```

Счётчики — снимок чтения, не постоянные значения. Primitive qualification:
in-memory `SELECT 2+2 AS n` вернул 4; `SELECT * FROM absent_control` выдал
`no such table: absent_control` — EXPECTED_FAIL. Это квалификация SQL чтения,
не интеграционный oracle поискового движка.

Воспроизводимые запросы к `DatabaseSync(repo,{readOnly:true})`:

```sql
SELECT count(*) AS checkins, sum(comment LIKE '%sv:%') AS signed
FROM event WHERE type='ci';

SELECT e.objid AS rid,b.uuid AS checkin,datetime(e.mtime) AS date,e.comment
FROM event e JOIN blob b ON b.rid=e.objid
WHERE e.type='ci' AND e.comment LIKE '%sv:%'
ORDER BY e.mtime DESC LIMIT 1;

SELECT f.name,m.pid,m.fid,m.pfnid
FROM mlink m JOIN filename f ON f.fnid=m.fnid WHERE m.mid=?;
```

## Текущие швы миграции

✓ CONFIRMED: read-only explorer `/root/search_architecture` вернул эти bindings;
родитель независимо сравнил SHA256 семи локальных файлов ниже — совпали.
Выводы о поведении по коду имеют статус Inferred, пока не запущен runtime oracle.
CodeGraph ответил по обоим проектам; полный inventory потребителей НЕ получен.

| поверхность | текущая привязка | контракт следующего прохода |
|---|---|---|
| Fossil/SV | `packages/opencode/src/tool/fossilgrep.ts:88-165` | Переиспользовать слой комментариев и changed files; добавить full hashes и типы delta. Текущий display hash 10 символов не годится как ключ индекса. |
| Подпись вектора | `packages/opencode/src/memory/spine.ts:554-567` | Оставить SV в истории; индекс хранит ссылки на источник. |
| Impact | `packages/opencode/src/codegraph/sqlite-pack.ts:68-187` | Контракт symbols/typed edges/coverage/revision. Текущие limits 1200 ID / 4000 edges требуют явного признака неполноты. |
| Tool/MCP | `packages/opencode/src/codegraph/mcp-client.ts:186-276`, `packages/opencode/src/tool/codegraph.ts` | Новый backend возвращает структурные адреса; не переносить text MCP → extraction of paths → повторный SQLite read как обязательную архитектуру. |
| Summary/TUI | `packages/opencode/src/cli/cmd/tui/util/snapshot-symtag.ts:102-158`, `packages/opencode/src/session/compaction.ts:1576-1580` | Сохранить Fossil brief; заменить источник impact; stale/error/unsupported должны отличаться от empty. |
| Universal Search | `D:/zPython/universal-search/src/web/sourcegraph.rs:70-182`, `src/service.rs:845-852`, `src/hybrid.rs:27-107` | Сейчас Sourcegraph Cloud `/search/stream` SSE. Локальному Zoekt нужен отдельный adapter, query translation и нормализация результатов. |

✓ CONFIRMED, health-only probe: `GET http://127.0.0.1:3005/health` → HTTP 200,
`{"status":"healthy","service":"universal-search-service"}`.
Работоспособность отдельного Sourcegraph backend этим НЕ проверена.

## Предлагаемая целевая схема — не реализовано

```text
Fossil check-in + manifest + parent(s) + event.comment/SV
        |
        +-- delta planner (add/edit/delete/rename, ancestry, undo/redo)
        |       +-- Zoekt snapshot/shards: text/regex
        |       +-- language indexer -> SCIP: definitions/references
        |       +-- typed edge store: imports/calls/implements + coverage
        |
        +-- revision/provenance tables (SQLite), keyed hot state (LMDB)
                        |
                 local code-intelligence adapter
                        |
            Universal Search / agent tool / summary impact / UI
```

Предлагаемый минимальный адрес результата:
`repository_id + repository_generation + fossil_checkin_full_hash + file_path +
file_artifact_hash + range + index_generation + indexer/version + coverage + SV_ref`.
Для dirty checkout нужен отдельный content digest и явная метка working state:
его нельзя выдавать за содержимое committed Fossil revision.

Правила следующего binding:

1. Источник контента — выбранная revision/manifest Fossil, материализованная в
   изолированную директорию. Сканирование меняющегося live checkout не доказывает
   согласованность снимка. Исключения, size limits, binary/unsupported files
   входят в manifest coverage; отсутствие результата без coverage неоднозначно.
2. Cursor строится по ancestry и полным hash, не по времени файла. `mlink` одного
   check-in — delta одного ребра; диапазон, merge, undo/redo и смена `.fsl` требуют
   своих проверок. Удаление и rename должны убирать прежние пути.
3. Сначала простой rebuild выбранного snapshot; затем измеренная оптимизация.
   Частичный file set не означает частичную стоимость Zoekt shard rebuild или
   SCIP project indexing. Индексатор языка может требовать всё compilation unit.
4. Новое поколение публикуется только после проверки. Failed/cancelled build
   сохраняет предыдущую рабочую generation с состоянием stale, не с новой revision.
   Никакого update/refetch на критическом пути каждого запроса.
5. SV остаются источником навигации по истории; их можно искать отдельным corpus
   комментариев, отличимым от source corpus. Read-only SV/no-op check-in обновляет
   provenance, не обязан перестраивать тот же text corpus.
6. SCIP symbols и occurrences не равны call graph. Раздельные типы рёбер и
   подтверждённые языковые indexers; Tree-sitter fallback помечает точность и
   unresolved references. Для 1С 7.7 грамматику/разрешение символов надо квалифицировать.
7. Runtime state получает namespaces в существующих SQLite/LMDB planes. `-meta`
   Zoekt может быть generated input, но не новой независимой authority state.
8. Universal Search остаётся общей поверхностью, локальный backend — отдельный
   маршрут; публичный Sourcegraph и локальные репозитории имеют разные адреса.
   Изменения в resident checkout universal-search передаются его владельцу отдельным
   binding; этот проход туда не пишет.

## Оракулы до cutover

| слой | положительный пример | опровергающий control |
|---|---|---|
| text | literal/regex, Unicode, пробелы, file:line | absent sentinel, исключённый файл явно отражён в coverage |
| delta | add/edit/delete/rename, A→B→A, merge | старые shards не принимаются за B |
| symbols | definition/reference конкретного symbol ID | два одноимённых символа разных scope не смешиваются |
| graph | вручную известные typed edges | textual name match не считается вызовом |
| provenance | исторический результат открывает исторический blob | изменённый live file не подставляется вместо старого |
| lifecycle | crash/cancel/restart, смена поколения `.fsl` | cursor новой revision не публикуется при failed build |
| UI/API | indexed/stale/unsupported/error | backend failure не превращается в «0 совпадений» |

Benchmark: фиксированный корпус и queries, cold/full indexing, один check-in,
p50/p95 query/impact, peak RSS, disk, exact result parity. Корпус 5 млн сущностей
пока не выбран и не измерен. Ускорение и полная замена CodeGraph — Unknown.

## Pins локальных источников

```text
tool/fossilgrep.ts 24acd75cefa47db384b6938d691a6f1cf6ac89894c0e3ade16b8d7d2ed3a280e
memory/spine.ts 164dc6cc09458de042753c100f4b2db0d39de609a83aa79dd4e610d752e82cba
codegraph/sqlite-pack.ts f8efef16e8e74d6f6dacfa59f581153983610a60c03ecc444e06e7d12c6ff68f
codegraph/mcp-client.ts a4271f11aedcc33c0002bce995248a1b957e6f00f9d0e4c2edfb76731158ef63
cli/cmd/tui/util/snapshot-symtag.ts 533d317016bfcdf12c81a977a432f4debfd23fb3745cde16c665ac714b404345
plans/2026-09-29_codegraph-impact-decoupling.md 49a949db961ed117e349a9e7fff5534e7d94e62dfbc5434450de0804dfc30d65
plans/2026-10-15_project-fossil-cell.md b77468cc6876c3587337c51247c4a4b76ff919ed3b8c53060cf1bf22ba727671
```

Первые пять путей относительно `packages/opencode/src/`.
C2 существующего impact-decoupling и незавершённая project-cell не закрыты.

## Продолжение

✓ CONFIRMED, document oracle: explorer review выявил и исправлены text diagram,
два адреса и stale plan state. Parent readback: smoke section существует;
Z3 `[x]`, Z1/Z2/Z4/Z5 `[ ]`; семь SHA256 остались прежними.

✓ CONFIRMED, штатный `SVM.applyRender`, run `20261016T095122Z_68af993e`:
exit 0, bytes_written 1184, bytes_dropped 0, truncated false. Полный журнал прочитан.
Missing-marker fixture вернул EXPECTED_FAIL; два render дали один SHA256
`569e207dafdca7e8c1ee03cafb27d2a19e3177dc1bd161d34144703b97d9ee58`,
hand-owned head сохранён, план находится в generated map. Этот промежуточный stamp
ОТОЗВАН после diff: неверный cwd привязал Global.Path.data к package directory,
и 7 существующих manifests превратились в MISSING. Карта охватила 35 планов/145 открытых boxes; чужие задачи
не аудированы на completion/strategy, и общий SUCCESS не заявлен.

✗ REFUTED, первая попытка `bun -e` через cmd_runner, run
`20261016T094941Z_7c55e72b`: exit 1, `Unexpected escape sequence`,
bytes_written 498, bytes_dropped 0, truncated false. Полный журнал прочитан;
launcher исказил кавычки inline JS. Тот же штатный renderer запущен через файл,
без inline quoting, во втором run. Класс ограничения инструмента сохранён:
передача inline JS с кавычками через runner не квалифицирована; runner не исправлен.
Прямой запуск `bun -e` runtime policy отдельно отклонила с явным маршрутом
`Use cmd_runner start -- <binary> instead`; этот разрешённый маршрут использован.

✓ CONFIRMED, исправленный renderer harness: `Global.initFromWorktree(root)`
из `packages/core/src/global.ts:18`, known-present C1 manifest — обязательный
positive control до render. Run `20261016T095324Z_582e25d3`, exit 0,
bytes_written 1226, bytes_dropped 0, truncated false; полный журнал прочитан.
Data root — `D:/zPython/opencode/.opencode/data`. Missing-marker EXPECTED_FAIL,
два SHA256 `b55a5f358bfb376a7ef9f4c27f7693a5942073666454a3aad6528295528b4c72`,
hand-owned head сохранён, 7 manifests восстановлены (missingManifests 145 → 138).
Это документальный PASS после исправления harness, не Zoekt/SCIP acceptance.

Следующий эффект: разрешённое получение двух репозиториев в указанные external/
пути; затем Z1 integrity → Z2 build/index/query fixture с дифференциальными controls.
Текущий отказ относится к effect cloning; runtime отказ не обойдён.
Continuation receipt: [сохранённый ответ отказа](RECEIPTS.md),
readback `targets[].exists=false`; исследование `/root/search_architecture`
завершено с independently matched source hashes. Это receipt остановки, не PASS
клонирования и не активный background follow-up. План остаётся открытым.
