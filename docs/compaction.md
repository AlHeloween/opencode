# Session memory & compaction — **code-aligned** (2026-07-30)

**Canonical for agents.** If this disagrees with older AGENTS.md snippets or
design essays, **this file + TypeScript win**.

**Code:** `prompt.ts`, `compaction.ts`, `overflow.ts`, `processor.ts`,
`incremental-checkpoint.ts`, `checkpoint.ts`  
**Graphs:** [`session-memory-graph.md`](session-memory-graph.md)

---

## What actually runs (Exact)

### A. Normal turn end (`processor` → `stop`)

```text
finishStep (1 SQLite TX: part + message + cost)
  → Checkpoint.publish M + async persist
  → maybeCaptureSidecar(...)     // may no-op
  → break prompt loop
```

**No `compact()` on this path.**  
Layer-2 materialization is **not** “after every 65K user turn completes.”

### B. Sidecar capture — `maybeCaptureSidecar` (only Layer-1 that fires in loop)

Called **only** on the `stop` path above (after checkpoint).

| Check | Code |
|-------|------|
| Assistant turn complete | `isAssistantTurnComplete` |
| Not already capturing | `sidecarInFlight` |
| Open window | `computeOpenWindowTokens(visible, latestOpen?.toMessageID)` ≥ `summaryWindowLimit(target=65_536)` |
| Request fit | `estimateRequestTokens(open) < usable()` i.e. content/4 **+ 10_000** |
| Non-empty range | slice after boundary |
| LLM | ephemeral stream: checkpoint system+messages + `summaryRequestProse()`, `toolChoice: "none"` |
| Accept body | `isValidSummaryBody` (4 headings) |
| Persist | `IncrementalCheckpoint.save` → **`project_checkpoint`** |
| Visible M | **unchanged** (no Message/Part for body) |

Sidecars are **not** in the message stream. They sit in SQLite
`project_checkpoint` until compact materializes them.

### C. In-band `compact()` gate in the prompt **while** loop

Located **after** the “terminal turn complete → **break**” check:

```text
if (assistant complete && !tools && lastUser < lastAssistant && !summaryAttempt)
  → break   // NEVER reaches compact gate
step++
if (needsContentCompaction(open ≥ 65_536) && …)
  → compact() → continue
```

So **in-band compact only runs when the loop does not exit** — e.g. tool-call
continuation, incomplete turn, pending **legacy** summary attempt, etc.

It does **not** mean: “every time open window hits 65K at end of a normal turn.”

### D. Emergency `compact()` from processor

On finish-step, if provider tokens overflow or `contentTokenEstimate ≥ usable()`:

```text
ctx.needsCompaction = true → process result "compact"
  → prompt loop: compaction.compact(...) → continue
```

This **does** run on hard context pressure independent of the break-before-gate issue.

### E. `injectSummaryRequest` (legacy API)

| Fact | Mark |
|------|------|
| Still implemented in `compaction.ts` | Exact |
| Still exported / on Service | Exact |
| **Called from `prompt.ts` loop** | **Exact false** — zero call sites in `src/` outside compaction module |
| Loop still *handles* pending summary user messages (`summaryAttempt`) | Exact — for old DB state / manual inject |

Do **not** document inject-as-primary. It is dead primary path unless something
outside the loop calls the export.

---

## Token formulas (Exact)

| Purpose | Formula | Used for |
|---------|---------|----------|
| Open window | `ceil(contentChars / 4)` from msgs after sidecar `toMessageID` (or full visible if none) | Sidecar threshold; in-band compact gate |
| Sidecar schedule | `open ≥ summaryWindowLimit(65_536)` | May be **&lt; 65K** on small context (LLM headroom) |
| Sidecar fit | `open/4 + 10_000 < usable()` | Safety |
| In-band compact | `open ≥ 65_536` exactly (`needsContentCompaction`) | **Only if loop continues** |
| Emergency | `isOverflow(tokens)` or request estimate ≥ `usable()` | Processor |
| Request estimate | content/4 + **10_000** | Safety; **no** BPE/tiktoken |

Cadence open-window is **content only** (no +10k).  
Tokenizer WASM stack **removed** — undercounted vs providers.

---

## What `compact()` does (ZERO LLM tokens)

Always pure DB/system work:

1. Load messages (limit 10k).  
2. `visible = !compacted`.  
3. If lone `message*` and not `force` → **no-op**.  
4. Collect **open** sidecars (`listOpen`) + **legacy** `assistant.summary` after prior star.  
5. `Recent` = visible after latest boundary (sidecar/summary id), exclude prior star.  
6. If **no** summaries/sidecars and Recent huge → trim Recent by `threshold`.  
7. `buildMessageStar` → text starting with `=== COMPACTED ===`.  
8. Soft-hide **all** current visible (`compacted=true`).  
9. Insert **one new** synthetic user message + text part (`message*`).  
10. `materialize` open sidecar ids onto that message.  
11. Bus `session.compacted`; remove provider checkpoint (caller).

**Not** a second type `message**` — each compact creates a **new** star row;
previous star is soft-hidden; body may chain `priorMessageStarId` + Decisions.

### Visible loop (honest)

```text
# Growth
visible: (m, m, m)
open checkpoints: [s…]   # optional, separate table

# After stop: maybe sidecar only (no compact)
visible: (m, m, m)
open: [s…] or still empty

# When compact actually runs (emergency, or in-band if loop continues):
soft-hide all visible
materialize open s…
visible: (message*)          # single synthetic user

# Growth again
visible: (message*, m, m, …)
open: new s when maybeCaptureSidecar succeeds on later stops

# Compact again
visible: (message*)          # new star; old star soft-hidden
```

---

## Model vs system (still true)

| Owner | Content |
|-------|---------|
| Model Inferred | SV / Goal / Key decisions / Current state (sidecar body or legacy summary body) |
| System Exact | IDs, ranges, fossil diffs, CodeGraph impact, materialize, soft-hide |

---

## Forbidden (engineering)

| Never | Why |
|-------|-----|
| Claim “injectSummaryRequest every 64K” as runtime | Not called from prompt loop |
| Claim “compact on every turn end at 65K” | Break exits before gate; stop path has no compact |
| Gate zero-token compact on `usable()` for cadence | Emergency only |
| Model-authored IDs/diffs | Exact is system |
| Hard-delete messages | Archive for session-read |

---

## Known gaps (not papered over)

1. **In-band 65K compact vs break order** — completed normal turns exit without hitting `needsContentCompaction`. Cadence compact depends on loop-continue paths or emergency. Fixing that is a **code** change, not a doc claim.  
2. **Dual path leftovers** — inject API + summaryAttempt handling + compact still folds `assistant.summary`.  
3. **Sidecar without later compact** — open checkpoints pile up until compact runs (emergency or in-band continue).  
4. **Docs historically mixed design (inject) with code (sidecar)** — this file is the correction.

---

## Related

| Doc | Role |
|-----|------|
| [`session-memory-graph.md`](session-memory-graph.md) | Mermaid of real control flow |
| [`finish-step-tx-graph.md`](finish-step-tx-graph.md) | finishStep TX (orthogonal) |
| [`architecture.md`](architecture.md) | Must match this file’s Exact claims |
