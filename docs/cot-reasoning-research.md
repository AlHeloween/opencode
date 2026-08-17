# CoT and task implementation — research summary

**Status:** research 2026-08-15 (web sources; no live claims beyond our own KAT/zen matrices)
**Sibling:** `docs/streamlake-kat-thinking-cache.md` (live echo matrix), `docs/deepseek-thinking-cache.md`

How Chain-of-Thought (the model's pre-answer reasoning, `reasoning_content` / `reasoning`
field) affects **task execution** — and what it means for opencode's echo policy.

## Sources

| Source | Venue | Key claim |
|---|---|---|
| [Hi-CoT](https://arxiv.org/html/2604.00130v2) — Huawei | ICML 2026 | Hierarchical CoT (alternating instruction→execution) gives +6.2% avg accuracy (up to +61.4%) with **13.9% shorter traces**. "Longer traces do not imply better reasoning." |
| [TOPS](https://arxiv.org/abs/2502.18080) — Microsoft Research | NeurIPS 2025 | Scaling CoT length **impairs** performance on easy tasks; optimal reasoning effort differs per domain. Longer CoT → more erroneous steps. |
| [STITCH](https://arxiv.org/abs/2604.00824) — Huawei CodeArts | arXiv 2026 | "Less-Is-More" in agentic coding: filtering low-value tokens from trajectories → up to +63.16% relative SWE-bench Verified improvement with less data. |
| [Inkling-Small](https://thinkingmachines.ai/news/inkling-small/) — Thinking Machines | blog 2026 | Reasoning effort sweeps trace the performance–compute curve; reasoning tokens dominate output cost. Effort should adapt to the task. |
| [GPT-5 for developers](https://openai.com/index/introducing-gpt-5-for-developers/) — OpenAI | blog 2025 | "Reasoning effort yields different benefits on different tasks"; `reasoning_effort: minimal` for fast answers. |

## Findings

1. **CoT works via structure, not length.** Flat CoT is redundant (repetition, hedging,
   wandering). Compression bottlenecks (distill state into a subgoal before each step)
   improve accuracy *and* reduce tokens. Hi-CoT: +6.2% accuracy at −13.9% trace length.
2. **Overthinking hurts easy tasks.** TOPS: on GSM8K/MATH500, high reasoning effort scores
   *worse* than low effort while costing more tokens. Longer CoT contains more erroneous
   steps; the model gets confused by its own wrong turns.
3. **Less-is-More holds for agentic coding.** STITCH keeps only decision-critical tokens in
   training trajectories — agents trained on filtered traces beat agents trained on noisy
   long traces (up to +63.16% SWE-bench Verified relative).
4. **Reasoning tokens are the dominant cost.** Inkling effort sweeps: output cost ≈ mean
   generated tokens (reasoning included). Effort selection is a real economic lever.
5. **Effort is task-dependent.** Same effort gives different benefits on different tasks
   (OpenAI). Optimal policy: adaptive effort, not max-always.

## What this means for opencode

| Our implementation | Research backing |
|---|---|
| **Drop CoT from replay** (all openai-compatible routes except the DeepSeek/MIMO tool-call 400-guard) | Echo makes the model re-think over its own CoT — live-verified: KAT 50 vs 142 output reasoning tokens, 1042 vs 1768 ms; zen MIMO 2.4× more CoT. That is the TOPS "overthinking" pattern: more tokens, no quality gain. Historical CoT's value is realized *during* its generation; in-context replay adds redundancy. |
| **Save + render, never mutate stored parts** | CoT remains an explainability artifact (Hi-CoT: "interpretable, auditable reasoning traces"). The drop operates only on the outgoing wire copy (`normalizeMessages`); DB parts and TUI rendering are untouched. |
| **Tool-call echo whitelist (DeepSeek, MIMO)** | Protocol requirement (vendor 400), not quality. Thinking continuity across tool steps inside a turn is real; between turns it is not. |
| **Reasoning effort variants** (`off/low/high/max` for DeepSeek) | Direct consequence of TOPS/Inkling/GPT-5: effort should be chosen per task difficulty, not fixed. |
| **Fresh CoT every turn, no echo** | The useful part of CoT is test-time compute for the *current* problem; replaying old CoT wastes context and invites overthinking. |

## One-line conclusion

CoT is test-time compute for the current task — generate it fresh, show it to the user,
**do not feed it back into the context** (except vendor 400-guards). "Think more" ≠ "do
better", especially on simple steps.
