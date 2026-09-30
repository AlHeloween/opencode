# Value flow as a closed loop — tender to cash, segment by segment

<!-- intention: agents report agent activity -> the business value flow (tender to cash) runs as closed segments, each proven by an artifact oracle, and the owner reads money and verified deliverables only -->

- status: FUTURE (not debt, not counted by `collectPlans`)
- sv: { keywords: { value-flow 0.30, segment-oracle 0.25, human-mcp 0.20, closure-order 0.15, owner-report 0.10 },
        dominant: "Each segment of the inspection business flow closes only when an artifact proves its output; the digital segment closes first." }
- owner, 2026-09-30: «люди в моей схеме это MCP»; «любая тема должна быть экономически целесообразной и
  достаточно замкнутой чтобы не трахать мозги обслуживающему персоналу» (AGENTS.md § Project Paradigm).
- depends on: `plans/2026-09-30_robot-delegation-and-orchestration.md` (robot S1-S4),
  `plans/futures/2026-09-29_mission-runtime-for-kernel-procedures.md` (store arbiter, budget ledger).

## The flow and each segment's oracle

| # | segment | executor | output artifact = oracle | weakest point |
|---|---|---|---|---|
| 1 | Tender | agent + human sign | submitted package + portal receipt id | the decision to bid is the owner's |
| 2 | Mobilization | human MCP | dispatch record: tool serial, photo with time + GPS, handover signature | a report «loaded» is testimony — no artifact, no close |
| 3 | DataAcquisition | human MCP + tool | the run data file itself: tool serial, odometer, timestamps, file hash | self-evidencing — the strongest oracle in the chain |
| 4 | Analysis | agent (robot) | analysis output reproducible from file 3 + the pinned method version | none human — fully digital |
| 5 | FinalReport | agent + competent sign-off | report id + reviewer signature + client receipt | the signature stays human (competence) |
| 6 | Invoice | agent (accounting robot, cua) | invoice number in the accounting system | reconciliation against report 5 |
| 7 | Cash | bank | **bank statement line** — never the agent's own ledger | the only money oracle is the bank |

## Rules

- **Human as MCP returns EVIDENCE, not a report.** A work package is {task, inputs, acceptance, deadline,
  return data}; it closes on the returned artifact, never on «done».
- **Stop-work authority is a valid return.** «Refused, unsafe» from a human MCP is an answer, not a failure to
  route around; safety-critical permission (permit-to-work) is granted by a competent human, never by an agent
  — the same line as the kernel's «never self-authorize».
- **Every number in the owner report is an address.** «Invoiced RM X» expands to invoice numbers, «cash RM Y»
  to statement lines; «the numbers agree» is a reconciliation run by an oracle.
- **Owner report** (weekly): what came in, what was produced, what turned into money — tenders submitted/won,
  tools mobilized, datasets acquired/analysed, reports delivered, invoiced, cash received, costs, profit,
  decisions needed (0 or a short list). Conversion won/submitted, cash/invoiced, verified reports per week.
  Agent telemetry stays internal and is reached by address, never pushed up.

## Closure order (cheapest closed segment first)

1. **3 → 4 → 5 digital core**: run file in, report out, oracle without people. Owner's JView (ILI/MFL viewer)
   is the visual instrument here (memory `project-jview-delphi-cua-target`).
2. **6 → 7**: invoice → cash, reconciled against the bank (memory `project-accounting-automation-is-cua-goal`).
3. **1, 2** last: most people, fewest oracles.

## Return condition

Back to `plans/` when robot S1 has closed at least one real task with its three numbers measured (verifier
tokens, robot $, owner touches) — the flow is sized from those, not assumed.

## Open (owner)

- Which run-data format and which analysis method version is the first pinned pair for segment 4.
- Who signs segment 5 today, and in which system the signature is recorded.
