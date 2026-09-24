# advanced_reasoning

Plans about making the agent's **reasoning mechanics actually work** — not about the UI that displays them,
not about the model on the wire.

**Why this section exists.** The ✓/✗ assertion marking is written down in full — three kernel addons, three
rendered variants, `.claude/reasoning_kernel.md` — and still does not reproduce outside the session whose
system prefix was built *after* it was installed. Owner, 2026-09-24: «Там то все есть и типа в доках и в
кернеле типа, но не так не работает — поэтому я и попросил тебя конкретно». A norm that exists in text but
not in behaviour is a DOCUMENT; this section is where its behaviour is chased, and the same standard applies
to every other reasoning norm that turns out to be text-only.

## What belongs here

- Carriers of reasoning behaviour: kernel addons, permanent memory, and the self-referential counters the
  model sees about itself.
- MEASUREMENTS of whether a norm changes output — a share table over a fixed prompt set, never an impression.
- Feedback loops that let the model correct itself without a human in the middle.
- Diagnosis of a reasoning norm that is present in the prompt and absent from behaviour.

## What does not

- Rendering, pixels and stream stability — that is `plans/2026-09-22_reasoning-stream-render-stability.md`.
- Model routing, catalog and transport rungs.
- Plan-hygiene mechanics themselves.

## Operational note — read BEFORE moving a plan in

`collectPlans` is **flat**: a plan inside this subdirectory is **invisible** to `reconcilePlans`, to the
`owed:` line and to a fold's plan-state block. A plan moved here must be tracked by hand and moved out by
hand when it closes. The recursive scan is task §8 of `plans/2026-09-21_mstar-order-and-summary-restore.md`;
until it lands, this invisibility is the price of the section — and the reason the count of open tasks in
`<compaction-status>` will not see what lives here.

## Contents

- `2026-09-24_assertion-marking-reproducible.md` — turning the ✓/✗ marking from one session's habit into a
  reproducible behaviour, with a measured share of marks that carry an instrument.
- `2026-09-24_marks-counter-log.md` — the raw `marks:` readings from the session that raised this section:
  `NONE` for 84 of 117 window replies while the rule sat on disk, then counted pairs. The evidence that
  «the norm exists» and «the norm runs» are different facts.
- `2026-09-24_marked-reply-example.md` — a reference specimen of a reply that IS executing the norm:
  claims with instruments, ✗ naming what contradicts. The shape a prompt paragraph cannot convey.
- `2026-09-24_fragmented-thinking-specimen.md` — raw reasoning specimens from the session where thinking
  degraded into ✓/✗-spam and «Хм.» loops (deepseek-flash — the same model everywhere else): full verbatim
  trace, machine counts, the fold-crossing natural experiment (the form is window-borne, not rule-borne),
  the reasoning-echo pin, and the orphan-parts anomaly (11 parts without `message` rows).
