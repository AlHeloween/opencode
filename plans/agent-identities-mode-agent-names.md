# Switchable identities: `*_mode` / `*_agent` (reject always-Build)

## Status: DONE (kernel + runtime core 2026-08-07)

## Summary

- Protocol = `GATED_WORKFLOW` (shared). Identity switches; not a single “GATED agent.”
- Canonical ids: `build_mode`, `plan_mode`, `reasoning_mode`, `coder_agent`, `explorer_agent`, …
- `providerIdentityForMode` returns the **real** agent.
- Kernel: `@IDENTITIES`, `@GATE_IDENTITY_DISPATCH`, BUILD_MODE/PLAN_MODE SPECS, contract ids `agent.*_mode` / `agent.*_agent`.
- Runtime: agent.name rename + short-name aliases in `Agent.get` for migration.

## Smoke

```bash
python -m pytest prompts_kernel/tests/ -q
cd packages/opencode && bun test test/session/mode-transition.test.ts test/agent/agent.test.ts test/agent/orchestrator.test.ts
```

## Notes

- Old checkpoint slots keyed by `build` will not match `build_mode` (acceptable).
- Codegraph tool mode `"explore"` is unrelated to `explorer_agent`.
