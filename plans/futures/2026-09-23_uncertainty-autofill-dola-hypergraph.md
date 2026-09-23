<!-- futures: too far ahead for plans/; the CONDITION that makes it executable is named at the bottom. -->

# Uncertainty autofill — DoLa + Vespa + semantic/graph embeddings → algorithmic hypergraph

Owner, 2026-09-23: «В пределе когда у нас будет прикручена DoLa c Vespa+semantic+graph
embeddings+USC-Ostic-semantic+graph embeddings → algorithmic hypergraph и это чудо будет сразу
после твоего ответа автоматом заполнять неуверенные поля — это мы получим абсолютную автономную
систему… Реализация тривиальна, но долгая и нам понадобится железо.»

## What it is

The step after the marks regime: the agent's own uncertainty — the grey zone between `✓` and `✗`, and
every claim left `Unknown` — stops being only a note to the next reader and becomes a WORK ITEM the
system resolves by itself, right after the reply:

```
answer (with marks / Unknowns)
  → extract the uncertain fields (claims, criteria, unverified statements)
  → retrieve discriminating evidence for each (the G8 discrimination rule)
  → re-emit the reply with each field stamped, justified, or still Unknown WITH its falsifier.
```

## The stack the owner named (terms verbatim)

- **DoLa** (decoding by contrasting layers) — needs access to a model's internal layers/logits, so it
  binds only to LOCAL / SELF-HOSTED models; it cannot sit in front of a closed API provider.
- **Vespa** with **semantic + graph embeddings** — the retrieval plane: evidence search over the local
  corpus AND the project graph, not similarity alone.
- **USC-Ostic-semantic + graph embeddings → algorithmic hypergraph** — the structure that carries
  claim↔evidence↔alternative relations, so «excluded alternatives» becomes COMPUTABLE instead of
  narrated.

## Predecessors already in the tree

- the marks regime (`ASSERTION_STATUS`, `✓`/`✗` per assertion) — the INPUT signal this consumes;
- `PREDICATE_POWER` and `ORACLE_DISCRIMINATION` (G8) — the semantic rule it automates;
- the claim ledger / `session_epistemic` — the store of stamped vs unstamped claims;
- the status footer's `coupling: 0 vector(s)` — the same idea on one narrower axis (plan links).

## Why «trivial but long»

Nothing here is conceptually new: retrieval + discrimination + write-back. What is long is the corpus
engineering (embeddings, graph, hypergraph schema) and the HARDWARE — the owner's term — because
DoLa-class decoding and the graph/embedding planes want local compute, not per-token API calls.

## CONDITION (makes it executable)

Executable when ALL of: (1) a self-hosted model with the contrast-decoding path runs on this host (the
GPU exists; the model must be local), (2) Vespa or an equivalent retrieval engine runs here with the
corpus indexed, (3) the claim↔alternative↔evidence hypergraph schema is fixed in a plan with smoke
tests. Until then it stays a futures entry — not an experiment, because there is nothing to measure yet.
