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
    last_audited: str = "2026-06-24"
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
        DocRecord("docs/ADID_Framework_15_4.md", "ADID team", "Epistemic markers, semantic vectors, AGI Reasoning Kernel, Python-native kernel"),
        DocRecord("opencode_prompts_kernel.py", "opencode team", "Reasoning kernel: enums, contracts, validators, state machine, bug fix protocol, 32 project specs"),
        DocRecord("tests/test_reasoning_kernel.py", "opencode team", "165 pytest tests covering all kernel algorithms, contract validation, classification, state machine, integration"),
        DocRecord("docs/architecture.md", "OpenCode team", "System architecture: prompt, checkpoint, agents, media, cache/diff"),
        DocRecord("docs/external-file-locations.md", "OpenCode team", "File paths opencode reads/writes outside worktree"),
    ])
    
    specs: list[DocRecord] = field(default_factory=lambda: [
        DocRecord("specs/project.md", "OpenCode team", "API spec for project/session management"),
        DocRecord("specs/v2/session.md", "OpenCode team", "v2: remove dedicated POST /session/:id/init"),
    ])
    
    effect_specs: list[DocRecord] = field(default_factory=lambda: [
        DocRecord("specs/effect/migration.md", "OpenCode team", "Effect migration pattern"),
        DocRecord("specs/effect/schema.md", "OpenCode team", "Effect schema conventions"),
        DocRecord("specs/effect/tools.md", "OpenCode team", "Effect tool patterns"),
        DocRecord("specs/effect/routes.md", "OpenCode team", "Effect route patterns"),
        DocRecord("specs/effect/http-api.md", "OpenCode team", "HTTP API design"),
        DocRecord("specs/effect/facades.md", "OpenCode team", "Facade patterns"),
        DocRecord("specs/effect/instance-context.md", "OpenCode team", "Instance context pattern"),
        DocRecord("specs/effect/loose-ends.md", "OpenCode team", "Loose ends / known gaps"),
        DocRecord("specs/effect/server-package.md", "OpenCode team", "Server package design"),
    ])
    
    upstream: list[DocRecord] = field(default_factory=lambda: [
        DocRecord("upstream_comparison/README.md", "OpenCode team", "Fork point, divergence summary, adoptable patterns"),
    ])

INDEX = DocIndex()

# Verify: {len(INDEX.governance)} governance docs, {len(INDEX.technical_docs)} technical docs,
# {len(INDEX.specs)} specs, {len(INDEX.effect_specs)} effect specs, {len(INDEX.upstream)} upstream docs
