"""
Documentation Surface Index — defined as typed Python data.

All docs are tracked in the DocIndex dataclass structure below.
"""

from dataclasses import dataclass, field
from datetime import date

@dataclass
class DocRecord:
    path: str
    owner: str
    entrypoint: str
    status: str = "production"
    last_verified: str = ""

@dataclass
class DocIndex:
    """Full documentation surface index."""
    created: str = "2026-05-18"
    last_audited: str = "2026-09-11"
    maintainer: str = "Contributors to anomalyco/opencode"
    
    governance: list[DocRecord] = field(default_factory=lambda: [
        DocRecord("README.md", "OpenCode team", "Project landing page"),
        DocRecord("AGENTS.md", "OpenCode team", "Agent operational rules"),
        DocRecord("GEMINI.md", "OpenCode team", "AI assistant project overview"),
        DocRecord("CONTRIBUTING.md", "OpenCode team", "Contribution guide + policies"),
        DocRecord("SECURITY.md", "OpenCode team", "Security policy + scope"),
        DocRecord("LICENSE", "OpenCode team", "MIT license"),
        DocRecord("index.md", "OpenCode team", "Folder-based repository map"),
        DocRecord("DOCINDEX.md", "OpenCode team", "This file — documentation surface index"),
        DocRecord(".github/PULL_REQUEST_TEMPLATE.md", "OpenCode team", "PR template"),
    ])
    
    technical_docs: list[DocRecord] = field(default_factory=lambda: [
        DocRecord("docs/README.md", "OpenCode team", "Docs directory index"),
        DocRecord("docs/ADID_Framework_15_3.md", "ADID team", "Safe-update manager construction contract, epistemic markers, behavioral conformance oracle — reference only (15.4.3 retired to git history)"),
        DocRecord("docs/gate-addons.md", "Local_Development", "Gate add-on registries: OpenCode, Claude Code, and Codex harness bindings", last_verified="2026-09-12"),
        DocRecord("docs/architecture.md", "OpenCode team", "System architecture: prompt, checkpoint, agents, media, cache/diff, OpenRouter routing focus/pointer controls, per-model sampling, and StreamLake Vanchin PayGo endpoint profiles", last_verified="2026-09-13"),
        DocRecord("_application_workflow_diagram.md", "Local_Development", "Runtime module and function flow, including OpenRouter routing interaction, body/header identity, per-model sampling, and StreamLake Vanchin catalog-backed provider setup", last_verified="2026-09-14"),
        DocRecord("docs/external-file-locations.md", "OpenCode team", "File paths opencode reads/writes outside worktree"),
        DocRecord("docs/startup-bootstrap.md", "Local_Development", "Cold-start and instance bootstrap, including SQLite freeze-stage diagnostics", last_verified="2026-09-10"),
        DocRecord("docs/session-recovery.md", "Local_Development", "Portable session recovery and explicit db fix after a moved worktree", last_verified="2026-09-10"),
        DocRecord("docs/linux-deploy.md", "Local_Development", "Linux build + portable deploy for this fork (not upstream install.sh)"),
        DocRecord("docs/tools-and-sidecars.md", "Local_Development", "Sidecar tools inventory, resolution paths, Windows/Linux packaging, CUA no-focus launch, and visible Chrome 9222 debugging policy", last_verified="2026-09-13"),
        DocRecord("docs/fossil-snapshot.md", "Local_Development", "Agent undo/redo snapshot system: leaf semantics, track scope, performance envelope, HISTORY_INVALID recovery"),
        DocRecord("docs/streamlake-kat-thinking-cache.md", "Local_Development", "Measured thinking vs prompt cache semantics of the StreamLake/KAT gateway (include_usage, 64-token hits, ignored chat_template_kwargs)"),
        DocRecord("docs/deepseek-thinking-cache.md", "Local_Development", "Measured thinking vs prompt cache semantics of DeepSeek v4 (auto usage, 128-token units, cold-turn cost, CoT echo rules incl. the 2026-09-12 misattribution correction, refuted user_id isolation)"),
        DocRecord("docs/reasoning-round-trip-contract.md", "Local_Development", "Cross-vendor reasoning round-trip contract (measured 2026-08-28, corrected 2026-09-12): the DeepSeek tool-turn 400 fires on a non-server-issued tool_call id, NOT a missing reasoning_content; OpenRouter strips reasoning fields, Z.AI native field; gateway rewrite + smoke-test recipe", last_verified="2026-09-12"),
        DocRecord("docs/cot-reasoning-research.md", "Local_Development", "Research: how CoT affects task execution (Hi-CoT, TOPS, STITCH, Inkling, GPT-5) and why opencode drops reasoning echo"),
        DocRecord("docs/compaction.md", "Local_Development", "Compaction contract: s/m* layers, 64K sidecar cadence, 32K sidecar generation floor (16K reasoning window + 16K stored body), finish-step cost/cache accounting, star bounds 32K+32K", last_verified="2026-09-14"),
        DocRecord("docs/summary-exact-handles.md", "Local_Development", "Layer-1 summary Exact enrichment: checkpoint-M cache prefix, Constitution tool denial, file diffs and CodeGraph impact", last_verified="2026-09-14"),
        DocRecord("docs/run-lifecycle-semantics.md", "Local_Development", "Run lifecycle: internal join plus realtime user-turn supersede, bounded cancel with force-fail, project identity on session.updated, verified abort chain + no-data wedge note", last_verified="2026-09-10"),
        DocRecord("prompt_kernel/README.md", "Local_Development", "Kernel package: graph, serialization, OpenCode/Claude/Codex variant rendering", last_verified="2026-09-12"),
        DocRecord("docs/kernel-amendment.md", "Local_Development", "SELF_MODIFY depths, constitution core, amendment procedure and rollback point", last_verified="2026-09-13"),
        DocRecord("docs/kernel-assembly-point.md", "Local_Development", "Where the production prompt is assembled: prompt_kernel/source.py -> reasoning_prompt.txt"),
        DocRecord("docs/two-canon-protocol.md", "Local_Development", "Why ADID 15.3 and the reasoning kernel co-govern: one protocol, two compilers", last_verified="2026-09-06"),
        DocRecord("docs/agentic-reasoning-runtime.md", "Local_Development", "Runtime side of the kernel: gates, REUSE ladder, claim ledger", last_verified="2026-07-31"),
        DocRecord("docs/agi-workflow.md", "Local_Development", "AGI mode: orchestrator/worker loop, plan hygiene, reconcilePlans"),
        DocRecord("docs/reasoning-mode.md", "Local_Development", "REASONING_MODE identity: calibration phase with memory-only capability, no execution surface"),
        DocRecord("docs/system-prompt-order.md", "Local_Development", "System prompt slot order and why any mid-prefix mutation is a full KV cache miss"),
        DocRecord("docs/system-prompt-universal-env.md", "Local_Development", "UNIVERSAL_ENV: immutable system[0] head, its exact composition and cache contract", last_verified="2026-09-02"),
        DocRecord("docs/session-memory-graph.md", "Local_Development", "Session memory graphs: cadence vs safety view over the compaction contract"),
        DocRecord("docs/finish-step-tx-graph.md", "Local_Development", "Finish-step transaction graph: SyncEvent.runBatch plus cost in one SQLite TX"),
        DocRecord("docs/codegraph-mcp.md", "Local_Development", "CodeGraph MCP live-graph contract plus the readonly SQLite pack for agents"),
        DocRecord("docs/background-jobs.md", "Local_Development", "Non-blocking shell/cmd jobs: job IDs, polling, hang elimination"),
        DocRecord("docs/rendering.md", "Local_Development", "Rendering pipeline: LLM response to terminal display, mermaid, images", last_verified="2026-07-12"),
        DocRecord("packages/web/src/content/docs/providers.mdx", "OpenCode team", "Provider connection guide, including Anthropic Claude Pro/Max browser and paste-code OAuth", last_verified="2026-09-12"),
    ])
    
    specs: list[DocRecord] = field(default_factory=lambda: [
        DocRecord("specs/project.md", "OpenCode team", "API spec for project/session management"),
        DocRecord("specs/v2/session.md", "OpenCode team", "v2: remove dedicated POST /session/:id/init"),
    ])

INDEX = DocIndex()

# Verify: {len(INDEX.governance)} governance docs, {len(INDEX.technical_docs)} technical docs,
# {len(INDEX.specs)} specs
