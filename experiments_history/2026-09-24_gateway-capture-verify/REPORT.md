# Gateway capture re-verification (2026-09-24)

Instrument: `compare.py` — read-only comparer of `.opencode/data/gateway/per-request`
against `raw-wire` for every exchange present. No writes, no product imports.

Run (edit `ROOT` inside if the worktree moves):

```
python experiments_history/2026-09-24_gateway-capture-verify/compare.py
```

Result, 2026-09-24 (21 exchanges present at the time):

- `body` + `headers` identical in **21/21** per-request ↔ raw-wire pairs; wrapper
  keys differ exactly `{type, timestamp, id}`.
- Stored bodies are PARSED (`dict`), not verbatim wire bytes.
- Transport-added headers (`host`, `content-length`, `accept-encoding`,
  `connection`) absent from every raw-wire file — only SDK-set names ever appear.
- Four exchanges lack `per-response` entirely; all four share the log signature
  `request.start → limiter.acquire → stream.acquire → stream.first_chunk` with no
  `request.end` (aborted/cancelled streams).

This is the evidence `plans_completed/2026-09-24_gateway-three-point-capture.md`
cites for C1 and for the pre-change baseline (S1/S2). Post-change schema is covered
by `packages/opencode/test/provider/adaptive-client.test.ts`; keep this script as a
re-runnable check of the raw capture directories whenever the contract changes.
