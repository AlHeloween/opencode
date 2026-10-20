# Glossary — kernel terms (t90 path: `docs/glossary.md`)

Every `source_ref` is a kernel path:line or a doc, never recall. Every
`content_hash` is the sha256 of the source file the definition was drawn from;
re-hash before citing. A mismatch means the source moved: re-ground the entry.

Kernel source at write time:
`prompt_kernel/source.py`
sha256 `5f58490baa90d048572f391ee90f7474794fcdbd21504b7ea729d30d6ec6b28f`
(123664 bytes, 2026-10-20; re-grounded 2026-10-20 after a measured mismatch — the source moved in commit `8a92646365` «t96 review 2», so the 2026-10-19 pin was stale; two line anchors moved with it. t90/t96 work still pending install).

## Digital Intention

- **Definition.** The user's request understood in their own language as a
  `{from_state, to_state, ambiguity?}` pair. `to_state` is the user's and never
  moves: grounding binds the oracle to it, decomposition splits the path to it,
  revisions keep it fixed.
- **source_ref:** `prompt_kernel/source.py:1032` (state contract
  `DIGITAL_INTENTION`); invariance rule `@INTENTION_INVARIANCE`,
  `prompt_kernel/source.py:192`.
- **content_hash:** sha256 `5f58490baa90d048572f391ee90f7474794fcdbd21504b7ea729d30d6ec6b28f`

## SV (semantic vector)

- **Definition.** An attention fingerprint in `@SV_FORMAT`: 3–9 keywords with
  weights summing to 1.0 (highest first), a one-sentence semantic dominant, and
  generative tags `md5` / `prev-md5` / `parent-goal-md5` plus the verbatim note
  line. Tags are searched, never computed; `md5` values are labels, not
  checksums (never confuse with a digest comparison). A vector is never a claim
  status. The SV transmits intention and shape, not the axes' content — name
  the axes in a dominant (measured 2026-10-19:
  `experiments_history/2026-10-19_kernel-portability-chat/RESULT.md` §5).
  The rule's two halves are now MEASURED apart (n = 1 per arm, 2026-10-20:
  `experiments_history/2026-10-20_sv-axis-falsifier/RESULT.md`): an isolated arm given this
  glossary reconstructed the project's construction — D/C/E aspects, ≥3 legs per aspect, the
  `unique_detection` receipt — 4/4; the same arm with ONLY the axes named in the dominant (no
  glossary) recovered the aspect NAMES and the leg count but not the families, not the
  independence instrument, not the subsumption rule — 2/4; the historical vector alone — 0/4,
  falling back to correlation-based independence. So the GLOSSARY is the load-bearing half:
  naming the axes in a dominant buys at most half of what the term pages buy.
- **source_ref:** `prompt_kernel/source.py:826` (`SV_CONTRACT`, tag
  `SV_FORMAT`); format §1.2 of the rendered kernel.
- **content_hash:** sha256 `5f58490baa90d048572f391ee90f7474794fcdbd21504b7ea729d30d6ec6b28f`

## Degenerate simplex

- **Definition.** A coverage failure: three sources on ONE explanation, or an
  acceptance aspect covered by fewer than 3 independent oracles. The criterion
  stays Unknown on that aspect; the missing legs are recorded as residual.
  Parent and child never count as two sources; independence is measured WITHIN
  one nesting level.
- **source_ref:** `prompt_kernel/source.py:202` (`THREE_ORACLES` rule);
  `prompt_kernel/source.py:545` (`@MEDOID_SIMPLEX`).
- **content_hash:** sha256 `5f58490baa90d048572f391ee90f7474794fcdbd21504b7ea729d30d6ec6b28f`

## Three oracles (aspect vs leg)

- **Definition.** Acceptance is covered only when documentation (meaning), code
  (mechanism) and execution (reality) agree on the criterion. ASPECT names one
  of the three; LEG names one oracle inside an aspect. Each aspect needs ≥3
  independent legs, else a degenerate simplex. An aspect agrees when every leg
  of it passes; a failing leg inside an aspect is itself a divergence.
- **source_ref:** `prompt_kernel/source.py:202` (`THREE_ORACLES` rule);
  stamp shape `prompt_kernel/source.py:1063`.
- **content_hash:** sha256 `5f58490baa90d048572f391ee90f7474794fcdbd21504b7ea729d30d6ec6b28f`

## Unique-detection receipt

- **Definition.** The control that proves a leg is independent: an injected
  defect that this oracle catches and ALL the other legs of that aspect miss
  (an EXPECTED_FAIL control; legs of other aspects do not matter for the
  receipt). Carried as `ORACLE_STAMP.unique_detection:
  {defect, caught_here, missed_elsewhere}`. An oracle without a receipt is
  subsumed and does not count as a leg; where no such defect can be constructed
  the gap is residual and the oracle never counts provisionally.
- **source_ref:** `prompt_kernel/source.py:202` (`THREE_ORACLES` rule);
  `prompt_kernel/source.py:1063` (`ORACLE_STAMP`).
- **content_hash:** sha256 `5f58490baa90d048572f391ee90f7474794fcdbd21504b7ea729d30d6ec6b28f`

## Oracle family catalogue (D1–5, C1–5, E1–5)

- **Definition.** The default catalogue legs declare their family from; three
  legs from DIFFERENT families of one aspect (two legs from one family are one
  leg). Documentation (meaning): D1 requirements traceability (ISO/IEC/IEEE
  29148); D2 executed procedure with per-step capture (26514; 1063 superseded
  by 26512); D3 executable examples against schema/API; D4 frameless reader
  teach-back; D5 doc ↔ contract diff. Code (mechanism): C1 static analysis /
  types; C2 structural graph; C3 mutation testing; C4 invariants / contracts /
  property-based tests; C5 independent diff review. Execution (reality): E1
  persisted-state read-back; E2 observed output vs prior prediction; E3
  end-to-end on real data; E4 outside measurement / telemetry; E5 differential
  / back-to-back. A doc that is only read is not a leg.
- **source_ref:** `prompt_kernel/source.py:202` (t96 kernel text, pending
  install); pinned by `prompt_kernel/tests/test_three_oracles.py:61`
  (`test_catalogue_families_present`).
- **content_hash:** sha256 `5f58490baa90d048572f391ee90f7474794fcdbd21504b7ea729d30d6ec6b28f`

## EVOLUTION_LOOP

- **Definition.** The self-triggered protocol for proposing measurable
  improvements when work closes, stalls, or has no straight goal — a proposal,
  never a question to the owner, serving the same `to_state`. Triggers:
  `@CENTRAL_TASKS` exhausted, or undirected conversation with ≥10 messages of
  history. Selected evolution enters G1 as a new goal; a toolchain/framework /
  language / arch-family change needs fresh G4 authorization.
- **source_ref:** `prompt_kernel/source.py:782` (`EVOLUTION_LOOP` protocol,
  rules `SELF_TRIGGER_A` through `MIGRATION_PROTOCOL`).
- **content_hash:** sha256 `5f58490baa90d048572f391ee90f7474794fcdbd21504b7ea729d30d6ec6b28f`

## Ideal Final Result (IFR / ИКР)

- **Definition.** A model of the best solution to an inventive problem, whereby the problem is fully eliminated with minimal changes to the system and without any deterioration of system parameters; the mechanism disappears while the function is performed.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/ariz-5892/ideal-final-result-5922/; https://triz.org/ideality/
- **content_hash:** sha256 `058ea11b3f916f41ec39c5b2602109cef020e04a2d8b98cedb3cbe46a8136542` (MATRIZ glossary) / `c5d917546d3ed50d85367d9b9f5e92c83e4b7e0c6273ef1df4b96ea1d497f9d1` (triz.org)

## Engineering Contradiction (EC / Техническое противоречие)

- **Definition.** A parametric model of the problem in which an attempt to improve one parameter of the engineering system leads to worsening of another parameter.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/contradictions/engineering-contradiction-5995/
- **content_hash:** sha256 `058ea11b3f916f41ec39c5b2602109cef020e04a2d8b98cedb3cbe46a8136542` (MATRIZ glossary)

## Physical Contradiction (Физическое противоречие)

- **Definition.** A parametric model of the problem that emerges when two justified contradictory demands are placed upon a single parameter of an object to provide the required result.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/contradictions/physical-contradiction-6056/
- **content_hash:** sha256 `186bb13c986c8c4a76a04159268f103d1330549547bff501a6d1e084653f0322`

## ARIZ (АРИЗ)

- **Definition.** A problem-solving tool that transforms a complex key problem into a well-defined model of the problem, which can be solved effectively using a wide spectrum of TRIZ tools; ARIZ-85C contains nine steps.
- **source_ref:** https://triz.org/ariz/; https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/ariz-5892/
- **content_hash:** sha256 `0be9eaf11d038b20aea498ec44658a1b9d46411040e22ebc8887bac5d83b79a1` (triz.org)

## 40 Inventive Principles (40 принципов)

- **Definition.** Generic suggestions for performing an action to/within a technical system, discovered by Altshuller through analysis of thousands of patents; used to resolve engineering contradictions via the Contradiction Matrix.
- **source_ref:** https://triz.org/principles/
- **content_hash:** sha256 `f59b4969d67ba6f259d0826c5d2113110fee72c876b45901a704600df76a9e70`

## Contradiction Matrix (Матрица противоречий / Altshuller Matrix)

- **Definition.** A matrix providing systematic access to the 40 Inventive Principles for solving engineering contradictions; 39 typical parameters on each axis, cells contain principle numbers.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/contradictions/engineering-contradiction-5995/contradiction-matrix-6026/
- **content_hash:** sha256 `aaebc53f113f96570af1e370d6bb1eece6f943da7b53a8a7784629c8c7c2d946`

## Trends of Engineering Systems Evolution (TESE / Тренды эволюции технических систем)

- **Definition.** Statistically proven or empirically derived directions of engineering system development describing natural transitions; 11 trends in a hierarchy topped by S-curve evolution.
- **source_ref:** https://wiki.matriz.org/docs/triz/trends-of-engineering-systems-evolution-tese-5919/
- **content_hash:** sha256 `21188c37531e810b4b0ede82493e35461777da382024378cf0e1a59c31640788`

## S-curve (S-кривая)

- **Definition.** An S-shaped curve representing the typical dependence of a main parameter of value (MPV) of an evolving engineering system on time; 4 stages: birth, growth, maturity, decline.
- **source_ref:** https://wiki.matriz.org/docs/triz/trends-of-engineering-systems-evolution-tese-5919/trend-of-s-curve-evolution/s-curve/
- **content_hash:** sha256 `c53192c6c0e5e11566f3a18e7d205b384f181f16bf255e196e582631601ffaab`

## Resources in TRIZ (Ресурсы в ТРИЗ)

- **Definition.** Inventive resources (substances, energy, time, space, information, functional ability — internal/external/supersystem, readily-available/derived) and evolutionary resources (knowledge, patents, rejected ideas, technology transfer potential).
- **source_ref:** https://wiki.matriz.org/docs/triz/resources-in-triz-7018/
- **content_hash:** sha256 `aea753a54882bcabb05d9f840d37841d906ddbe307e812c09c64978e78462f0b`

## Su-Field Modeling (Су-полное моделирование)

- **Definition.** Abstract problem/solution model: 2 substances (objects with rest mass) + 1 field (entity without rest mass transferring interaction); processed via 76 Standard Inventive Solutions.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/substance-field-modeling/
- **content_hash:** sha256 `ee6a020ecf5c8a395b60ce03205090394034fb9b24480d48748d9f518e674bdf`

## Standard Inventive Solutions (SIS / Стандартные изобретательские решения)

- **Definition.** A set of 76 typical solution models for typical Su-Field problem models, organized in 5 classes.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/substance-field-modeling/standard-inventive-solutions/
- **content_hash:** sha256 `ee6a020ecf5c8a395b60ce03205090394034fb9b24480d48748d9f518e674bdf` (Su-Field page)

## Levels of Innovation (Уровни изобретательства)

- **Definition.** 5 levels: 1=routine optimization, 2=minor contradiction resolution, 3=advanced same-field, 4=cross-field synthesis, 5=breakthrough new principle.
- **source_ref:** https://triz.org/levels/
- **content_hash:** sha256 `f59b4969d67ba6f259d0826c5d2113110fee72c876b45901a704600df76a9e70` (triz.org domain)

## Trimming (Усечение)

- **Definition.** Improving an engineering system by removing components and redistributing their useful functions among remaining/supersystem components while preserving quality/performance.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5807/trimming-6398/
- **content_hash:** sha256 `058ea11b3f916f41ec39c5b2602109cef020e04a2d8b98cedb3cbe46a8136542` (MATRIZ glossary)

## Function Analysis / Function-Cost Analysis (Функционально-стоимостной анализ)

- **Definition.** Analytical tool identifying functions, characteristics, costs of system/supersystem components; Function-Cost diagram (function points vs cost).
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5807/function-analysis-5611/
- **content_hash:** sha256 `058ea11b3f916f41ec39c5b2602109cef020e04a2d8b98cedb3cbe46a8136542` (MATRIZ glossary)

## Cause-Effect Chain Analysis (CECA / Причинно-следственный анализ)

- **Definition.** Analytical tool building cause-effect chains from initial disadvantage to fundamental causes; key disadvantage at root selected for elimination.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5807/cause-effect-chain-analysis-5817/
- **content_hash:** sha256 `058ea11b3f916f41ec39c5b2602109cef020e04a2d8b98cedb3cbe46a8136542` (MATRIZ glossary)

## Database of Scientific Effects (База научных эффектов)

- **Definition.** Collection of physical/chemical/biological effects organized by function-oriented taxonomy for solving key problems modeled as functions.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/database-of-scientific-effects/
- **content_hash:** sha256 `ee6a020ecf5c8a395b60ce03205090394034fb9b24480d48748d9f518e674bdf` (Su-Field/ARIZ pages)

## Feature Transfer (Перенос признаков)

- **Definition.** Analytical tool for improving a base system by transferring features from an alternative/competing system with complementary advantages/disadvantages.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5807/feature-transfer-7060/
- **content_hash:** sha256 `058ea11b3f916f41ec39c5b2602109cef020e04a2d8b98cedb3cbe46a8136542` (MATRIZ glossary)

## Operating Zone / Operating Time (Зона/Время действия)

- **Definition.** ARIZ: physical space (zone) and time interval where a contradiction requirement must be met.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/ariz-5892/operating-zone/; https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/ariz-5892/operating-time/
- **content_hash:** sha256 `0be9eaf11d038b20aea498ec44658a1b9d46411040e22ebc8887bac5d83b79a1` (triz.org ARIZ page)

## X-factor (X-фактор)

- **Definition.** ARIZ: any change in the engineering system (components, parameters) that should be incorporated to solve the problem.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/ariz-5892/x-factor/
- **content_hash:** sha256 `0be9eaf11d038b20aea498ec44658a1b9d46411040e22ebc8887bac5d83b79a1` (triz.org ARIZ page)

## Mini-problem (Мини-задача)

- **Definition.** A problem whose solution is constrained against significant changes to the analyzed engineering system.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/ariz-5892/mini-problem/
- **content_hash:** sha256 `0be9eaf11d038b20aea498ec44658a1b9d46411040e22ebc8887bac5d83b79a1` (triz.org ARIZ page)

## Conflicting Pair (Конфликтующая пара)

- **Definition.** ARIZ: a pair of components (tool and product) whose interaction causes the conflict preventing the required result.
- **source_ref:** https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/ariz-5892/conflicting-pair/
- **content_hash:** sha256 `0be9eaf11d038b20aea498ec44658a1b9d46411040e22ebc8887bac5d83b79a1` (triz.org ARIZ page)

## Law of Ideality / Law of Increasing Value (Закон идеальности / Закон возрастания ценности)

- **Definition.** Systems evolve toward higher ideality (benefits/costs ratio) and increasing value; ideality = total benefits / sum of all payment factors (costs, space, harm, maintenance).
- **source_ref:** https://triz.org/ideality/; https://wiki.matriz.org/docs/triz/trends-of-engineering-systems-evolution-tese-5919/trend-of-increasing-value/
- **content_hash:** sha256 `c5d917546d3ed50d85367d9b9f5e92c83e4b7e0c6273ef1df4b96ea1d497f9d1` (triz.org) / `21188c37531e810b4b0ede82493e35461777da382024378cf0e1a59c31640788` (TESE page)

## Nine Windows (Девять окон)

- **Definition.** 3×3 matrix (system/subsystem/supersystem × past/present/future) for problem analysis and forecasting.
- **source_ref:** https://en.wikipedia.org/wiki/TRIZ (See also: Nine windows)
- **content_hash:** sha256 `c6a399d121a143162118f46895a57599a9be2d087f18f142fb45d229e3aefdd5` (Wikipedia TRIZ page)

## DAIS (Digital Autonomous Agentic Syndicate)

- **Definition.** The owner's name for the organization of autonomous agents
  (robots on several model families, the Legislator, human owner) that works
  from a set Digital Intention through the kernel's gated protocol. Its members
  are qualified configurations, each with an applicability passport. Work is
  verified by independent three-by-three oracles, never by its executor. Shared
  memory lives in Fossil (org and project repositories) and in the glossary.
  The expansion is the owner's working name, «not exact but close».
- **source_ref:** owner, 2026-10-20, verbatim: «DAIS это именно Digital
  Autonomous Agentic Syndicate это надо бы добавить в определение. Все равно не
  точное то хотябы близко.» The charter of the organization is
  `docs/organization-charter.md` («Agent Corporation»).
- **content_hash:** sha256 `0cdc7aa0fea6fbc467e61b9b5323a27076ac3f3a05077a90846ccc2b610f5a27` (charter)
