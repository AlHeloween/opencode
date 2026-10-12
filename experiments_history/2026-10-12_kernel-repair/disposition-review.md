# Disposition review — kernel-repair / ADID delivery

READ-only EXPLORER. Проверена **диспозиция артефактов** (разметка, ссылки, статусы), не implementation.
Source/edit/commit/install не выполнялись. Инструменты: 4 Read + 1 Grep (bounded `docs/README.md;plans`).

```yaml
Keywords: disposition-review 0.35, stale-links 0.25, status-claims 0.25, bounded-evidence 0.15
Semantic dominant: Проверка, что перемещённый план и ADID-доставка описаны непротиворечиво и без ложного SUCCESS.
md5: 3f9a1c7e5b2d4806a1c9e0f4b7d25318
prev-md5: 10d6b502784d4dd5b738ce96afa62817
parent-goal-md5: d86170bc94f642da8b2f03ae5179cd68
```

## Входы (read)

- `plans/postponed/2026-10-12_kernel-contract-repair-and-adid-release.md` — Status **BLOCKED** (:6)
- `experiments_history/2026-10-12_kernel-repair/DELIVERY_STOP.md` — «BLOCKED, не SUCCESS»
- `plans/MASTER_PLAN.md` — hand-owned head + generated body
- `experiments/2026-10-12_kernel-repair/final-parent-readback.json`
- grep `kernel-contract-repair|ADID|release…install` по `docs/README.md;plans`

## Проверено — нарушений не найдено

**1. Нет stale root-path links на перемещённый план.** Все ссылки ведут в `plans/postponed/`:

- `docs/README.md:21` → `../plans/postponed/2026-10-12_kernel-contract-repair-and-adid-release.md` (от `docs/` = `plans/postponed/`) ✓
- `plans/MASTER_PLAN.md:95` → `postponed/2026-10-12_kernel-contract-repair-and-adid-release.md` (от `plans/`) ✓
- Ссылок на старый root-path `plans/2026-10-12_kernel-contract-repair-and-adid-release.md` (вне `postponed/`) в `docs/` и `plans/` — **нет**.

**2. Нигде не утверждается, что ADID release/install прошли.** Формулировки последовательно «остановлено»:

- `docs/README.md:21` — «release/install остановлен на delivery harness, доказательства и lift signal сохранены» ✓
- `plans/MASTER_PLAN.md:95` — «ADID release/install остановлен с сохранённым воспроизводителем» ✓
- план: Status BLOCKED (:6); A1 `[~]` (:58), A2 `[~]` (:59) «installed delivery NOT VERIFIED»; bounded stop (:63) «release/install не завершены» ✓
- `DELIVERY_STOP.md` — «BLOCKED, не SUCCESS» ✓
- `final-parent-readback.json` — `global_success: false` ✓

**3. MASTER generated body — 19 root plans; source goal не менялся.** Строка «This body names all 19 plan(s) under `plans/`». Перемещённый план корректно **отсутствует** в generated map (он в `plans/postponed/`) и присутствует в hand-owned секции «Проверка механических контрактов» (`MASTER_PLAN.md:92-96`), которая ссылается на цель `MASTER_PLAN.md:24` неизменной. Противоречия disposition нет.

**4. JSON pins/readback и 2 unresolved strategy-plans не превращены в accepted full audit.** Readback несёт `global_success: false`, `unaligned: [anthropic-cache-breakpoints, mcps-connector-manager]`, `raw_original_restored: false` — это branch-report, а не закрытие. 15 pins `expected == actual` (source/model/evidence/validate/addons×4, mcp-client.ts, sqlite-pack.ts, explore.txt, reasoning_prompt.txt `bc7d5b8f…`, `.claude/reasoning_kernel.md` `d33326b6…`, codex AGENTS.md `1a3a754c…`, `.cursor mdc` `a3c760ed…`), но каждый — parent self-readback.

## Limitations (этими артефактами НЕ доказано)

- `raw_original_restored: false` — конфиг restore'нут **семантически** (31 rows + window + flags), raw serialization иной; побайтовая идентичность installer config не заявлена и не проверена.
- Граница preservation узкая: 645 файлов (existing skill files + live bin), `preservation_divergence: []` — не покрывает всю receiver-метаданную.
- Портфель: 2 unaligned плана + частичный completion audit («long plans читались sections») → **global SUCCESS запрещён**; аудит не является исчерпывающим current stamp.
- Pins — parent self-readback, не независимая третья сторона; ре-дайджест здесь не выполнялся (вне бюджета brief).
- Generated map перечисляет 19 планов под `plans/` и **не** нумерует `postponed/`-планы; считает ли `masterPlanCoverage` их — не проверено (нужен `util/plan-status.ts`, вне READ-only бюджета).

## Не утверждается

Никакого SUCCESS; ADID release/install **не** доказаны; A1/A2 не завершены.
