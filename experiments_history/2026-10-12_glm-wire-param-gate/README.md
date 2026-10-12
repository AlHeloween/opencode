# 2026-10-12 — learned wire-param gate (GLM-5.3-Flash on opencode-go)

Instrument for plan `plans_completed/2026-10-12_model-wire-param-gate.md`. Self-contained:
the two config files the scripts need are materialized at run time from the committed
`*.skeleton` twins (the repo-wide `.gitignore` hides `opencode.jsonc` and
`experiments_history/**/.opencode/` everywhere, so only the skeletons are tracked).

## Run it

```
bun stub-server.mjs            # keep running; listens on 127.0.0.1:8791
run-stub.cmd                   # then, in a second shell — expects: PONG
```

The stub rejects any body carrying `repetition_penalty` with the measured zen/go 400
(`[unknown_parameter] … unknown field`), answers SSE `PONG` otherwise. A first-ever run
therefore exercises the whole auto-heal: 400 → the runtime records the fact in
`provider_fact` → retries 2 s later without the field → `PONG`. Run it again: the first
request is already clean (the fact is durable).

`run-glm.cmd` is the live variant against real zen/go GLM-5.3-Flash (needs the repo's
`bin/` auth config). Both scripts HARD-STOP if `stand/` or a skeleton is missing — an
unguarded `cd` here once fell through and ran opencode in a foreign cwd (measured
2026-10-12: `NotFound: FileSystem.writeFile (…config\.gitignore)`).

## Recorded result (host runs, 2026-10-12)

- `20261012T050006Z_eab16811` — first-ever run: 400-with-field → retry-without → exit 0,
  `PONG`; `provider_fact` row `{"unsupportedParams":["repetition_penalty"]}`.
- `20261012T050028Z_2eed673d` — second run: first and only request already clean → `PONG`.
- `20261012T050048Z_baac8c56` — live zen/go `glm-5.3-flash` (seeded rung): exit 0, `PONG`;
  wire body `…"prompt_cache_key":…,"reasoning_effort":"max",…` — no `repetition_penalty`.
- `20261012T053353Z_049d69a2` — re-run from THIS archive (fresh stand DB): full heal pair.
- `20261012T053510Z_a4b9ed8c` — fresh-clone simulation (only committed files, skeletons
  materialized by the script): exit 0, `PONG`, heal pair appended to `stub-requests.jsonl`.

Not archived here (public-safety: full request bodies): wire dumps and the sandbox trees;
they live under the gitignored `experiments/` while in use.

Notes: pin `protocol: "http/1.1"` for a plain-http loopback provider — h3 is unsupported
there and the h2 rung came back silently empty (measured 2026-10-12); the skeleton carries
that pin. Running the example also creates `config/.gitignore` and `config/node_modules/`
(runtime artifacts of the source run) — both gitignored.
