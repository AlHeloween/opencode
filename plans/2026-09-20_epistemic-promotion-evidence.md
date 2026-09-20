<!-- intention: the epistemic ladder declares rungs but the middle rungs leave no artifact, so Inferred - the only rung that licences mutation without runtime evidence - is self-assigned -> an Inferred claim must carry a falsifiable pin, its form must be a machine-checked red, and the ladder must have one owner -->

# Epistemic promotion needs an artifact, not a rung

**Depth.** L2 with core adjacency. `@INFORMATION_STATUS` / `@EVIDENCE_ORDER` are constitution core
(`docs/kernel-amendment.md:55-57`), so nothing here replaces their clauses: the proposal **extends the
same owner** (NO_DUPLICATE_NORM, `docs/kernel-amendment.md:84-85`), the constitutional tests must stay
green, and the user authorizes before anything is installed. Proposal artifact, not a patch
(`:82-83`).

## 0. Correction — the owner's reframing, and it is sharper than my first draft

Owner, 2026-09-20: «Я не про жесткость, я про системность. У нас отсутствует процедура теоретической
доказательности. Смок перевешивает все. А ведь смок применим только для inferred. Смок для гесса это
уже чистейшей воды шаманизм.»

My first draft said "the middle rungs leave no artifact". That is a **symptom**. The defect is that
**no procedure of theoretical justification exists at all**: `@INFOMARK` is a VOCABULARY of labels, and
`@EVIDENCE_ORDER` states the order (no rung may be skipped, repetition is not promotion) — but nothing
detects a skipped rung, and nothing says **which instrument is admissible at which rung**.

**The shamanism, stated exactly.** An instrument applied BELOW its rung does not yield no evidence — it
yields a REAL green attached to no model. That is worse than a failure, because a failure invites theory
and a green silences it. Measured in this session: `typecheck exit 0`, `[OK] Build complete`, captures
read and re-read — all equally real, all attached to a claim whose rung never rose above `Guess`.

## 0.1 The unit is the medoid, not the claim — and that is what makes an oracle describable

Owner, 2026-09-20: «оракул = reward… вот в чем проблема как мы можем описать оракула достаточно детально
чтобы к этому реализму идти. Вот тут и нужна доказательная база, для того чтобы guess стал гипотезой —
выполнить поиск и найти скажем по 3 медоида на каждую поверхность… Но тут противоречие — guess один…
надо посмотреть на guess и родить из него 5-10 guess кандидатов из которых мы получим хотя бы 5 медоидов
hypothetical, дальше получить 5 медоидов inferred. Медоид это обоснованное заключение, которое требует
ссылку на источник, кроме гесса — гессим по принципу brainstorming.»

**The spine.** The ladder is not a chain of labels attached to one idea; it is a **lattice of medoids**
populated by fan-out:

```
1 guess (brainstorming; no citation owed)
   → 5-10 candidate guesses        (divergence; candidates, not beliefs)
   → search per surface            (≥3 medoids per surface)
   → ≥5 hypothetical medoids       (located, not yet authoritative)
   → ≥5 inferred medoids           (each carries a citation: path:line or authority)
   → instrument                    (admissible only here, and only against a prediction)
```

**Why this answers "how do we describe the oracle in detail enough to walk toward realism".** An oracle
can only be aimed at something bounded. A bare guess has no boundary, so any instrument aimed at it
answers an adjacent question — that is the parked proposal's failure mode. A medoid is bounded to a
**surface** and carries a citation, so its oracle is a predicate over that surface: the reward becomes
dense and **aimable** instead of sparse and gameable.

**Why a lone guess is a contradiction, and what it costs.** `Guess` is exempt from citation because
brainstorming is divergence — but that exemption is safe only for CANDIDATES. The moment one candidate is
treated as *the* claim, every downstream move becomes a reward hack: a cheap green (typecheck, build,
screenshot) is denser and nearer than the real question, so it wins. Measured: two days of green oracles
attached to a single un-fanned guess.

**The kernel already owns this geometry; only the RUNGS are missing.** `@L1_DISTANCE` is defined as the
same additive Manhattan metric for G2 medoids, SV target-vs-current deltas and evolution clustering;
`@MANHATTAN_L1` already requires "at least five candidates when the search space permits" and keeps
medoids as `CENTRAL_TASKS`; `@ONE_STEP_AHEAD` already asks for the downstream verification consequence;
`EVOLUTION_CANDIDATES` already demands ≥5 bounded candidates clustered by `@L1_DISTANCE`. This is not a
new mechanism — it binds the rungs onto the lattice the kernel already builds, which is also what
NO_DUPLICATE_NORM requires.

**Falsifiers (each checkable).**
1. A medoid without a citation is not a medoid — it demotes to a candidate.
2. A plan whose fan-out is below the minimum (5-10 candidates; ≥3 medoids per surface; ≥5 per front) does
   not raise the claim above `Guess`; a single-guess plan is invalid by construction.
3. An instrument named before its medoid's prediction exists is inadmissible (L5).
4. Fewer medoids than the minimum is a RESULT (Unknown / blocked), never a licence to proceed with one.

**Worked example — the /agents row, the cost this procedure would have paid up front.** Fan-out on "why do
the columns float": (a) the row is a flex child with no stated width; (b) the panel is clamped below its
declared width; (c) the description cell measures at its natural length; (d) the marker shares column 1
with the gutter; (e) the footer shrinks rather than anchors. Five candidates → per-surface medoids, each
with a citation — `ui/dialog-select.tsx:420,448,471,650`; `ui/dialog.tsx:55`;
`.opencode/skills/opentui/references/layout/REFERENCE.md:164,194`; `patterns.md:53-58`;
`components/containers.md:456` — all Inferred, all already located in the two minutes the owner's demand
forced. The instrument (one capture, aimed at the prediction "the footer's right edge is the panel's right
edge on every row") then tests the model instead of the hope.

## 0.2 One point is a location, not a description — the ≥3 floor is geometric

Owner, 2026-09-20: «как можно описать пространство одной точкой — а ведь мы это сейчас и делаем — да
авторитетно, но одна точка… любая… фрактальное разложение по серпинскому требует как минимум 3 точки…
Слон это хобот… или ухо… или нога — как в сказке про слепых мудрецов.»

Formally: a single point fixes a POSITION; describing a SPACE requires a simplex — **at least three
affinely independent points**. Below three there is no interior, no boundary, and — the part that matters
here — **no way to state what is uncovered**. `@MANHATTAN_L1`'s "at least five candidates" is a robustness
margin; **≥3 per surface is the geometric floor under it**, and the two numbers answer different questions.

**The kernel already applies this floor to attention, and not to evidence.** `@SV_FORMAT` requires 3-9
unique keywords with weights > 0 summing to 1.0 — a point in a simplex, with a floor of three — and
`prompt_kernel/README.md:43` pins `SV_FORMAT` as a typed IR contract. The kernel therefore knows a vector
needs ≥3 coordinates and demands it, while its evidence lattice accepts a single cited point as the
description of a surface.

**Why one point is not merely thin, but unfalsifiable in practice.** A single point is consistent with
infinitely many spaces, so no second observation is *tested* against it: the structure has nothing that
can fail — the evidence-side form of `@ORACLE`'s own sentence, that an instrument which cannot fail proves
nothing. Three independent points make refutation possible; that, not richness, is what they buy.

**The blind men, made operational.** Each medoid is accurate about its patch and silent about the rest.
With one medoid, "uncovered" is undefined; with ≥3 the uncovered region becomes sayable — and the kernel
already has the words: `INTENT_PROJECTION {covered, uncovered, contradictions}` and `RESIDUAL`. So the
requirement is not "collect more citations" but: **compute coverage over the lattice.**

**Independence, not count.** Three citations drawn from one document are one point repeated, and
`@EVIDENCE_ORDER` already states that repetition is not promotion. The rule therefore reads: ≥3 medoids per
surface whose **sources are independent**.
*Falsifier:* read the pins — if they collapse to one source, one section or one author chain, the simplex is
degenerate and the surface is still described by a point.

## 1. Diagnosis — measured

| fact | address |
|---|---|
| The rung rule exists: web ⇒ Hypothetical; Inferred requires primary authority or local code; a **remote** Inferred requires `source_stamp` | `prompt_kernel/source.py:373` |
| The stamp is **optional** in the ledger | `prompt_kernel/source.py:448` — `CLAIM_LEDGER: {…, stamp?, source_stamp?}` |
| The type exists and is pinned | `source.py:460`, `compatibility.py:48`, `tests/test_contracts.py:44,100` |
| The validator demands a stamp **only** on the generic-web path | `validate.py:208-209` |
| **Inferred licences mutation**: active `premises_for_plan` must be Exact\|Inferred, else MODIFY denied | `docs/agentic-reasoning-runtime.md:137` |
| **The doc contradicts the kernel** — it publishes "web + code only ⇒ **Inferred**" | `docs/agentic-reasoning-runtime.md:114` vs `source.py:373` |
| The machinery to require a consumer for a declared type already exists | `tests/test_architecture.py:113-117` — "SOURCE_STAMP is consumed by nobody" |

⇒ **The defect is not a missing rung.** It is that (a) the middle rungs leave no artifact, (b) the only
rung that licences mutation without runtime evidence — `Inferred` — is **self-assigned**, and (c) the
ladder has **two owners**: the kernel and the runtime doc, stating different thresholds, which is how a
cheap `Inferred` becomes available. `prompt_kernel/README.md:30` already declares the rule this violates:
`source.py` is the only semantic owner.

**The instance, from this session:** a shared renderer (`ui/dialog-select.tsx`) was edited on claims
labelled `Inferred` with no pin of any kind, and the gate admitted it; the first real demand for a
citation came from the owner, not from the process.

## 2. Proposal — four legs, every one on an existing carrier

**L1 — the pin (fail-closed).** An `Inferred` claim carries a pin: local `path:line`, or
`authority_class + url + content_hash` for a remote authority. **No pin ⇒ the claim is `Unknown`, never
`Inferred`** — the same fail-closed shape as the cmd_runner guard (`shell-constitution.ts`), and it costs
no new state: the field already exists (`CLAIM_LEDGER.source_stamp`, `source.py:448`).

**L2 — the pin is falsifiable, not assertable.** A pin is a coordinate **plus a short verbatim quote** of
what it claims to contain. A coordinate can be fabricated; a coordinate paired with text a second party
can open and compare cannot be fabricated silently. This is what makes `@DIVERGENCE_PROTOCOL` — which
already revokes a stamp to Unknown — able to act on the middle rungs: today it has nothing there to
revoke.

**L3 — the form is a red, not a style.** The validator and a test require a well-formed pin on every
`Inferred` claim, paired with a mutation that makes the guard fire (the repo's own style:
`docs/kernel-amendment.md:96-97`). A missing pin then costs a failed run, which is the only kind of cost
that survives a fold.

**L4 — one owner for the ladder.** `docs/agentic-reasoning-runtime.md:111-116` restates the rungs and is
stale (`:114` vs `source.py:373`). It must derive its table from the kernel or state plainly that it is a
summary with a pointer — a second semantic owner of a norm is the defect, not the wording.

**L5 — instrument admissibility by rung (the rule that is actually missing).** An instrument certifies at
its own rung or above, never below: smoke/PoC is admissible for `Inferred`, and its PASS produces `Exact`.
For `Guess` and `Hypothetical` the admissible moves are **theory and search** — a mechanism statement and
a pin — and an instrument run at those rungs returns `Unknown` whatever it shows, because the PASS is
evidence about the IMPLEMENTATION and not about a theory that does not exist yet.

**L6 — a promotion above `Guess` states its mechanism.** The claim's own statement carries: what mechanism
the system has, and what that mechanism PREDICTS for this case. The instrument then tests the prediction,
and a PASS confirms or refutes the model rather than the hope. A statement containing no mechanism cannot
be promoted above `Guess` by any instrument — which is "smoke for a Guess is shamanism" written as an
operation instead of a reproach. No new ledger field is needed: the `statement` carries the mechanism and
the existing `source_stamp` carries the pin.

## 3. The sharpest lever — recorded, user-reserved, NOT taken

Today `premises ∈ {Exact, Inferred}` is enough to mutate **anything**, including a surface with many
consumers. The targeted tightening: mutation of a **shared surface** (more than one consumer) requires
**Exact**, not Inferred. This touches `@PLAN_CONTRACT_ENFORCEMENT`, which is **constitution core**
(`docs/kernel-amendment.md:60`) ⇒ **L3, user only** — the amendment doc is explicit that an agent
authorizing a change to its own constraint system is the recursion it forbids (`:44-46`). Recorded here
so the option exists without being taken.

## 4. The trail, and why the pin must leave the session

`docs/kernel-amendment.md:222-229` — at scale the deliverable is **the evidence that makes the work
acceptable without redoing it**, and its consumer is the next cycle. A pin that lives only in runtime
claim-ledger state does not survive a fold, so a pin must also land in `_progress_log.md` / the plan
step it supports. Otherwise the next cycle re-grounds, which is exactly the cost continuity exists to
remove.

## Smoke Tests

**baseline (measured):** `python -m pytest prompt_kernel/tests/ -q` → `100 passed in 1.63s`.

**post-change oracles:**
1. The same suite green, including `test_constitution.py` (the core's load-bearing clauses unchanged —
   this proposal extends, never replaces) and `test_dedup.py` budgets.
2. A **mutation pair**: an `Inferred` claim with no pin must be rejected; with a malformed pin, rejected;
   with a `path:line` + quote whose text does not match the file, rejected. Each mutation is paired with
   the guard firing — an instrument that cannot fail proves nothing (`@ORACLE`).
3. `python -m prompt_kernel` → dist only, `working_copy=not_updated`, sha printed; then the diff to the
   user's eyes; only then `--install` and repin.

**falsifier for this proposal:** if a claim can still be labelled `Inferred` with no pin and still
satisfy `premises_for_plan` for a MODIFY, the leg did not land. The behavioural claim — that this
improves reasoning — is **not** made here and cannot be settled locally
(`docs/kernel-amendment.md:235-239`). Stated honestly: a determined liar can fabricate a matching quote;
L2 raises the cost of that from zero to a forged citation, and the residual is recorded rather than
closed.

## Open decisions for the owner

1. Take L1–L4, or a subset? (L4 alone is cheap and removes the contradiction that produced my error.)
2. The shared-surface/Exact lever — park it with the other parked proposal, or schedule it as an L3?
3. Carrier confirmation: pin in the claim ledger **and** in `_progress_log.md` / the plan (my
   recommendation — the ledger does not survive a fold), or ledger only?
