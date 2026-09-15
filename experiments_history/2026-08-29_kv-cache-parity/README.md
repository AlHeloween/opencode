# KV-Cache Parity Harness

Experiments for the 2026-08-27 cache-loss regression investigation.
Plan: `plans/2026-08-28_kv-cache-parity-guard.md`.

## Contents

| File | Purpose |
|------|---------|
| `2026-08-28_analyze_cache_timeline.py` | Timeline analyzer: per-turn cache stats, poisoning events, request diffs, anchor oracle |

## Analyzer usage

```bash
# Full report (reads .opencode/data/log/*_log_*.jsonl + *_diff_*.diff)
python experiments/2026-08-29_kv-cache-parity/2026-08-28_analyze_cache_timeline.py

# Oracle mode — asserts the three 2026-08-27 regression anchors (exit 1 if missing)
python experiments/2026-08-29_kv-cache-parity/2026-08-28_analyze_cache_timeline.py --require-anchors

# Filters
python ... --session ses_fba5 --since 2026-08-27T23:40 --out report.md
```

Columns: `hit`/`miss` rows carry provider usage (`input` = uncached tokens,
`cacheRead` = cached prefix); `mutation` rows are mid-session system prompt
changes (cache poisoning); `reset` rows are compaction shrinks; `marker` rows
show whether an explicit provider cache marker was sent.

## Live replay procedures (E2–E4)

These scenarios run through **normal TUI usage** (no invented server API).
After each scenario, run the analyzer with the matching filter and record the
row in the matrix below.

### E2 — cold-start matrix

| Scenario | Procedure | Metric |
|----------|-----------|--------|
| within TTL | continue same worktree within ~5 min of previous session | first request `cacheRead` of new session |
| after pause | wait 20+ min, new session | first request `cacheRead` |
| after restart | close opencode, reopen, continue session | first request `cacheRead` (expected full miss — anchor C1) |

Recorded 2026-08-27: within-TTL new session hit **41024** cached (ratio 0.805,
anchor C3); after restart+23 min gap: **0** cached / 176137 uncached (anchor C1).

### E3 — nested-AGENTS touch (Layer-2 mutation)

1. Start a session that only touches files in the repo root (system stays N msgs).
2. Mid-session, read/edit a file under `packages/opencode/` (its own AGENTS.md).
3. Run analyzer — a `mutation` row must appear (anchor C2: 95038→150706 @line 1188).
   The next request re-prefills the whole system prefix.

### E4 — clean-turn baseline

Ask 5+ single-shot questions with NO tool use between them. Analyzer `Summary`
`uncached tokens on hits` median is the clean-turn floor.

Recorded 2026-08-28 00:04–00:25 (this worktree, glm-5.3-flash/openrouter):
clean turns **108–209** uncached (ratio 0.998–0.999); tool-heavy turns
**2.4k–12k** uncached proportional to new tool-result bytes (10–33 KB).

## Findings so far (2026-08-27/28 logs)

1. Steady-state flow is healthy: median hit ratio 0.990; clean turns 108–209
   uncached ≈ the historical 56–100 world. "2–3k per turn" perception =
   tool-result bytes in the new tail (unavoidable, cached next turn).
2. Real losses are event-shaped: process restart (176k), mid-session system
   mutation via nested AGENTS.md injection (95k→150k chars), compaction
   (77942 shrink → 0.392 ratio re-prefill).
3. No explicit provider cache marker is ever sent (`hasCacheControl=False` on
   all 46 marker checks) → implicit cache only, TTL- and routing-fragile.
4. Guard added in this plan (llm.ts `checkMessagesStability`) now warns
   `bug: sent message content mutated mid-session` if already-sent wire
   history changes — the automated alarm the removed speculative audit used
   to provide, at O(1) per message.
