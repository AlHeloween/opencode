# Documentation

## Memory / session (canonical)

- [Mechanistic Compaction](compaction.md) — **canonical** Layer-1 summary outside content + Layer-2 compact
- [Summary Exact handles](summary-exact-handles.md) — tool write/edit/multiedit filediffs + CodeGraph (critical; Fossil = rollback only)
- [Session memory graph](session-memory-graph.md) — end-to-end mermaid: cadence vs safety
- [Finish-step TX graph](finish-step-tx-graph.md) — `runBatch` / single SQLite TX at step boundary

## Product / stack

- [Rendering Pipeline](rendering.md) — LLM→terminal display, mermaid, images
- [Architecture](architecture.md) — prompt system, checkpoint, compaction, agents, KV cache
- [Agentic reasoning runtime](agentic-reasoning-runtime.md) — gates, REUSE ladder, claim ledger, host-agnostic SPECS
- [Reasoning framework](reasoning-framework.md) — kernel package / SPECS / IR
- [AGI Workflow](agi-workflow.md) — orchestrator/worker loop, plan hygiene
- [Startup & bootstrap](startup-bootstrap.md) — cold start, CodeGraph, Fossil vs git/jj
- [Fossil snapshot system](fossil-snapshot.md) — **canonical** agent undo/redo leaves, extras cleanup, HISTORY_INVALID
- [External File Locations](external-file-locations.md) — where opencode reads/writes files
- [Linux deploy](linux-deploy.md) — Linux build and portable install
- [Tools and sidecars](tools-and-sidecars.md) — `tools/` binaries, Fossil/rg/markdownify
- [Background Jobs](background-jobs.md) — non-blocking shell jobs, `joboutput` / `pattern`, TUI
- [ADID Framework 15.4.3](ADID_Framework_15_4_3.md) — safe-update manager contract
- [Reasoning Kernel Tests](../tests/test_reasoning_kernel.py) — pytest for the reasoning kernel
