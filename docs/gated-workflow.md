# Gated Workflow & Epistemic Markers

## Overview

The gated workflow (`reasoning.txt`) is a structured thinking framework injected into the system prompt for ALL models. It forces models to externalize their reasoning process, which multi-head attention then encodes into context weights automatically.

This is not "just instructions" — it is a transformer-native technique for maximizing model capability.

## Why It Works

### Externalized Reasoning

When a model is forced to print its doubts, confidence levels, and decomposition steps in the prompt, multi-head attention captures these as context. A model that says "I'm not sure about X" internally but never externalizes it will hallucinate with false confidence. A model that writes `[Guess] (single observation, no confirmed mechanism)` in the prompt creates an attention anchor that influences all subsequent decisions.

### Epistemic Markers as Actionable Signals

Markers are not decoration — they are decision gates:

| Marker | Weight | Meaning | Action |
|--------|--------|---------|--------|
| `[Exact]` | 10x | Verified via direct observation | Trust, proceed |
| `[Inferred]` | 7x | Reasoned from Exact data | Trust if chain is sound |
| `[Hypothetical]` | 4x | Balanced, needs validation | Verify before anchoring |
| `[Guess]` | 2x | Speculation, weak signal | **Stop, research** |
| `[Unknown]` | 1x | No data | **Stop, find data** |

When a model outputs `[Guess]` or `[Unknown]`, the correct action is to pause and research the fact — not to proceed with hallucinated confidence. This turns model uncertainty from a bug into a feature.

### k-Medoids vs k-Means

The workflow uses k-medoids (real, representative objects) instead of k-means (abstract averages):

- **k-means**: centroid is an *average* — may not correspond to anything real
- **k-medoids**: medoid is an *actual data point* that best represents the cluster

In practice: every subtask must be a real, executable unit (file path, test command, specific function), not a fuzzy summary like "improve the codebase". This grounds the model's reasoning in verifiable reality.

### Recursive Decomposition (Sierpinski)

Tasks are decomposed fractally — each subtask has the same structural shape as its parent:

```
Task: Mermaid rendering in TUI
├── Subtask 1: mermaid-rs → SVG [oracle: standalone test]
├── Subtask 2: resvg SVG → PNG [oracle: standalone test]
├── Subtask 3: chafa PNG → ANSI [oracle: standalone test]
├── Subtask 4: TextPart integration [oracle: smoke plugin]
└── Subtask 5: Streaming detection [oracle: smoke plugin]
```

Each leaf must be at file-and-function level with a verifiable oracle (test, typecheck, runtime output). A subtask without an oracle is not complete.

## The Gates

Every code change flows through these gates sequentially:

1. **Gate 1 — STATE**: Read current state (files, logs, tests). Ground in concrete observations.
2. **Gate 2 — DECOMPOSITION**: Break into subtasks using Sierpinski/k-medoids.
3. **Gate 3 — MASTER PLAN**: Produce plan with subtasks, oracles, ship criteria.
4. **Gate 4 — PRESENT & ASK**: Show plan, wait for approval. No code until approved.
5. **Gate 5 — CONCERN LOOP**: If concerns raised, return to Gate 2.
6. **Gate 6 — GROUNDING**: Verify assumptions with explore agent or web search.
7. **Gate 7 — IMPLEMENTATION**: Implement exactly what plan specifies.
8. **Gate 8 — ORACLE VERIFICATION**: Verify with tests/compiler/runtime. Task complete ONLY when oracle passes.
9. **Gate 9 — CLEAN NEXT STATE**: Report done/blocked/next.

## Why Most People Don't Need This

Most users want quick answers. The gated workflow adds overhead: decomposition takes time, verification requires running tests, epistemic markers force the model to say "I don't know" instead of guessing.

For simple tasks ("rename this variable"), the workflow is overkill. For complex tasks ("fix this rendering bug across 3 subsystems"), it prevents the model from hallucinating solutions that look correct but fail at runtime.

## When to Use

- Complex multi-file changes
- Debugging where root cause is unclear
- Architecture decisions
- Any task where "the model said it works" is not sufficient verification

The gated workflow ensures every claim is grounded, every subtask has an oracle, and every decision is traceable to evidence.
