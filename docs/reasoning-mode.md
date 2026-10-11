# Reasoning Mode

Reasoning Mode is an operational, user-selected calibration phase. It is not
the universal **REASONING Framework**: that framework remains the stable
epistemic protocol shared by every mode.

## Purpose: a calibration instrument

Reasoning Mode removes execution, repository inspection, search, shell, and
subagent capabilities. The model can use only its conversation context and its
persistent reasoning memory. Reducing external stimuli makes the model's own
preferences visible, so the prompt and guardrails can be calibrated rather than
masked by opportunistic tool use.

- **Positive preferences** — sound defaults, helpful instincts, and correct
  reasoning patterns — can be identified and strengthened.
- **Negative preferences** — unsupported assumptions, over-eagerness to act,
  and instruction drift — can be observed and suppressed.

The calibration loop is: observe bounded behavior → tune the stable prompt or
software guardrail → re-observe. This keeps prompt changes evidence-led.

Reasoning mode is the model's own recovery device: it is entered when the model is
stuck, looping, or glitching — a deliberate operator act for the model's sake, not a
user convenience. Its transitions are therefore deliberately NOT permission-configurable.
Owner decision, 2026-10-11, verbatim: «Reasoning мы вообще не трогаем - это для модели
если чета заглючило» — no `ctx.ask` and no `ask` setting is to be added to
`reasoningenter`/`reasoningexit`; they stay silent, gated by Gate A and the
native-identity check (see [Mode transitions](mode-transitions.md)).

## Capability boundary

| Surface | Rule |
|---|---|
| Entry | User UI selection, or the native `build_mode`'s `reasoningenter` transition (`src/tool/reasoning.ts`; native-identity check). Ordinary models never receive the transition schema. |
| Available tools | `checkstate`, `memory` (read, write, or append the project's reasoning notes), and the mode's own `reasoningexit` (`agent/agent.ts:204-216`). |
| Denied capabilities | File inspection, search, shell, edits, subagents, and all execution tools. |
| Exit | User UI selection, or the native `reasoning_mode`'s own `reasoningexit` transition (`src/tool/reasoning.ts`). Ownership is enforced twice: Gate A denies the tool to every other identity, and the tool re-checks `ctx.agentInfo` for `reasoning_mode`. See [Mode transitions](mode-transitions.md). |
| Steady state | No repeated mode-tail or task-continuation prompt injection. Software permissions enforce the boundary. |

Reasoning memory is stored per project at
`.opencode/data/memory/reasoning.md`. It is persistent backing storage, not a
second system-prompt layer: `memory.read`, `memory.write`, and `memory.append`
are ordinary tool interactions in the unified Plan ↔ Build ↔ Reasoning
transcript. The model therefore retains the interaction through the existing
synthetic compaction continuity flow rather than receiving a repeated memory
injection.

For calibration, record visible behavior as **[Exact]**, possible causes as
**[Inferred]**, and proposed guardrails as small, testable rules. Append a
tuning record only after user approval.

## Relationship to the REASONING Framework

The reasoning kernel (`prompt_kernel/README.md`) defines universal evidence,
verification, and decision discipline. Reasoning Mode is one deliberately
constrained setting in which to evaluate how those universal rules behave
without tool-driven momentum.

## Continuity and compaction

Layer-1 compaction remains an in-session continuity protocol, not a mode
change. It may create its synthetic summary/resume messages only after the
current assistant turn, including reasoning, is fully complete. It never
injects into a live reasoning or tool flow.
