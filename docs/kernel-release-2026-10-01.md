# Kernel release 2026-10-01 — one executor contract, verbatim decisions, recursive re-verification

- sv: { keywords: { executor-contract 0.30, verbatim-decision 0.25, recursive-verification 0.20, anchor-stability 0.15, session-handoff 0.10 },
        dominant: "Five rules collected in the owner discussion of 2026-09-30/10-01 enter the kernel, each tied to the case that produced it." }
- plan: `plans/2026-09-28_kernel-candidate-incorporation.md` § F9 · evidence: `experiments/2026-10-01_kernel-k1-k5/`
- production sha256 `86f727c0…` (prev `7f9a1b6f…`), 57 023 B; cap 57 000 → 58 000

| rule | where | the case that produced it |
|---|---|---|
| any executor — tool, agent or human — is qualified to one contract; a run ends done-to-standard or in an explicit stop through the envelope's channel; silence or disappearance is FAIL | `@TOOLCHAIN_QUALIFICATION` | an operator with agoraphobia hid instead of launching the tool: the run failed SILENTLY |
| departing from the user's verbatim decision needs a measurement on the decision's own layer; without one → `@CONCERN` | `@INTENTION_INVARIANCE` | the owner decided chained xxH3; the implementer substituted xxHash64 because «xxHash3 appears nowhere in src» — a grep of source answering a runtime question (`Bun.hash.xxHash3` is built in) |
| every delegation level re-verifies by re-digesting the stamped artifact; «done», the user's included, is testimony about state, not a decision | DELEGATION (FRESH_EYES) | recursive delegation re-checks orders; the digest keeps the recursion from paying for one proof N times |
| SVM provenance is anchored on a surface that is not our artifact, most stable first: commit hash > symbol > path:line | SVM `evidence_vector` | the mnemonist's locus rule (GMS): an artifact is fixed on a surface that is not an artifact; `path:line` drifts |
| hand off to a fresh session instead of a late /compact | Claude add-on, G9 | a /compact asked at 76 % fill (owner: «лучше чем компакт в последний момент») |

Outside falsifier: frameless Sonnet, two rounds, findings and dispositions in the plan's F9 section.
