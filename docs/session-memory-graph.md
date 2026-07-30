# Session memory — graphs

**Canonical contract + gap table:** [`compaction.md`](compaction.md)  
**Fossil/CodeGraph on s:** [`summary-exact-handles.md`](summary-exact-handles.md)

- Content without `s`; after durable checkpoint → summary; M restored; compact → `m*=[s,s,recent m]`
- Fossil: **prior hash** + **last hash in range** (multi-edit → one CodeGraph span)

If a graph is prettier than code, **code wins** for Exact claims.

---

## Intended content geometry

```text
M (content):   [m m m]     [m m m]     [m m m]
s (outside):        s1          s2          s3

compact → m* = [ s1, s2, recent m m m ]
           each s = AI body + Exact range/sessionread
                    + fossil(prior→last hash in range) + CodeGraph
           checker rejects incomplete agent fields
```

```text
when: await checkpoint persist (inferences done)
  → summary via user-message shape (ephemeral)
  → store s in DB outside content (+ Exact if hash pair)
  → M same as before summary
  → compact if total visible ≥ 65K
  → continue work
```

### Fossil on one summary window

```text
before: … H0
range:  H1 → H2 → H3   (many tool steps)
from=H0  to=H3  → one diff + CodeGraph over all WC edits
no hash in range → skip Exact
```

---

## Prompt loop (what actually happens — Exact)

```mermaid
flowchart TB
  START([loop iteration]) --> LOAD[load visible msgs]
  LOAD --> SUM{pending legacy\nsummary request?}
  SUM -->|yes| SA[summaryAttempt tools={}]
  SUM -->|no| CHK
  SA --> CHK

  CHK{assistant complete\nAND no open tools\nAND lastUser before lastAsst\nAND NOT summaryAttempt?}
  CHK -->|yes| BRK[break — turn end]
  CHK -->|no| STEP[step++]

  STEP --> SUB{subtask?}
  SUB -->|yes| HSUB[handleSubtask] --> START
  SUB -->|no| CAD{needsContentCompaction\nopen ≥ 65_536?}

  CAD -->|yes| CMP[compact ZERO tokens] --> START
  CAD -->|no| LLM[normal LLM.stream]

  LLM --> PROC[SessionProcessor]
  PROC -->|continue tools| START
  PROC -->|result compact| CMP2[compact] --> START
  PROC -->|result stop| STOP

  STOP --> CK[Checkpoint.publish M]
  CK --> SC[maybeCaptureSidecar]
  SC --> MC[maybeCompactCadence\nfull visible ≥ 65K?]
  MC -->|yes| CMPS[compact → m*]
  MC -->|no| BRK2
  CMPS --> BRK2[break]

  BRK --> END([idle])
  BRK2 --> END
```

**Contract path on completed work turns:**

`stop → checkpoint → sidecar? (s outside M) → compact if total visible ≥ 65K → break`

- Compact gate uses **full visible** content/4 (m stay in M until soft-hide).  
- Sidecar gate uses **open since last s** only.

---

## Sidecar only (Layer-1 that runs)

```mermaid
flowchart LR
  STOP[stop] --> FIT{open ≥ summaryWindowLimit\nAND requestTokens &lt; usable}
  FIT -->|no| SKIP[no-op]
  FIT -->|yes| EP[ephemeral LLM]
  EP --> VAL{valid 4 sections?}
  VAL -->|no| SKIP
  VAL -->|yes| ROW[(project_checkpoint)]
  ROW -.->|not in| M[visible messages]
```

---

## compact() data fold (when it *does* run)

```mermaid
flowchart TB
  IN[visible + open checkpoints] --> FOLD[buildMessageStar]
  FOLD --> HIDE[soft-hide all visible]
  HIDE --> STAR[new synthetic user message*]
  STAR --> MAT[materialize open sidecars]
```

---

## Token ownership

| Path | LLM? | Gate in code |
|------|------|----------------|
| Normal turn | yes | tools / stop |
| Sidecar | yes ephemeral | summaryWindowLimit + fit +10k |
| compact() | **no** | in-band 65K **if loop continues**; or emergency usable/overflow |
| injectSummaryRequest | would inject visible user | **not called from prompt loop** |

---

## Honest loop shape

```text
visible (m, m, m)
  stop → maybe sidecar in project_checkpoint; visible unchanged
  … more turns …
  stop → more sidecars (if thresholds pass)
  emergency overflow OR loop-continue + open≥65K
    → compact → visible (message*) only
  growth → (message*, m, m, …)
  … repeat …
```

Not: “every 65K at end of turn, inject summary then compact.”

---

## Claim ledger

| Claim | Mark |
|-------|------|
| Sidecar on stop after checkpoint | Exact |
| injectSummaryRequest unused by prompt loop | Exact |
| Break-before-compact on completed turns | Exact |
| compact zero LLM tokens | Exact |
| In-band needsContentCompaction can fire on tool-continue | Exact |
| Docs that said inject every 64K as primary | **False vs code** (fixed in compaction.md) |
