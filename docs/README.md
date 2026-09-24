# Documentation

## Memory / session (canonical)

- [Mechanistic Compaction](compaction.md) — **canonical** Layer-1 summary outside content + Layer-2 compact
- [Summary Exact handles](summary-exact-handles.md) — snapshot anchors (fossil range diff) + tool filediffs + CodeGraph (critical)
- [Session memory graph](session-memory-graph.md) — end-to-end mermaid: cadence vs safety
- [Finish-step TX graph](finish-step-tx-graph.md) — `runBatch` / single SQLite TX at step boundary

## Product / stack

- [Rendering Pipeline](rendering.md) — LLM→terminal display, mermaid, images
- [Architecture](architecture.md) — prompt system, checkpoint, compaction, agents, KV cache
- [Agentic reasoning runtime](agentic-reasoning-runtime.md) — gates, REUSE ladder, claim ledger, host-agnostic SPECS
- [Kernel package](../prompt_kernel/README.md) — gate graph, serialization order, source of the runtime prefix
- [Kernel assembly point](kernel-assembly-point.md) — where `source.py` becomes `reasoning_prompt.txt`
- [Two-canon protocol](two-canon-protocol.md) — ADID 15.3 ↔ kernel parity: one protocol, two compilers
- [Reasoning mode](reasoning-mode.md) — memory-only calibration identity, no execution surface
- [System prompt order](system-prompt-order.md) — slot order; any mid-prefix mutation is a full cache miss
- [UNIVERSAL_ENV](system-prompt-universal-env.md) — the immutable `system[0]` head
- [CodeGraph MCP](codegraph-mcp.md) — live graph contract + readonly SQLite pack
- [Session recovery](session-recovery.md) — portable replay after a moved worktree
- [Run lifecycle semantics](run-lifecycle-semantics.md) — join, supersede, bounded cancel
- [Gate add-ons](gate-addons.md) — advisory path bindings per kernel gate, addon registry, budget guardrails
- [AGI Workflow](agi-workflow.md) — orchestrator/worker loop, plan hygiene
- [Startup & bootstrap](startup-bootstrap.md) — cold start, CodeGraph, Fossil vs git/jj
- [Fossil snapshot system](fossil-snapshot.md) — **canonical** agent undo/redo leaves, extras cleanup, HISTORY_INVALID
- [External File Locations](external-file-locations.md) — where opencode reads/writes files
- [Linux deploy](linux-deploy.md) — Linux build and portable install
- [Tools and sidecars](tools-and-sidecars.md) — `tools/` binaries, Fossil/rg/markdownify
- [Gateway three-point capture](gateway-capture.md) — intent / wire / response under one exchange key; masking, terminal states, derived views
- [Background Jobs](background-jobs.md) — non-blocking shell jobs, `joboutput` / `pattern`, TUI
- [ADID Framework 15.3](ADID_Framework_15_3.md) — safe-update manager contract. Frozen, untracked,
  package-rendered; still the reference standard for kernel design, but only realizable on MHA-class
  attention — see [two-canon-protocol.md](two-canon-protocol.md) § 3 for why it did not port to MLA
- [Kernel tests](../prompt_kernel/tests/) — `python -m pytest prompt_kernel/tests/ -q` (78 tests)

## Measured vendor behaviour

- [Reasoning round-trip contract](reasoning-round-trip-contract.md) — cross-vendor reasoning field behaviour
- [DeepSeek thinking cache](deepseek-thinking-cache.md) — measured thinking vs prompt cache
- [ChatGPT OAuth cache](chatgpt-oauth-cache.md) — SDK cache key, tool-result replay, and what still needs live measurement
- [StreamLake/KAT thinking cache](streamlake-kat-thinking-cache.md) — measured gateway cache semantics
- [CoT research](cot-reasoning-research.md) — how chain-of-thought length affects task execution
