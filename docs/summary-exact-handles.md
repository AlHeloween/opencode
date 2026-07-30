# Summary Exact handles (Fossil + CodeGraph)

**Critical contract** for Layer-1 `s` rows (`project_checkpoint` / enrichRange).  
Aligned with code: `session/summary.ts` (`snapshotRangeForMessages`, `enrichRange`).

---

## Content vs summary (unchanged)

```text
Content flow M:  [m m m] [m m m] …     ← provider-visible, never polluted by s
Summary store:        s1      s2       ← DB outside content (project_checkpoint)

After summary request: M is the same as before the summary call.
s is consumed only at compact → m* = [s…, recent m…]
```

---

## Fossil endpoints (not per message)

```text
Summary range messages:  [ m_a … m_z ]     (from_id … to_id)
Before range:            [ … messages before from_id … ]

from = last Fossil hash PRIOR to the range
       (if none: first hash IN the range — first segment baseline)
to   = LAST Fossil hash IN the range
       (even when the range has many step/patch hashes)

if no hash in range → SKIP Exact fossil (no invent)
if both endpoints   → diffFull(from, to) + CodeGraph impact(from, to)
```

### Why “last in range”

A ~64k-token content segment may include **many** tool steps:

```text
prior: H0
range: H1 (edit a) → H2 (edit b) → H3 (edit c)

from=H0, to=H3  → one fossil span covering ALL WC changes in the summary window
                 → CodeGraph can describe all changed elements in that span
```

Using only the first hash in range would miss later edits.

### Hash sources on a message

| Part type | Field |
|-----------|--------|
| `step-start` | `snapshot` |
| `step-finish` | `snapshot` |
| `patch` | `hash` (+ `files[]` for undo, not required for endpoint pick) |

No requirement that every message has a hash.

---

## Pipeline (stop path)

```text
1. finishStep
2. Checkpoint.publish + await Checkpoint.persist   ← durable M freeze first
3. maybeCaptureSidecar
     - open since last s ≥ summaryWindowLimit
     - ephemeral LLM → AI body (Inferred)
     - isValidSummaryBody checker
     - enrichRange(range, beforeMessages):
         fossil pair? → diffs + CodeGraph
         else → empty Exact
     - save project_checkpoint (body + diffs + impact)
4. maybeCompactCadence (full visible ≥ 65K) → m*
```

---

## Tests

Pure unit suite (no Fossil binary):

```text
packages/opencode/test/session/summary.test.ts
  describe("SessionSummary.snapshotRangeForMessages (fossil Exact contract)")
```

Cases: multi-hash last wins, prior preferred, skip if no hash in range, first-segment baseline, empty range.

---

## Claim ledger

| Claim | Mark |
|-------|------|
| s outside content flow | Exact (project_checkpoint) |
| from = prior else first-in-range | Exact |
| to = last hash in range | Exact |
| multi-hash → full span for CodeGraph | Exact |
| no hash in range → skip | Exact |
| checkpoint disk before sidecar | Exact (`await persist`) |
