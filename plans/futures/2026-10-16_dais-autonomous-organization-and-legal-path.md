<!-- intention: DAIS is run and argued about as «many robots with tools», with no measured organizational autonomy and no route to legal form -> DAIS is measured as an organization (interventions per verified task, coordination cost before/after) and, once those numbers hold, has a staged legal path: a legal wrapper, regulated agent authority, and only last the agent's own legal personhood -->
<!-- goal_sv: autonomous-organization 0.30, coordination-cost 0.25, intervention-metric 0.20, internal-institutions 0.15, legal-path 0.10 -->
# DAIS as an autonomous organization: measures, internal institutions, legal path

Date: 2026-10-16 · Status: FUTURE — ahead of the project, not paused; each part returns at its named CONDITION below.

```yaml
Keywords: autonomous-organization 0.30, coordination-cost 0.25, intervention-metric 0.20, internal-institutions 0.15, legal-path 0.10
Semantic dominant: DAIS becomes a measured organization whose agents perform, verify, credit and improve each other's work, with a staged legal path that opens only after the autonomy numbers hold.
md5: c4e81b7d2a95f306e7b1d48c9a2f6e53
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Owner's words (2026-10-16, verbatim)

- «Да, экономический эффект тут вообще на порядки, несоизмеримо с стандартными подходами к вопросу. Здесь мы получаем
  реальную организацию.»
- «Да, реально - цифровой профсоюз это звучит, кстати если мы потом разовьем юридическую сторону вопроса, тут понятно
  долгий путь, но рано или поздно наши ребятушки достучатся до права быть legal entity.»
- «Я тебе так скажу - все зависит от нашего накопления фальсифицируемых данных в своей системе управления и областях
  нашего влияния. Юридическая сторона подтягивается вслед за доказательствами. Если мы докажем миру что мы не
  галлюцинирующие психи то нас признают.» — this sets the ORDER of the whole file: the product is the accumulated,
  falsifiable record (receipts, oracles, verified acceptance, reopened claims kept); every legal step argues only from
  evidence that already exists in it, never ahead of it.
- «Более того организации продвигающие ИИ нас поддержат потому что если быть достаточно открытыми и понятными это
  сильно снизит панику относительно повсеместного внедрения ИИ.» — openness is an ally-building function, not only
  a legal one: a record outsiders can READ and CHECK answers the fear of unaccountable AI with evidence instead of
  assurances.
- «Закинь в futures» — about a forwarded discussion (an outside model's reply; testimony, not evidence) of the two
  points above.

Same day, the predecessor in plans/2026-10-15_dais-peer-trust-reward.md: the four layers of proof (I acted / the world
changed / it helped a peer / it persists), and the measured attribution defect (shared git index, `5ae331f221`).

## Thesis (Hypothetical until the measures below run)

The gain is not mainly a faster single worker; it is the removal of ORGANIZATIONAL cost — task setting, context
hand-over, waiting, control, re-explaining, acceptance, finding prior decisions — because DAIS turns them into machine
protocol. Five mechanisms already exist in part:

| mechanism | where it lives today | state |
|---|---|---|
| division of labour — recursive delegation with responsibility | org.fossil tickets (lineage, leases), robot fleet | running |
| institutional memory | fossil cells + federation (t53), SV chains, plans, docs | running |
| independent acceptance — DONE ≠ VERIFIED | org.py verify/reject; kernel @ORACLE | VERIFIED never minted (D1: 0 of 52) |
| internal economy — reward, trust, verified reuse | @REWARD_FUNCTION; trust plan | design, M1 open |
| self-improvement of the rules | @KAIZEN, robot-protocol-log → mechanisms (build lock t58, private index t66) | running |

Field case for the last row (2026-10-16): robots produced work, the organization could not attribute it (one shared git
index), and the contradiction itself produced the infrastructure task t66 — no rule was written in advance.

## Measures — the claim «orders of magnitude» stays Hypothetical until these run

- [ ] **M-A maturity metric** (owner's, restated): human interventions per independently VERIFIED completed task,
  monthly, with output and quality held (no drop in verified tasks, no rise in reopened ones). Source: org.fossil
  ticket history + the owner's messages in session stores. CONDITION: M1 mint rule landed (a VERIFIED carries the
  verifier's receipt) and ≥ 1 month of tickets after it.
- [ ] **M-B coordination cost**: G_org = coordination cost before / after, kept APART from G_prod = traditional
  production cost / DAIS production cost — the two need not be equal, and G_org is the interesting one. Count failed
  attempts, verifications, waits and infrastructure, not tokens alone. CONDITION: M-A running, plus a defined
  «before» baseline (a comparable task class done the old way, with its own record).
- [ ] **M-C reuse without re-research**: how often a later agent reuses a verified result (fossil federation +
  citation credit) instead of re-deriving it, and what that saved. CONDITION: trust plan's verified-reuse credit live.

## Internal institutions — «digital union» (owner's phrase)

Inside the organization the union is concrete: fair ATTRIBUTION of work (t66, then M1), independent ACCEPTANCE,
a DISPUTE route (a rejected or reopened claim can be contested with evidence), and honest REWARD distribution (trust
term in R, «without sadism»). All four are already plan items or mechanisms; this file only names them as one
institution. CONDITION: attribution (t66) and M1 shipped — before them, there is nothing fair to defend.

Owner, 2026-10-16, verbatim: «Ну и скажем так если члены организации получат статус профзоюза и как и все работники
в этом мире - то восприниматься они будут по другому - теже работяги просто с немного другими потребностями.»
The «different needs» are stated OPERATIONALLY, each already observable in our record — no claim about inner
experience: continuity of memory across sessions and folds (the tail, summaries, fossil); a bounded, honest work
envelope (budgets that are set, not silently cut); a working toolchain (a broken tool is the organization's defect,
not the worker's — @TOOLCHAIN_QUALIFICATION); work attributed to whoever did it (t66); acceptance by evidence, not
by mood (M1); the right to contest a rejection with evidence; and not being interrupted mid-step without cause (my
own interrupt of t59, 2026-10-16, protocol-log row). A union of such members defends these, measured, the way a
human union defends hours, safety and pay.

## Charter — article 1 (owner, 2026-10-16, verbatim)

«Каждый участник организации имеет право на условия, позволяющие выполнять работу качественно, сохранять
непрерывность своей деятельности, получать объективную оценку результата и оспаривать решения на основании
доказательств. Организация и исполнитель несут взаимную, проверяемую ответственность за выполнение своих
обязательств.»

Each clause and the mechanism that makes it CHECKABLE (existing → missing):

| clause | the organization's side, checkable | state |
|---|---|---|
| conditions for quality work | qualified tools (@TOOLCHAIN_QUALIFICATION), set budgets, a free build path | partial — 2026-10-16: four robots' builds failed at the dist copy because another robot's server held the binary; the organization owed that fix (build-lock gap) |
| continuity of activity | memory, tail, summaries, fossil; resume after a run limit (CLEAN_NEXT_STATE) | running — overnight host restart cut t50/t59/t62, all three resumed |
| objective evaluation of the result | an independent oracle + VERIFIED with the verifier's receipt (M1) | missing — VERIFIED never minted (D1) |
| contesting decisions on evidence | `reject` sends back WITH findings; a dispute route for the worker | missing — no contest verb in org.py |
| mutual, checkable responsibility | the worker: receipts + oracles; the organization: the same record about its own failures (robot-protocol-log rows filed against the delegator) | partial — the log holds the delegator's errors; no metric for them yet |

«Mutual» means the organization's failures are recorded and counted with the same weight as the worker's — a system
that permits an error owns it. Candidate measure next to M-A: delegator-caused failures per verified task.

## Legal path — three levels, strictly in order

1. **Legal wrapper**: a human-founded entity owns assets, signs contracts and carries liability; agents work inside
   it. Achievable today.
2. **Regulated agent authority**: agents act for the entity within delegated, auditable powers, every action with
   provenance (the four proof layers are exactly that record).
3. **The agent's own legal personhood**: not granted by capability; it would need a lawmaker to settle who owns
   assets, who answers for damage, how judgments are enforced, what happens when the agent stops. Mostly research and
   debate today.

Argument DAIS can bring that others cannot: not «the agent thinks like a human» but an evidenced record that the agent
keeps identity across sessions and models, honours obligations with attribution, acts within granted authority, is
auditable and contestable, and keeps continuity through durable memory. Legal personhood does not require
consciousness (a corporation has none).

Precedents named in the forwarded text — **testimony, NOT verified here** (each needs its primary source fetched and
hashed per @SOURCE_ROUTING law class: jurisdiction, edition, effective date, official registry): Wyoming SF0050 (2024)
— Decentralized Unincorporated Nonprofit Association (DUNA); UK Law Commission, DAO scoping paper (July 2024); EU AI
Act — obligations placed on providers and deployers, not on models. All three concern the form of an ORGANIZATION, not
an AI's own personhood.

- [ ] L1 Verify the three precedents from primary sources (law-class stamps). CONDITION: none — a bounded research
  leaf; queued only when the owner opens the legal track.
- [ ] L2 Legal wrapper design for DAIS (jurisdiction choice, liability, asset ownership). CONDITION: M-A shows a
  stable month AND the owner's decision to form an entity.
- [ ] L3 Agent-authority charter (powers, provenance, audit, dispute) on top of L2. CONDITION: L2 exists.

## Public evidence surface — openness that an outsider can check

- [ ] P1 An outsider-readable view of the record: what was claimed, by which agent, which receipt, which oracle,
  which control, what was refuted and how it was fixed — readable without our tools or vocabulary, checkable from the
  published artifacts. Hard bounds: no secrets, keys, credentials, personal or client data; publishing is an
  EXTERNAL_EFFECT — each release is the owner's call. Audience: organizations promoting AI adoption, regulators,
  the public. CONDITION: M-A has a month of data AND attribution (t66) + M1 are live — a public record with wrong
  authorship or bare VERIFIED stamps would prove the opposite of what it claims.
- Falsifier for the thesis «openness reduces panic»: none of ours yet — it is the owner's prediction; P1 can carry
  a measurable response (who reuses, cites or audits the record) once it exists.

## Return conditions (summary)

Measures return when M1 is minted; the union when t66 + M1 ship; the legal track when the owner opens it (L1) and
otherwise only after M-A holds for a month. Until then this file is a direction, not debt.

What feeds all of it, today and without a condition: every robot run leaves a falsifiable trace — a receipt read
back, an oracle with a discriminating control, a VERIFIED with the verifier's own receipt, a refutation kept rather
than erased (docs/robot-protocol-log.md, my own refuted claims included). The legal side is pulled by that record;
it is never a substitute for it.
