# Documentation

- [Rendering Pipeline](rendering.md) — full LLM→terminal display flow, TUI components, streaming, mermaid, images
- [Mechanistic Compaction](compaction.md) — stable continuous memory (summaries + links + soft-hide `message*`)
- [AGI Workflow](agi-workflow.md) — orchestrator/worker loop, plan hygiene, persistence, permissions
- [Architecture](architecture.md) — prompt system, checkpoint, compaction, agents, KV cache
- [Startup & bootstrap](startup-bootstrap.md) — cold start, InstanceBootstrap, Plugin.init, CodeGraph, Fossil vs git/jj, shell permissions
- [External File Locations](external-file-locations.md) — where opencode reads/writes files
- [Linux deploy](linux-deploy.md) — build and portable install of this fork on Linux (OpenTUI, Fossil, layout)
- [Tools and sidecars](tools-and-sidecars.md) — `tools/` binaries, resolution order, Fossil/rg/markdownify, Linux vs Windows packaging
- [Background Jobs](background-jobs.md) — non-blocking bash/cmd execution, stalled detection, job_kill, TUI visibility, state machine
- [ADID Framework 15.4](ADID_Framework_15_4.md) — ADID update manager framework specification
- [Reasoning Kernel Tests](../tests/test_reasoning_kernel.py) — 165 pytest tests for the reasoning kernel
