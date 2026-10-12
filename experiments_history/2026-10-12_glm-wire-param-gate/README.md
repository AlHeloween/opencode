# 2026-10-12 — learned wire-param gate (GLM-5.3-Flash on opencode-go)

Instrument for plan `plans/2026-10-12_model-wire-param-gate.md` (now completed). Re-runnable:
start `stub-server.mjs` (bun), then `run-stub.cmd` — the stub rejects any body carrying
`repetition_penalty` with the measured zen/go 400, answers SSE "PONG" otherwise.

Recorded result (runs on this host, 2026-10-12):

- `20261012T050006Z_eab16811` — first-ever run against the stub: request WITH the field → 400,
  the runtime LEARNED the fact and retried 2.06 s later WITHOUT the field → 200, exit 0, `PONG`.
  `provider_fact` row: `{"unsupportedParams":["repetition_penalty"]}`.
- `20261012T050028Z_2eed673d` — second run: first and only request already clean (durable
  across processes) → `PONG`.
- `20261012T050048Z_baac8c56` — live zen/go `glm-5.3-flash` through the compiled seed: exit 0,
  `PONG`; wire body `…"prompt_cache_key":…,"reasoning_effort":"max",…` — no `repetition_penalty`.

`stub-requests.jsonl` is the stub-side log of every request (field present?).

Not archived here (would fail the public-safety content scan and live under gitignored
`experiments/`): wire dumps carrying full request bodies, the sandbox project tree.

Note for re-users: pin `protocol: "http/1.1"` for a plain-http loopback provider — h3 is
unsupported there and the h2 rung came back silently empty (measured 2026-10-12); see
`run-stub.cmd`'s config dir.
