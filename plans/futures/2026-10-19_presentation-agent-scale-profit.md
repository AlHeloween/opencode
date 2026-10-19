<!-- intention: agent scale is sold as headcount replacement and fails on oversight cost -> the deck shows where the profit of human-in-the-loop agent work really comes from, with each claim backed by a measured case -->
# Presentation element: where the profit is when humans stay in the loop (futures)

```yaml
Keywords: agent-scale-profit 0.30, human-in-loop-roles 0.25, oversight-by-mechanism 0.20, measured-cases 0.15, human-minutes-per-task 0.10
Semantic dominant: A deck section explains that a thousand agents need no thousand reviewers because the third proof leg moves into three-by-three oracles while people keep the loop through intentions, receipt-based checks, reusable documentation, expert meaning and alarm response, and it proves the profit by measured human time per accepted task.
md5: 97a62c33ddb84582a411aca9d00ae36f
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```

## Origin (owner, 2026-10-19, verbatim)

- «в чем проблема корпоративной разработки агентами? Скажем у нас есть 1000 агентов, для них в обычных условиях надо 1000 человек для правильной работы. Где выигрыш?»
- «Я не выкидываю людей из цикла - кто знает какие сложности могут возникнуть - но должен же быть профит. А иначе … вместо разработчиков - проверяющие и что где профит?»
- «Отлично сказано. Закинь в futures как элемент нашей будущей презентации.»

## Condition (when this becomes a deck)

1. A first MEASURED baseline of the metric below exists, with its trend over at least two weeks of robot work.
2. The kernel with the three-oracle rule (t90 + t96) is installed.

Production route: the Canva line (memory `project-canva-presentation-line`). Canva is the bounded producer, with an outside reviewer.

## Narrative (one section, 5-7 slides)

1. **The problem.**
   - An agent that returns an unverifiable «done» needs a human to read and accept each output.
   - That human is the hidden third proof leg, so oversight grows with the number of agents: 1000 agents mean 1000 reviewers.
   - Work moves from «doing» to «checking the machine», and checking is often harder than doing.
2. **Our answer.**
   - The third leg moves into a mechanism. Every result arrives with proof on three aspects (documentation, code, execution), each with ≥3 independent oracles of different families, and each with a defect only it catches.
   - Humans stay in the loop. Their WORK changes.
3. **Five sources of profit:**
   1. **Intention leverage.** One human intention fans out into many tasks (fractal decomposition). Case: a foreign model derived a whole task from one SV.
   2. **Cheap verification.** Re-run the oracle and compare the hash, minutes instead of hours. Case: t93/t95 accepted by re-running their tests and checking the test can fail, not by rereading the work.
   3. **Human work becomes an asset.** Documentation-as-oracle, requirements, operator manuals and the glossary are reused by every later agent. Case: the ClientSoft operator manual with live screenshots caught a long-hunted bug and keeps catching regressions.
   4. **Expert meaning.** The documentation aspect is where human expertise is irreplaceable. The expert sets intention and acceptance criteria, and that knowledge outlives them (digital twins: decisions, reasons, falsifiers).
   5. **Alarms, not inspection.** Process-control (КИП) practice: the operator is called by a first-out alarm, not by watching every sensor. People answer unresolved divergences.
4. **What scales with what.** People scale with intentions + authority decisions + alarms, not with agents.
5. **The condition, said openly.** It works only while oracle independence is real. 1000 agents with degenerate checks make 1000 confident errors and no alarm. That is why the 3×3 rule is the economics, not an academic detail.
6. **Proof.** The measured metric with its trend (below), plus the day's cases with their commits.

## The metric (the profit is measured, never declared)

**Human time per accepted task.** The owner on 10-14: the real cost is tokens plus owner time per completed task.
- **Counted from our own logs:** owner messages and decisions per closed plan or task, with the oracle-verified acceptance as the denominator.
- **Profit:** the number falls while the oracle-measured quality holds.
- **Falsifier:** if it does not fall, or quality drops, the claim is withdrawn from the deck.

## Evidence links (2026-10-19)

- t93 `ee714492ec`: run `20261019T084734Z_0eda4e07`.
- t95 `c615342eec`: run `20261019T084844Z_b0f112b0`.
- Kernel portability record `2fa8cdbe02`: `experiments_history/…kernel-portability…`, `docs/kernel-portability-2026-10-19.md`.
- Memory:
  - `feedback-three-oracles-docs-code-run`;
  - `project-goal-industrial-agi-and-knowledge-twins` (economics of agent scale);
  - `feedback-judge-external-runs-by-their-environment` (the verifiable-result guarantee).
