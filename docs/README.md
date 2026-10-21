# Documentation

## Memory / session (canonical)

- [Codex: восстановление и отчёты роботов](codex-hooks.md) — выборка полных первичных текстов по SV, Fossil provenance и адресуемые execution receipts
- [Mechanistic Compaction](compaction.md) — **canonical** Layer-1 summary outside content + Layer-2 compact; прогноз ходов по приросту запросов со стабильным префиксом
- [Summary Exact handles](summary-exact-handles.md) — snapshot anchors (fossil range diff) + tool filediffs + CodeGraph (critical)
- [Session memory graph](session-memory-graph.md) — end-to-end mermaid: cadence vs safety
- [Finish-step TX graph](finish-step-tx-graph.md) — `runBatch` / single SQLite TX at step boundary

## Product / stack

- [DAIS: граф утверждений и проверок](dais-evidence-graph.md) — native Fossil/SCIP/Zoekt, паспорта утверждений, FAIL/STALE и границы доказательства
- [Исследование Haiku 5.5 — 2026-10-16](../experiments_history/2026-10-16_haiku-research/REPORT.md) — live wire, hidden thinking, signed replay, HTTP/2 cancellation; воспроизводители и границы без заявления product fix
- [Контролируемое сравнение Haiku/OpenCode/omp](../experiments_history/2026-10-16_haiku-omp-compare/REPORT.md) — actual CLI capture, восемь payload arms через общий gateway; различие bundle подтверждено, конкретная причина и продолжение остаются открыты
- [Kernel portability — 2026-10-19](kernel-portability-2026-10-19.md) — Gemini Pro with vs without the kernel on one SV (drift vs G0→G9 to SUCCESS), frameless Sonnet contrast, environment labels; evidence in `../experiments_history/2026-10-19_kernel-portability-chat/RESULT.md`
- [Граф reasoning по умолчанию](reasoning-flow.md) — получение, хранение, экран, replay, route-specific потери и границы SDK; срез кода до исправления

- [Отчётность и wiki организации](organization-reporting.md) — входы к паспорту, портфелю, участникам и отчётам Agent Corporation
- [Устав агентной корпорации](organization-charter.md) — роли, продвижение по проверенным результатам, непрерывная память и самостоятельный запуск

- [Rendering Pipeline](rendering.md) — LLM→terminal display, Mermaid font metrics, natural pixels, horizontal viewport, images
- [Architecture](architecture.md) — prompt system, checkpoint, compaction, agents, KV cache
- [Agentic reasoning runtime](agentic-reasoning-runtime.md) — gates, REUSE ladder, claim ledger, host-agnostic SPECS
- [Kernel package](../prompt_kernel/README.md) — gate graph, serialization order, source of the runtime prefix
- [Kernel assembly point](kernel-assembly-point.md) — where `source.py` becomes `reasoning_prompt.txt`
- [Награда кернела](reward-contract.md) — историческая измеренная формула и слагаемое подтверждённого завершения задач
- [Аудит неопределённых контрактов — 2026-10-15](../experiments_history/2026-10-15_kernel-undefined-audit/parent-review.md) — robot candidates, независимая проверка, разные единицы подсчёта и непокрытые ссылки
- [Аудит кернела и addons — 2026-10-12](../plans_completed/2026-10-12_kernel-addons-correctness-audit.md) — K01–K10, воспроизведённые дефекты, полный baseline FAIL и границы поведенческой проверки
- [Ремонт кернела и ADID delivery](../plans/postponed/2026-10-12_kernel-contract-repair-and-adid-release.md) — source fixes проверены; release/install остановлен на delivery harness, доказательства и lift signal сохранены
- [Two-canon protocol](two-canon-protocol.md) — ADID 15.3 ↔ kernel parity: one protocol, two compilers
- [Reasoning mode](reasoning-mode.md) — memory-only calibration identity, no execution surface
- [Reasoning mode as an escape hatch](reasoning-mode-self-diagnosis.md) — self-diagnosis of inference failures: the degeneration trap (arXiv:2512.04419), the measured 2026-09-13 case, the rules and the external levers
- [Mode transitions](mode-transitions.md) — plan↔build↔reasoning: Gate A ACL + `ctx.ask`; `planenter`/`planexit` permission-gated with default allow (Question dialog removed 2026-10-11)
- [System prompt order](system-prompt-order.md) — slot order; any mid-prefix mutation is a full cache miss
- [UNIVERSAL_ENV](system-prompt-universal-env.md) — the immutable `system[0]` head
- [CodeGraph MCP](codegraph-mcp.md) — live graph contract + readonly SQLite pack; per-step cached summary
- [Codebase Memory MCP vs CodeGraph](codebase-memory-mcp.md) — measured 2026-10-10: scope/latency/answer shape, the blind spot BOTH share, and the usage rules that follow
- [Session recovery](session-recovery.md) — portable replay after a moved worktree
- [Run lifecycle semantics](run-lifecycle-semantics.md) — join, supersede, bounded cancel
- [Gate add-ons](gate-addons.md) — advisory path bindings per kernel gate, addon registry, budget guardrails
- [AGI Workflow](agi-workflow.md) — orchestrator/worker loop, plan hygiene
- [Startup & bootstrap](startup-bootstrap.md) — cold start, CodeGraph, Fossil vs git/jj
- [Fossil snapshot system](fossil-snapshot.md) — **canonical** agent undo/redo leaves, полный YAML SV и дорожная карта ответов, extras cleanup, HISTORY_INVALID
- [External File Locations](external-file-locations.md) — where opencode reads/writes files
- [Linux deploy](linux-deploy.md) — Linux build and portable install
- [Tools and sidecars](tools-and-sidecars.md) — `tools/` binaries, Fossil/rg/markdownify
- [Codex semantic-vector chain](codex-svchain.md) — ordered transcript topics and broken links
- [Legislator rebuild](legislator-rebuild.md) — reassemble the delegator's identity from its own SV trajectory when its transcripts are gone: sources, filter, cut, three turns, reincarnation oracle
- [Gateway three-point capture](gateway-capture.md) — intent / wire / response under one exchange key; masking, terminal states, derived views
- [Независимый тест кеша Go/GLM](independent-glm-cache-probe.md) — standalone HTTP-измеритель, локальная квалификация до сети; живой опыт остановлен runtime policy
- [Протокол gateway в TUI](gateway-protocol-status.md) — фактический транспорт, адресация события и значение `unknown`
- [Go/Zen request contract](go-zen-request-contract.md) — проверенные cache options по модели/SDK, оригинальные заголовки, HTTP oracle и границы TTL/FreeTier
- [OpenCode Zen call path](zen-call-path.md) — исторический срез 2026-10-10: каталог → лоадер → SDK → gateway; актуальный ремонт описан в Go/Zen request contract
- [Background Jobs](background-jobs.md) — non-blocking shell jobs, `joboutput` / `pattern`, TUI
- [Claude scheduled tasks](claude-scheduled-tasks.md) — unattended Desktop runs: user-settings `defaultMode: auto` + allowlist works, project settings do not
- [ADID Framework 15.3](ADID_Framework_15_3.md) — safe-update manager contract. Frozen, untracked,
  package-rendered; still the reference standard for kernel design, but only realizable on MHA-class
  attention — see [two-canon-protocol.md](two-canon-protocol.md) § 3 for why it did not port to MLA
- [Kernel tests](../prompt_kernel/tests/) — `python -m pytest prompt_kernel/tests/ -q` (78 tests)


## Governance — the rules live in AGENTS.md, the record here (split 2026-10-13)

- [Bug policy](bug-policy.md) — tests adapt to functionality; contract tests; write-path oracles
- [Plan maintenance](plan-maintenance.md) — MASTER_PLAN renderer, JOB FAILED, commit is not closure
- [Style guide](style-guide.md) — the worked examples behind the TS/Python rules
- [Storage paradigm](storage-paradigm.md) — two planes (SQLite/LMDB), concurrency rationale, engines, migration order
- [Debugging paradigm](debugging-paradigm.md) — read state before logs; hashing is never the suspect; granularity
- [Provider reach](provider-reach.md) — descend from the highest surface: why, per-provider numbers, evidence
- [Upstream relation](upstream-relation.md) — the closed SDK/upstream question; generated vs hand-maintained code
- [Host toolchain](host-toolchain.md) — the measured inventory; what is NOT on this host
- [Build and run](build-and-run.md) — `_build.ps1`, `_run.cmd` from source, the full-suite measurement

Extended in the same split: [architecture.md](architecture.md) (layer table, closed loop, agent inventory), [compaction.md](compaction.md) (continuity owner statement), [content-lifecycle.md](content-lifecycle.md) (owner quote, verb table, corollary, shipped status), [fossil-snapshot.md](fossil-snapshot.md) (backend decision, per-tool evidence), [tools-and-sidecars.md](tools-and-sidecars.md) (unknown apps, cmd_runner debugger), [tool-playbook.md](tool-playbook.md) (no-script constraint, search-instrument quote), [agentic-reasoning-runtime.md](agentic-reasoning-runtime.md) (language slips = G0).
## Measured vendor behaviour

- [Haiku 5.5 adaptive thinking](haiku-adaptive-thinking.md) — исправление классификации модели, SDK wire-регрессия и граница локального доказательства
- [Reasoning round-trip contract](reasoning-round-trip-contract.md) — cross-vendor reasoning field behaviour
- [DeepSeek thinking cache](deepseek-thinking-cache.md) — measured thinking vs prompt cache
- [ChatGPT OAuth cache](chatgpt-oauth-cache.md) — SDK cache key, tool-result replay, and what still needs live measurement
- [StreamLake/KAT thinking cache](streamlake-kat-thinking-cache.md) — measured gateway cache semantics
- [CoT research](cot-reasoning-research.md) — how chain-of-thought length affects task execution
