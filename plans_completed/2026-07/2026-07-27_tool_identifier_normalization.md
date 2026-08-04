# Tool identifier normalization (completed)

## Prior art

N/A — local `Tool.define`, `ToolRegistry`, and provider repair path define the contract.

## Smoke Tests

| Stage | Command | Expected | Actual |
|---|---|---|---|
| Baseline | `cd packages/opencode; bun test test/tool/registry.test.ts test/agent/agent.test.ts` | Current suite passes before the change | Actual [Exact]: 42 pass, 6 fail — 3 stale agent-policy expectations and 3 custom-tool tests time out at 5 s. |
| Post-implementation | `cd packages/opencode; bun test test/session/tools.test.ts test/session/llm.test.ts test/session/message-v2.test.ts` | All provider-visible OpenCode tool IDs match `^[a-z0-9]+$`; legacy hyphen/underscore call names repair to the canonical ID; suite passes | Actual [Exact]: 52 pass, 0 fail. |
| Post-implementation | `cd packages/opencode; bun typecheck` | Typecheck passes | Actual [Exact]: pass. |
| Post-implementation | `cd tests; python -m pytest test_reasoning_kernel.py -q` | Generated kernel matches Python source | Actual [Exact]: 271 pass. |

## Work

- [x] Define one canonical provider-visible tool identifier: lowercase ASCII letters and digits only; reject collisions after canonicalization.
- [x] Canonicalize built-in, plugin, and MCP provider-visible names while retaining their original internal executor and permission binding.
- [x] Repair legacy `_` and `-` incoming call names to the canonical exposed ID before execution.
- [x] Preserve legacy user tool-disable settings and GitLab workflow alias execution.
- [x] Serialize persisted legacy tool history with the canonical provider name.
- [x] Update tool-help `.txt` names and focused real implementation tests.

Keywords: tool-identifiers, provider-schema, DeepSeek, DSML, cache-era
