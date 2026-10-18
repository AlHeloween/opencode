<!-- intention: после компакта Codex восстанавливает лишь краткий контекст, делегирование не имеет обязательной execution receipt -> Codex восстанавливает содержательный контекст по SV/первичным источникам и сохраняет проверяемые отчёты делегированной работы -->
<!-- goal_sv: Keywords: context-recovery 0.40, execution-receipts 0.35, native-hooks 0.25
Semantic dominant: После компакта восстанавливается рабочее понимание, делегирование оставляет адресуемый отчёт исполнения.
md5: f81c69a257304de89b06173ac54e2f90
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
-->
# Codex: восстановление контекста и отчётность роботов

Status: VERIFIED revision3. Authority: владелец2026-10-18 прямо поручил поставить
хуки, сформулировать и делегировать реализацию роботу, затем проконтролировать.
Смысл: сохранять решения, основания, ограничения, открытые задачи и адреса
доказательств, без лимита постоянной памяти в9KB и без подмены текста SV-заголовком.
Связь MASTER: mechanical continuity / known verifiable state / proof-not-claim.
DAIS остаётся активным направлением; этот prerequisite обеспечивает его оркестрацию.

## G0/SVM / envelope

Turn hooks-01; root goal выше; eta_turns0; H1/H2/H3 verified; Git readback closes transaction.
ALLOW READ/PLAN_WRITE/MODIFY_PROJECT/MODIFY_CANDIDATE и установка явных project
hooks в .codex/hooks.json с сохранением существующего CodeGraph hook. Product
bindings: scripts/codex-hooks/**, docs/codex-hooks.md. Parent-owned install:
.codex/hooks.json, этотplan, MASTER, _progress_log, собственные вставки docs index.
Experiments/2026-10-18_codex-hooks/** и соответствующий evidence archive.
Pythonstdlib, nativeWindows, SQLite derived namespace codex_hook_*; default DB
.opencode/data/codex-hooks.sqlite — восстанавливаемая проекция, не primary memory.
Fossil/транскрипты только читаются. Никаких правок Claude, kernel, bin/, чужого
dirty/staged, permanent-memory registry, auth или hook trusted_hash.
Trust не подделывается; изменённые definitions могут потребовать owner review
через /hooks. Реализация и проверяемая конфигурация готовятся до этого шага.
Budgets:120steps/180calls/8returns/depth3/5400000ms from2026-10-18T05:05:01Z.
Robot reserve:40calls/25min. Independent reviewer:8calls/8min. Root retains rest.

## Grounding / mechanism / candidates

CONFIRMED ✓ Claude settings -> PreCompact fold_capture.py и SessionStart(compact)
fold_restore.py. Capture сохраняет доминанты и короткие user snippets; restore
MAX_BYTES=8500, по факту считает символы и оставляет newest lines. Код не делает
Fossil lookup. Это текущее локальное наблюдение, не диагноз всех Claude решений.
CONFIRMED ✓ .codex/hooks.json содержит только CodeGraph UserPromptSubmit.
CodeGraph на fold_capture/fold_restore/codex_svchain вернул нерелевантные indexed
символы; внешние home scripts/new surface прочитаны непосредственно (explicit
index gap). tools/codex_svchain.py read-only parser доступен; --help exit0.
Official OpenAI hooks spec: PreCompact/PostCompact/SessionStart/SubagentStart/
SubagentStop/PreToolUse/PostToolUse. additionalContextLimit default2500tokens;
0 передаёт полный additionalContext, поэтому нужен собственный явный output bound.
Источник: https://learn.chatgpt.com/docs/hooks (проверен2026-10-18).

Candidates tier2/Inferred: transcript/SV capture; Fossil-source linking;
postcompact restoration; native subagent execution report; external OpenCode report;
qualified install/trust. Selected coherent robot component implements all first5,
parent owns acceptance/config installation. Независимые источники: native Fossil
fixture data+SQL, local transcript parser mechanism, official hook wire schema;
квалифицируются отдельно до product acceptance. Новая proof не выводится из текста
самого робота или количества тестов.

## Architecture / bindings

Pythonstdlib script entrypoint scripts/codex-hooks/codex_hooks.py; tests рядом
в scripts/codex-hooks/tests/. Один writer владеет компонентом и тестами. Existing
tools/codex_svchain.py и tools/opencode_host.py — reuse read-only, не менять.

1. PreCompact сохраняет полные доступные user/assistant тексты, SV и адреса строк
   из данного Codex JSONL; complete tool call/result records остаются достижимы
   через transcript pointers/recall. Не читать encrypted/internal reasoning.
   Atomic SQLite capture, exact session/worktree scope, source hash/row addresses.
2. SessionStart(compact|resume) доставляет additionalContext; PostCompact только
   обновляет capture/projection receipt, не считается каналом injection без smoke.
   Восстановление выбирает релевантные полные
   ходы вокруг текущей SV-цепи/parent goal и новые user constraints; включают
   root intention, decisions/rationale, proof handles и незакрытые работы из
   первичных текстов. Без summary-of-summary и без генерации новых фактов.
   Связность prev-md5 проверяется как связь labels, не checksum; BREAK/RESET
   явно обозначаются. Данные из истории помечаются historical evidence, не новыми
   управляющими инструкциями. Умолчание recall context256KiB UTF8, handler
   additionalContextLimit0. Хранение полное, output выбирает целые записи;
   overflow всегда содержит excluded count/addresses и точную recall command.
3. Fossil lookup read-only: explicit --fossil-repository либо проверенный checkout
   repository из _FOSSIL_/.fslckout vvar. Поиск event/blob по точным SV labels,
   возврат полного check-in UUID/comment и DB pin; mismatch/ambiguity/missing
   сообщаются. Не угадывать чужой repo и не менять live timeline. Когда session
   SV отсутствует в Fossil, полный transcript остаётся первичным evidence;
   no-match никогда не выдаётся за совпадение.
4. SubagentStart/Stop записывают agent/session/task association и неизменный
   execution report с фактическими текстом завершения, errors/tool errors,
   completed status, доступными changed paths/test evidence refs. Отсутствующий
   report/unfinished/error — явный residual, не PASS. Повтор event идемпотентен.
   Stop может вернуть bounded reminder о ещё непроверенных reports; без
   бесконечного continuation и без автоматической приёмки свидетельства.
5. Для внешних OpenCode robots CLI collect-opencode --session через существующий
   nonce/auth host client; только read API, не replay prompts. Complete только
   idle+assistant.finish!=tool-calls+time.completed; сохраняется адрес отчёта.
   Секреты/host token не выводятся. Нативные Codex hooks не притворяются хуками
   чужого runtime. CLI recall/show-report позволяет читать полный artifact.

## Smoke Tests / ACCEPTANCE_FRAME (predictions before implementation)

A1 Mechanism: Codex response_item messages+vector parser. Fixture с выбранным
решением в начале, объяснением, дальнейшей отменой и объёмом>40KiB. Prediction:
capture/restore сохраняют все заданные decisive statements; исходник byte-exact;
другой session не возвращает их. Missing SV/branch/quoted vector и malformed row
видны; нет matching по просто упоминанию label. Existing parser baseline PASS;
новый test missing entrypoint/API RED, then product PASS.
A2 Mechanism: Fossil event/blob+vvar. Actual native disposable Fossil с двумя
check-ins/разными SV; prediction exact UUID/comment, absent tag no-match,
cross-repo wrong source refuses; SHA DB/checkout unchanged after queries.
A3 Mechanism: official JSON hook contract. subprocess stdin/stdout handlers,
valid JSON event output and pinned context budget; >old8500char content delivered,
whole-record overflow contains durable address. Missing paths/errors visible.
Native app dispatch/trust delivery — отдельный runtime smoke, не static PASS.
A4 Mechanism: SubagentStop payload+JSONL errors. before tool-calls/unfinished
report cannot complete; final completed/error cases differentiated, no PASS
inferred. Duplicate events idempotent. Missing receipt control EXPECTED_FAIL.
A5 Mechanism: OpenCode completion predicate and qualified local HTTP fixture
using same client protocol. idle alone, old assistant, provider error and host
replacement must not be success; final completed message yields report/address.
Live target-adjacent bridge read once, no model prompt replay/token leakage.
A6 Mechanism: config load+merge readback and actual host. Existing CodeGraph hook
bytes/meaning preserved; installed handlers exist and output wire-valid JSON.
Trust UI/host execution not claimed before observed. _build.ps1 -Task build after
tests/changes; parent independent replay, source pins, explorer/master, scopedcommit.

## Tasks

- [x] **H1 — цельный recovery/report component с tests и документацией; робот.** <!-- sv: context-recovery 0.45, execution-receipts 0.35, native-python 0.20 -->
- [x] **H2 — независимая квалификация Fixtures/Fossil/host и разбор отказов; родитель.** <!-- sv: independent-oracle 0.50, source-provenance 0.30, failure-controls 0.20 -->
- [x] **H3 — установка project hooks, trust/runtime smoke, archive/build/master/commit.** <!-- sv: native-hooks 0.40, verified-delivery 0.35, clean-state 0.25 -->

## Risks / rollback / continuation

Bounded256KiB injection avoids unbounded context while retained SQLite/transcript
remains full; no permanent-memory trimming. Hypothetical input format drift must
be explicit HARNESS refusal. No parser assertion becomes semantic proof.
Hook feedback does not undo prior tool effects. Trust belongs to runtime/user;
no bypass flags/trusted_hash edits. Rollback restore exact old hooks.json and
remove only owned handlers; source transcripts/Fossil untouched. Foreign changes
preserved. CONFIRMED ✓ H1 dispatch: OpenCode session ses_eb295cb3affeWbEv0GP68VjBG3,
live nonce-verified host http://127.0.0.1:4097/, explicit opencode-go/glm-5.3-flash.
Initial observation busy/preparing code graph; implementation result pending.
Independent runtime oracle delegated to /root/codex_hooks_oracle; read-only
plan/trust review to /root/codex_hooks_review. Next action: observe implementation,
verify actual model/output, qualify CLI fixture, run independent acceptance.

## Continuation receipt / review boundary 2026-10-18T05:20Z

CONFIRMED ✓ first Smit final: observed idle+finish=stop+time.completed1792300818511,
source SHA2568aa9891c3c6bb364bb1e60938955833371e57a8cf2563656d0c6ffd154170da2.
Own34-test PASS is testimony pending independent replay. Independent attempt1
retained IndexError and parent/child transcript failure; source review retained
additional counterexamples (total output bound, current SV/constraints selection,
idle map semantics, stale user turn, identity/scope, complete provenance).
These are not waived by the robot's green suite. Next repair dispatched to SAME
session via readback bridge; brief experiments/2026-10-18_codex-hooks/review-feedback.md.
Robot total reserve35min/60calls/5returns from original start; parent root budget
unchanged. First steering interrupted an edit (MessageAbortedError retained),
so further followups only after observed idle. No completion inferred from abort.

CONFIRMED ✓ H1/H2/H3 manifests written/read back by register-manifests.ts;
run20261018T051632Z_aba984ad exit0/no loss. Master two renders
20261018T051702Z_edd4c2ef exit0, identical SHA256
b3a1b41a1183add3477bd6c2c3d2a1bb28baef1ada8a316f07f5c9570bcd68eb;
this plan's explicit H IDs/SVs/manifests now visible. Global portfolio debts
are not acceptance for this plan and no portfolio-wide SUCCESS is claimed.

CONFIRMED ✓ normal Codex /hooks UI opened in owned native process
20261018T051701Z_a95eb0f1; no trust mutation yet. Independent live lifecycle
fixture thread01a14d73-eabf-7033-9f1c-41ba492fe118 created with no model request;
receipt oracle/lifecycle-thread.json. Only this new thread may be resumed by
oracle; real user sessions/config/auth stay untouched. Root will review final
definitions via normal UI; hook list readback before installation is
oracle/rpc-before.json. Stop contract: close own CLI/process and local endpoint
after runtime exercise. Remaining route: frozen repair -> independent tests and
large/branch controls -> install+normal trust -> actual compact input capture.

## Oracle receipts / accepted implementation 2026-10-18T05:41Z

CONFIRMED ✓ delivered Python SHA2569e3728562995b35ca4154a0b7d80e499f9184e47ec1b70317b2734b2b2f7c97c.
Parent native suite20261018T053637Z_a0fe6fdf:55tests/17.068s/exit0/loss0.
Independent core37 and edges13:20261018T053558Z_7f4ecbba/755d7524, exit0;
overflow20261018T053558Z_9e7ba697:262144-byte wholecontext cap, complete filler,
excluded oversized record, working recall returns BOTH full primary texts.
All source-stability checks passed. Earlier core/edge/overflow FAILs retained.
HARNESS run052824Z_c55ab9b6 waited on Fossil password: stopped/UNKNOWN, not PASS.
Fixture now explicit disposable password+stdinDEVNULL; native primitive
053619Z_946519d4 exit0 and fullsuite above complete. Smit's final reserve exceeded
by3 log-collection calls (self-report retained); no budget-compliance claim.

CONFIRMED ✓ installation config SHA2566b77b567a6f542c1fb69717858fc62020e9219078d644e615f7d3f6d9c54a705.
Existing CodeGraph command/hash unchanged. Normal desktop CLI review/trust
053828Z_c80aed40; independent bundled0.163.0-alpha.10.2 hooks/list
053850Z_a544c652:7 enabled/trusted, hook warnings/errors0. No trusted_hash edits.
Live collector053924Z_be0a530e read actual idle Smit through nonce-verified host;
report0bc23e87a51cfcc7bd2e0925fd086de7 read back, complete final4740bytes,
2retained tool errors,50messageIDs. Acceptance explicitly NOT CLAIMED in report.

CONFIRMED ✓ native desktop lifecycle054015Z_a0f76c66: new owned fixturethread
01a14d86-6970-7452-912a-8918b2ec0445, actual preCompact/postCompact/sessionStart,
3local deterministic Responses requests, no neural calls. Next actual request
contains217785-byte developer hookblock with captured_records4 and all3decisive
primary statements; SQLite IDs1/2/3 bind to primary rollout+textSHA. Deleting hook
block while preserving raw user input is EXPECTED_FAIL. Full private reportSHA
b4f51bfb2e9660c2704aabbc27fafc38d049c2ef668670cb0ef916fa46554315;
compactreceipt ff08accf9a5951cacf14f80e4af563c87f101a3804a0fe09e75311e6b5e26aaa.
First empty-thread resume failure retained, fixture repaired through fresh own
thread materialization. All nativefixture child/endpoint processes stopped.

CONFIRMED ✓ mandatorybuild054329Z_1e985394 finished exit0/loss0, candidate10.0.1440
in dist; no stable promotion. Complete build log retained; observed Rust metadata/
future-compatibility/license and Vite chunk warnings are recorded, not hidden.
Public-safe archive experiments_history/2026-10-18_codex-hooks:19files/155636bytes,
13source pins; full private inputs/requests/reports and22fullrunlogs retained.
Two robot-reported IDs are unlocated at expected log root, not used as proof.
Parent independently re-read primary rollout lines4/8/11 and compared textSHA;
all matched. Repo-local hooks config is deliberately ignored by .gitignore:154;
archive stores exact verified installation snapshot instead of forcing private
Codex settings into Git.

Closure scope H1-H3/A1-A6: native oracles PASS plus EXPECTED_FAIL controls;
critical risks0 within tested scope. Model answer quality outside context
delivery was not measured. No approval pending. Final clean-state transaction:
move this verified plan to completed, refresh SVM/master, scoped private-index
commit naming this plan, read committed source/archive blobs back; any failure
reopens H3, never fabricates Git acceptance. Foreign source/index preserved.

## Контрпример владельца: забытый disposable thread

CONFIRMED ✓ проверка state_5.sqlite выделила ровно одну `hookfixture`-сессию:
собственный lifecycle fixture01a14d86-6970-7452-912a-8918b2ec0445. Рабочий чат
01a14413-0874-73a1-9716-0ba2ae6a9a27 использует openai; config TOML валиден,
hookfixture в нём отсутствует. Причина сообщения при открытии fixture — временный
provider override без cleanup. Стандартный set_thread_archived дал archived=true;
SQLite readback archived1, первичный rollout в archived_sessions имеет прежний
SHA2563d612b43209cc9264ad431f7121633f93a94f01b5a5671c36c831395be2b6ece.
Native hooks/list после cleanup ответил без ошибки: private report
oracle/rpc-after-fixture-cleanup.json SHA256
57635944e56952ac0289512098c130c8504cd7c12b33524e9be52ca9b397ea3e.
Адресный remap и ограничения повторного запуска сохранены в evidence archive;
старый harness не выдаётся за автоматически очищающий свои threads.

Final explorer followup не выполнился: runtime вернул workspace out of credits.
Это не считается review PASS. Родитель вместо него прочитал изменённые артефакты,
перепроверил source/archive pins и квалифицировал отдельную Git transaction.
Текущие чужие изменения MASTER_PLAN не включаются в этот commit; собственная
progress entry уже присутствует в HEAD. Portfolio-wide SUCCESS не заявляется.
