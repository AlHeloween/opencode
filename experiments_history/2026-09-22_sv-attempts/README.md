# 2026-09-22 — the semantic-vector attempts: what was measured, and what it killed

Five probes run while building the fold's head (memory + goal + table of contents + tail) and while
evaluating two proposals that came from outside: ADID 12.2's ΔSV trigger and a small
semantic-dynamics network. Every number below is from these scripts, on this host, with the GPU
(GTX 1050 Ti) and `BAAI/bge-m3` wherever an embedding was needed.

They are kept because each one either decided a design or refuted a metric that would otherwise have
been implemented on faith. The wrong numbers stay in the scripts' own comments — a false figure that
is quietly deleted gets re-derived by the next cycle.

| folder | question | verdict |
|---|---|---|
| `keyword-quality/` | are the written keyword weights usable? | **yes** — 927/950 sums within 0.01 of 1.0, median 5 terms, 96 % inside the 3-9 band. 16 carriers continue THINKING inside the block, so the reader stops at the first `term weight` chunk that does not fit and never renormalises. |
| `sv-delta/` | does ΔSV over the written terms trigger anything? | **no** — consecutive vectors share no term at all (1 − Jaccard median 1.0); L1 median 2.0 of a 0..2 range, 97 % of pairs past ADID's 0.4. The metric is saturated; no threshold rescues it. |
| `sv-delta/` | does the declared chain discriminate? | **yes** — `prev-md5` = previous `md5`: 668 linked / 133 broken / 68 chain-starts (15 % fire rate). This became the fold's ⚠ marker. |
| `sv-embeddings/` | is the same trigger viable on real embeddings? | **weakly** — consecutive cosine 0.437 against 0.504 for strangers (ratio 0.87): only 13 % separation, so a threshold would be near-arbitrary; honest form is a RANK, offline. Also: `dg`/`dp` in the 2026-08 map are the chain indicator (2.0/0.0), not distances. |
| `drift-labels/` | can the owner's own interventions label drift? | **not this way** — 400 pairs, agent→owner distance median 0.504, exactly the stranger median 0.504: no separation, so labels cannot be defined by that distance. |
| `sv-dynamics/` | can a small net predict the next semantic state? | **not at this data size** — 919 vectors, 920 832 params, chronological split: mean-of-training beats everything (cosine 0.702 model 0.705 repeat 0.582; next-medoid top-3 13.1 % for both model and repeat, against the 90-95 % the proposal asked for). The cloud is compressed because it is one project's work. |

## Instrument failures, recorded because they cost the most

- `sv-delta`: `rfind("md5:")` lands inside `parent-goal-md5:` and reported an **86 % broken chain**
  that was pure instrument error. Fields must be anchored to the start of their own line.
- `sv-embeddings`/`sv-dynamics`: `normalize_embeddings=True` did not hold under `model.half()`, so a
  net learned to win by SCALING (cosines of 3.04/5.60 on unit vectors, loss −262). Everything is
  normalised by hand now, and the reported numbers are computed in numpy where arithmetic cannot lie
  about magnitudes.
- `keyword-quality`: the first parser assumed single-word terms and reported a false **36 %**
  unparseable rate. `provider auth 0.30` is real traffic.
- 4 GB of VRAM is the real constraint on this host: a batch of full assistant messages asked for
  5.66 GiB of attention mask alone. `max_seq_length=512`, `batch_size=4`, fp16.

## The design that survived, in one line

The fold's head is READ, never generated: memory verbatim, the plan's intention as the goal, each
message's own dominant and weighted terms as the table of contents with addresses, the chain break as
the only boundary marker, and the 32k tail untouched.

## Next, when someone returns to this

The semantic-dynamics idea was not refuted in principle, only this supervision on this vector:
predict the next **action** (`tool_name` is recorded on every part, ~20 classes) instead of the next
embedding, with the class-frequency baseline. That is the escalation gate the proposal actually
wanted — «confident → execute, uncertain → big model».
