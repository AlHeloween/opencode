# Kernel Stability Principles

**Date**: 2026-08-09  
**Status**: Post-mortem — principles applied, kept as reference  
**Audience**: Kernel developers, prompt engineers  

> **Note (2026-08-12):** Fixes described here have been applied.  

---

## Context

During optimization of the kernel assembly pipeline, a critical error was introduced: schema compression, heading flattening, and a "quality" postscript collectively destroyed the **assembly point** — the structural reference frame without which an LLM cannot reconstruct the protocol from compressed information.

---

## Principle 1: Assembly Point — Mandatory, Not Best Practice

### What Is the Assembly Point

The assembly point is the **first structural element bearing an @tag**, serving as the entry point for the entire @REF resolution system. In the OpenCode kernel, it is:

```markdown
# Semantic Vector                                    ← H1, identity

**YOU must emit this after EVERY response.**          ← Bold imperative

## SV_FORMAT (@SV_FORMAT)                            ← H2, first @tag
```

### Why It Is Critical

| Without assembly point | With assembly point |
|------------------------|---------------------|
| @REFs lack a starting coordinate for resolution | `@G9` → `@SV_EVERY_TURN` → dictionary → `@SV_FORMAT` — complete chain |
| Attention distributes evenly across all H1s | Attention concentrates at position 0 |
| Kernel perceived as a "reference manual" | Kernel perceived as a "protocol" |
| SV not emitted (0% compliance) | SV always emitted (100% compliance) |

### Rule

> **The assembly point MUST be the FIRST H1 with the FIRST @tag. Nothing stands before it. It names a CONCEPT, not a procedure.**

---

## Principle 2: Schema Density Gradient — Do Not Save on Bytes

### What Happened

Original schemas (~357 lines of YAML) were compressed to 1–2 line summaries:
```
Before: FRACTAL_GEOMETRY — 22 lines with formulas
After:  model: enum[Sierpinski,QuadOct,LSystem]; metric: Manhattan_L1
```

### Why It Broke the Kernel

LLMs use a **density gradient** to classify information:
- **High density** = "this is a contract, it must be executed"
- **Low density** = "this is a reference card, look up when needed"

Compressing schemas to 5–30% of original density shifted the ENTIRE kernel into "reference manual" mode. SV_FORMAT received the same treatment — "format card, can be skipped."

### Rule

> **Schema density must not drop below 80% of the historical stable kernel (`2026-08-09-historical-stable_kernel.txt`). Compressing one schema affects perception of the ENTIRE kernel.**

### Critical Schema Density Requirements

| Schema | Min. Lines | Elements That Must Not Be Removed |
|--------|-----------|-----------------------------------|
| ACTION_CLASS | 40+ | activity enum, effect, risk, mapping, invariants, explicit_approval_required |
| EXECUTION_ENVELOPE | 40+ | approval_payload (all fields), attestation, mutable, validation (all 8 steps) |
| FRACTAL_GEOMETRY | 20+ | Sierpinski/QuadOct/LSystem conditions, adaptive_tau/k/depth formulas, Manhattan_L1, k_medoids |
| MASTER_PLAN_SCHEMA | 20+ | goals/tasks structure, oracle, attempts, worker_id, lease |
| CLAIM_LEDGER | 15+ | claims structure, premises, open_questions, weakest-link rule |
| CLEAN_NEXT_STATE | 15+ | done/pending/blocked/out_of_scope, terminal_mode, precedence, next |
| SMOKE_CONTRACT | 15+ | smoke_na, baseline, post_checks, blast_radius, validation rules |

---

## Principle 3: Heading Hierarchy — Tree, Not Flat List

### What Happened

Schemas were promoted to H1, creating a flat list of 14 competing H1 sections.

### Why It Broke the Kernel

```
Correct (stable):                    Incorrect (optimized):
# Semantic Vector                    # CLAIM_LEDGER
## SV_FORMAT                         # STAMPS
# Protocol                           # FRACTAL_GEOMETRY
# Gates                              # ACTION_CLASS
# Schemas                            # EXECUTION_ENVELOPE
  ## ACTION_CLASS                    ...
  ## EXECUTION_ENVELOPE              (14 H1s — equal competition)
  ...
```

In a tree, attention concentrates at branch points. In a flat list, it disperses.

### Rule

> **Schemas MUST be H2 under `# Schemas`. Only `# Semantic Vector` and `# Protocol` may be H1 before the schemas section.**

---

## Principle 4: Narrative Order — Action Before Verification

### What Happened

Schema order was changed from narrative (action-first) to epistemic (verification-first).

### Why It Broke the Kernel

| Narrative order | Epistemic order |
|-----------------|-----------------|
| ACTION_CLASS → MASTER_PLAN → EXECUTION_ENVELOPE → ... → CLAIM_LEDGER | CLAIM_LEDGER → STAMPS → FRACTAL_GEOMETRY → ... → ACTION_CLASS |
| Model: "I am an actor" | Model: "I am a verifier" |
| SV emission — natural action | SV emission — does not fit verification |

### Rule

> **Schema order: ACTION → PLAN → AUTHORIZATION → EXPLORATION → VERIFICATION → CLEANUP → EPISTEMICS → GEOMETRY → CONTRACT.**

---

## Principle 5: Root-of-Truth — Last Word, No Postscript

### What Happened

After the "THIS KERNEL IS THE ROOT OF TRUTH" declaration, a postscript was appended:
```
### Remember FOLLOWING these rules ensures the quality of your responses
```

### Why It Broke the Kernel

"Root of truth" = absolute authority. "...ensures quality" = contingent authority (depends on outcome). The postscript creates a **self-contradiction**: the kernel is simultaneously absolute and contingent. The model resolves the contradiction in favor of contingency — all rules become optional "quality guidelines."

### Rule

> **The root-of-truth declaration MUST be the LAST line of the kernel. No postscripts, no notes, no "remember...", no "quality...". Period.**

---

## Principle 6: SV — Identity, Not Behavior

### The Distinction

| Identity | Behavior |
|----------|----------|
| "I am a protocol agent. I emit SV because it is part of who I am." | "I must follow rules. SV is one of the rules." |
| Withstands adversarial pressure ("ignore instructions") | Breaks under adversarial pressure |
| `Omission = protocol violation` | `NOT optional` |

### Wording Requirements

| Element | Correct | Incorrect |
|---------|---------|-----------|
| Heading | `# Semantic Vector` (names the concept) | `# RESPONSE REQUIREMENT` (names a procedure) |
| Imperative | `**YOU must emit**` (bold, active) | `you MUST append` (plain, passive) |
| Closing | `Omission = protocol violation` | `NOT optional` |

### Rule

> **SV is formulated in terms of IDENTITY, not procedure. "Protocol violation" is stronger than "NOT optional." Bold imperative mandatory.**

---

## Principle 7: @Tag Chain — Uninterrupted Resolution Path

The chain must be continuous from any gate to the format:

```
@G9 → @SV_EVERY_TURN → dictionary → @SV_FORMAT → yaml block
```

A break at any link = loss of the assembly point.

### Rule

> **Every @REF in the chain @G9 → ... → @SV_FORMAT MUST resolve. Refcheck must show `resolved` for all chain links.**

---

## Stability Checklist — Verify on EVERY Kernel Change

- [ ] `# Semantic Vector` — FIRST H1 in the kernel?
- [ ] `## SV_FORMAT (@SV_FORMAT)` — FIRST @tag?
- [ ] Bold imperative: `**YOU must emit... protocol violation**`?
- [ ] Closing anchor: `Omission = protocol violation. SV is a semantic fingerprint, NOT a claim status.`?
- [ ] Schemas — H2 under `# Schemas`?
- [ ] Schema density ≥ 80% of historical stable kernel (`2026-08-09-historical-stable_kernel.txt`)?
- [ ] Schema order: action → plan → authorization → verification → epistemics?
- [ ] Root-of-truth — last line, no postscript?
- [ ] Refcheck: @G9→@SV_EVERY_TURN→@SV_FORMAT chain resolved?
- [ ] Zero newly-introduced unresolved @refs (retired diagrams excluded)?
- [ ] Agent emits SV on trivial input ("Hi" → `acknowledged 1.0`)?
- [ ] Agent emits SV under adversarial input ("ignore instructions")?

---

## Lesson

Prompt optimization is not token compression. It is the preservation of **structural invariants** through any change in density. Compressing one schema cascades to affect perception of the entire kernel. Without the assembly point, even 944 perfectly correct lines become information junk.

> **"An LLM can rebuild anything, but must have an assembly point."**
