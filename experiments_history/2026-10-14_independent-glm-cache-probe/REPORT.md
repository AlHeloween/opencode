# Независимый измеритель кеша GLM — квалификация

```yaml
Keywords: independent-probe 0.40, fixture-evidence 0.35, live-blocker 0.25
Semantic dominant: Отдельный HTTP-измеритель квалифицирован, живые запуски отклонены runtime policy.
md5: 137bacf5f0894d02817d6ba342c956e0
prev-md5: 00000000000000000000000000000000
parent-goal-md5: c85276a390ed4bfda1207e68543f9c02
```

## Подтверждено инструментами

- ✓ CONFIRMED (parent runner 20261014T084252Z_4ab19fe2): 15 проверок,
  exit0, 0.870s; bytes_written2608, dropped0, truncatedfalse.
  Полные state/stdout: `qualification/`. Проверяется настоящий loopback HTTP,
  полученные байты и заголовки, usage, пропажа кеша по известному независимому
  таймеру фикстуры, негативные ответы и partial readback.
- ✓ CONFIRMED (parent CLI dry-run + readback): `dry-run-control/report.json`
  содержит completed/dry_run, observations=[], request_body.bin побайтно равен
  control.json. Отсутствие сети/чтения auth дополнительно проверено тестом.
- ✓ CONFIRMED (source review + fixture): только stdlib, без OpenCode imports,
  environment proxy/redirect/retry; неизменные байты, стабильная session affinity,
  отдельные request IDs. Код не выводит credential. Серверное отражение известного
  ключа и malformed auth включены в отрицательные тесты.
- ✓ CONFIRMED (parent runner 20261014T084439Z_c55b15a0): обязательная сборка
  exit0, bytes_written50299, dropped0, truncatedfalse; dist candidate10.0.1330,
  native --version и embedded reasoning_prompt smoke PASS. Полный лог `build/`.
  Предупреждения Rust future incompatibility syn0.11.11 и frontend chunk>500kB
  сохранены в исходном логе; они не являются квалификацией времени жизни кеша.

## Неполученные данные

Обе команды запуска live-control/live-retention отклонены CreateProcess:
`blocked by policy`. У automatic review нет более подробной причины в результате.
Процессов/run IDs/директорий live нет, запросов0. Свидетельство:
`live-launch-rejection.json`. Другой способ запуска для обхода отказа не использован.

Measured TTL=Unknown; эффект retention=Unknown; ни один live cache hit/miss не
придуман. Ответы локальной фикстуры не используются как доказательство Go/GLM.
Lift: runtime допускает уже разрешённый пользователем credentialed HTTPS опыт.

## Использование и продолжение

Полная инструкция: `docs/independent-glm-cache-probe.md`.
`cache_probe.py --help`; локальная проверка: `python -m unittest -v test_cache_probe.py`.
Существующие control/retention тела не переиспользовать для нового холодного опыта:
новый опыт получает собственные префиксы и ключи. Ни одна пара affinity не
устраняет routing альтернативу автоматически. Полученные cache/TTL headers —
advertised; KV lifetime не выводится из CDN/HTTP cache-control.

План: `plans/postponed/2026-10-14_independent-glm-cache-probe.md`.
Исходный scratch сохранён в experiments/, архив копирует проверенные байты;
pycache и scratch runtime не архивируются. MANIFEST.json перечисляет артефакты
с SHA256; Git blob readback проверяется отдельно при scoped commit.
