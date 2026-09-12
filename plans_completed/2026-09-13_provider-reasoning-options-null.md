---
reproduce:
  files:
    - packages/opencode/src/provider/provider.ts
    - packages/opencode/test/provider/provider.test.ts
    - _run.cmd
  commands:
    - bun test packages/opencode/test/provider/provider.test.ts
    - _run.cmd
  inputs: A registry model containing reasoning_options.values with a null item.
  expected_outputs: Invalid options do not cross the Provider.Model boundary; /provider completes without SchemaError.
---

# Provider reasoning-options null repair

## Goal
Prevent malformed registry metadata from terminating OpenCode before a session is created, without advertising an unsupported reasoning control.

## Contract
`reasoning_options.values` is either absent or a complete string array. A registry option containing a non-string value is rejected at the ModelsDev-to-Provider boundary; `capabilities.reasoning` remains unchanged.

## Tasks

| Task | Surface | Oracle |
|---|---|---|
| Normalize malformed options | `src/provider/provider.ts` | focused model-conversion test |
| Cover the null regression | `test/provider/provider.test.ts` | fails before fix, passes after |
| Reproduce boot | `_run.cmd` | `/provider` no longer reports the Sarvam schema error |

## Risks
Dropping malformed option metadata can hide an upstream capability. This is safer than exposing an untyped control; valid catalog values pass unchanged.