<!-- intention: the plan reader drops a box's sv tag without a word when the box has no bold ID, and MASTER_PLAN.md has two writers -> every tag written on a box is either read or reported as unreadable, and the map has exactly one writer -->
<!-- goal_sv: plan-parser, silent-loss, sv-tag, single-writer, master-plan -->
# Plan reader: silent sv-tag loss, and the map's second writer

```yaml
Keywords: plan-parser 0.30, silent-loss 0.25, sv-tag 0.20, single-writer 0.15, master-plan 0.10
Semantic dominant: The component that closes the loop must not lose a box's vector silently, and the map must have one writer.
md5: 71c3e9a05b2f48d6e0a7c1b9f3d52e68
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

**Status:** OPEN — handoff from the cua/installer session (2026-09-30) to the owner of `util/plan-status.ts` and of
the map renderer (the robot's SVM work, `plans/2026-09-29_svm-tool-and-master-plan.md`, keeps `plan-status.ts` out of
its own scope, hence a separate plan). Nothing here was changed by the reporting session.

## Findings (read in code, reproduced by reading plans through `parsePlanFiles`)

1. **Tags on a box without a bold ID are dropped silently.** `src/util/plan-status.ts:264` —
   `parseTaskTags(structured ? after : "")`: an unstructured box gets an empty tag string, so its
   `<!-- sv: … | done_pct | attempts | last_failure -->` is never read and nothing says so. Seen twice on 2026-09-30:
   `plans/2026-09-29_cua-windows-debug-input.md` smoke boxes carried `sv` tags and parsed `sv=0` until rewritten as
   `**X1 …:**` boxes (commit `1250937fb0`).
2. **An ID with a hyphen is truncated.** `:259` — `header.match(/^([A-Za-z0-9_]+)/)`: `**S-A static inventory:**`
   parsed as id `S` (six boxes collapsed to one id in `plans/2026-09-30_cua-supply-chain-audit.md` until renamed
   `SA…SF`). Tool names forbid `-`/`_` for a reason (AGENTS.md); box IDs have no such rule, so the reader should
   either accept the hyphen or report the truncation.
3. **`plans/MASTER_PLAN.md` has two writers** — the renderer and hand edits. On 2026-09-30 a hand insert made from a
   stale read split another plan's rendered line (restored in `5965f6ffff`). AGENTS.md § Storage Paradigm: a file with
   two writers is a race with no arbiter. Fix by construction: the renderer is the ONLY writer; a plan appears on the
   map by existing in `plans/` with its header, never by a hand line.

## Smoke Tests

- [ ] **P1 red:** a fixture plan with (a) an unstructured box carrying `<!-- sv: a, b -->` and (b) `**S-A x:**` — current reader returns `sv=[]` for (a) and id `S` for (b) (predicted red). <!-- sv: plan-parser, red-test, fixture -->
- [ ] **P2 green:** after the fix, (a) is read or reported, (b) is `S-A` or reported; existing plan-status tests stay green. <!-- sv: plan-parser, green, regression -->
- [ ] **P3 single writer:** a render run over a map carrying a hand line either removes it or refuses and names it; the next render is byte-identical. <!-- sv: single-writer, master-plan, render -->
