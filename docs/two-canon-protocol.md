# Two Co-Governing Canons — ADID Framework 15.3 and reasoning_kernel_next

**Status:** reference design note
**Created:** 2026-09-06
**Subjects:** [ADID_Framework_15_3.md](ADID_Framework_15_3.md) (untracked, package-rendered) · `reasoning_kernel_next` (G1–G9) · [reasoning-framework.md](reasoning-framework.md)

## Why this note exists

Answers the recurring question: **why does `docs/ADID_Framework_15_3.md` exist at all, why is it gitignored, and why does the reasoning kernel not replace it?** Without it, agents re-derive (or mis-derive, e.g. inverting the succession direction) the relationship from scratch each session.

## 1. The canons (quoted from the 15.3 header)

Two co-governing canons — **do not merge them**:

- **ADID Framework 15.3** governs the development *protocol*: communication rules, operating protocol, artifact generation (ADM XML), web search specs.
- **`reasoning_kernel_next` (G1–G9 control graph)** governs *transformer-based agents*: reasoning and authorization.

The header states the succession direction explicitly:

> 15.3's dual-mode decomposition and semantic-vector narrative do not map onto
> transformer attention; attempts to extend 15.3 in that direction **produced
> the kernel** as a separate, self-contained canon.

So: **the kernel is 15.3's successor**. 15.3 is frozen — it will not change; the current generation is rendered by the external ADID package. The canons coexist on purpose.

## 2. One protocol, two compilers (parity)

"По сути одно и то же" — the gated workflow is 15.3's ADM system re-expressed for transformer agents:

| ADID 15.3 (ADM-XML) | reasoning_kernel_next (G1–G9) |
|---|---|
| Composite XML Descriptor — the full state canvas (`updates.xml`) | **G3 MASTER_PLAN** — full plan artifact: premises, claim ledger, risks, smoke contract |
| Synthesizer → "executable, **atomic XML update** plan descriptor"; `tools/adm --apply` | **G7 IMPLEMENT** — "smallest cohesive change for the selected task", one bounded task per step |
| `md5`/`size` integrity attributes per descriptor | Claim ledger digest + falsifier; `@SV_FORMAT` `md5`/`prev-md5`/`parent-goal-md5` |
| Backup pipeline → rollback | Fossil snapshots per bounded task + git + edit `.bak` |
| Roles (Synthesizer/Executor), audited CLI flow a human would follow | `@AUTHORITY_SEPARATION` — planner/authorizer/implementer/oracle/closure |
| `#information_mark` epistemic hierarchy (Popper) | `@INFORMATION_STATUS` Exact → Inferred → Hypothetical → Guess → Unknown |

Direct lineage marker: 15.3's change summary introduced **canonical SV hashing** (`md5_sv_tag`) and `Prev_MD5s` as semantic anchor links — exactly the kernel's SV `prev-md5` chaining.

## 3. Attention economics — why two compilers

- **15.3 executes by generating the complete ADM-based XML state in one shot**, then applying single atomic updates per task; rollback lives in ADM. The single-canvas mode rewards MHA-class attention — exact token-level recall across one large structured document at once (GPT/Gemini class).
- This is **not a capability ceiling** for MLA-class (DeepSeek) models: they enter the state **smoothly, over iterations**. The kernel's loop reaches the same state in 1–2 passes (ground → draft plan → bounded delta → oracle → revise) because each iteration re-attends only small handles — never the whole canvas. Byte-stable prefix + externalized state (git/fossil/plans/DBs) is what makes iterative entry cheap.
- DeepSeek's fast-answer bias (temperament, not capability) is compensated structurally by kernel guardrails — oracle-before-claim, plan binding, free-first model defaults — so the same state is reached with more Unknowns on the first pass and hard corrections after.

## 4. Turn economics — why 15.3 survives

- GPT-class guardrails tax **every model turn**. Editing files one-by-one multiplies the taxed surface N times.
- 15.3 minimizes **turns**: one canvas generation + one deterministic `tools/adm --apply`. Verification is moved **out of the model into the CLI**: `md5`/`size` attributes, auto-repair with telemetry in `logs/descriptor_auto_fixes.log`, `--verify-all` / `--fix-xml`.
- The kernel optimizes the opposite axis: cheap turns, verification granularity **per gate**.
- Both implement the same principle — a deterministic shell around a stochastic core — tuned for different turn/attention cost models. **Merging breaks both**: the iterative loop multiplies guardrail tax on GPT-class models; the single-canvas mode outstrips MLA recall.

## 5. Storage decision (2026-09-06)

- `docs/ADID_Framework_15_3.md` is **rendered by the external ADID package** → untracked and gitignored (`docs/ADID_Framework_*.md` wildcard, commit `079f4a213f`). The file stays on disk; the package re-renders it.
- Frozen by design: the kernel is the successor; 15.3.1 / 15.4.3 were already retired to git history (per the doc header's installer-asset policy decision D1).
- Fresh clone: the file — and links to it in `DOCINDEX.md`, `docs/README.md`, `docs/reasoning-framework.md`, `docs/agentic-reasoning-runtime.md` — resolve only after the ADID package regenerates the doc. Same receiver model as `.cursor/` / `.opencode/` assets and `docs/examples/`.

## Provenance

- **Exact** (from the 15.3 doc header and §V): canon separation, succession direction, ADM CLI mechanics, SV-hashing lineage.
- **Author rationale** (session 2026-09-06, framework author): MHA/MLA state-entry styles, guardrail turn economics, and the parity claim ("gated workflow is essentially the same system"). Recorded here so the rationale survives the session.
