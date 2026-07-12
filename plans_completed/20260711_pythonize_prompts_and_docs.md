# Plan: Pythonize All Prompts, Docs, Tools & Skills

**Date:** 2026-07-11
**Goal:** Convert all prose-heavy prompt files, rules, skills, commands, and documentation in the opencode project to Pythonic style — same pattern as `_prompts` project.

---

## Inventory: What Needs Pythonization

### Tier 1 — Agent Prompts (loaded directly into LLM context)
These are the highest-impact targets — they ARE the prompts that agents read.

| # | File | Lines | Current Style | Pythonization Target |
|---|------|-------|---------------|---------------------|
| 1 | `packages/opencode/src/agent/prompt/orchestrator.txt` | 258 | Full prose: loop, workflows, rules | `OrchestratorConfig` dataclass + workflow enum |
| 2 | `packages/opencode/src/agent/prompt/coder.txt` | 35 | Prose guidelines | `CoderDirectives` dataclass |
| 3 | `packages/opencode/src/agent/prompt/explore.txt` | 28 | Prose guidelines | `ExploreDirectives` dataclass |
| 4 | `packages/opencode/src/agent/prompt/general.txt` | 27 | Prose + workflow reference | `GeneralDirectives` dataclass |
| 5 | `packages/opencode/src/agent/prompt/researcher.txt` | 33 | Prose guidelines | `ResearcherDirectives` dataclass |
| 6 | `packages/opencode/src/agent/prompt/media.txt` | 41 | Prose + TUI contract | `MediaDirectives` + `MediaContract` |
| 7 | `packages/opencode/src/agent/prompt/compaction.txt` | 11 | Prose summary rules | `CompactionRules` dataclass |
| 8 | `packages/opencode/src/agent/prompt/title.txt` | 46 | Prose + examples | `TitleDirectives` + `TitleExamples` data |
| 9 | `packages/opencode/src/agent/prompt/summary.txt` | 11 | Prose rules | `SummaryDirectives` dataclass |

### Tier 2 — Rules (loaded into system prompt)

| # | File | Lines | Current Style | Pythonization Target |
|---|------|-------|---------------|---------------------|
| 10 | `.opencode/rules/adid-framework-and-adm.mdc` | 180+ | Full prose rules | `AdidFrameworkRules` dict + `AdmDirectives` |
| 11 | `.opencode/rules/adid-rag.mdc` | 80+ | Prose + commands | `RagDirectives` dataclass |
| 12 | `.opencode/rules/semantic-coding-agent-drop-in.mdc` | 80+ | Prose coding rules | `CodingAgentDirectives` dataclass |

Note: `.codex/rules/` and `.cursor/rules/` are mirrors — update canonical `artefacts/rules/` then sync.

### Tier 3 — Skills (loaded into system prompt)

| # | Skill Directory | Lines | Current Style | Pythonization Target |
|---|----------------|-------|---------------|---------------------|
| 13 | `.opencode/skills/adm-exe/SKILL.md` | 115 | Prose + command table | `AdmExeSkill` dataclass + command registry |
| 14 | `.opencode/skills/cmd-runner/SKILL.md` | 80+ | Prose usage rules | `CmdRunnerDirectives` dataclass |
| 15 | `.opencode/skills/rag/SKILL.md` | 60+ | Prose + commands | `RagSkillDirectives` dataclass |
| 16 | `.opencode/skills/patch-tool/SKILL.md` | 20 | Prose | `PatchToolDirectives` dataclass |
| 17 | `.opencode/skills/agent-assets/SKILL.md` | 30 | Prose workflow | `AgentAssetsDirectives` dataclass |
| 18 | `.opencode/skills/adm-mcp-service/SKILL.md` | 30 | Prose | `AdmMcpDirectives` dataclass |
| 19 | `.opencode/skills/apply-patch-edits/SKILL.md` | 30 | Prose rules | `ApplyPatchDirectives` dataclass |
| 20 | `.opencode/skills/delphi_builder/SKILL.md` | — | Prose | `DelphiBuilderDirectives` dataclass |
| 21 | `.opencode/skills/dunit/SKILL.md` | — | Prose | `DUnitDirectives` dataclass |

### Tier 4 — Commands (agent slash-commands)

| # | File | Lines | Current Style | Pythonization Target |
|---|------|-------|---------------|---------------------|
| 22 | `.opencode/command/commit.md` | 37 | Prose + git templates | `CommitDirectives` dataclass |
| 23 | `.opencode/command/ai-deps.md` | 24 | Prose task description | `AiDepsTask` dataclass |
| 24 | `.opencode/command/learn.md` | 42 | Prose process | `LearnDirectives` dataclass |
| 25 | `.opencode/command/spellcheck.md` | 5 | Prose | `SpellcheckDirectives` dataclass |
| 26 | `.opencode/command/issues.md` | 23 | Prose + gh command | `IssuesDirectives` dataclass |
| 27 | `.opencode/command/changelog.md` | 46 | Prose + rules | `ChangelogDirectives` dataclass |
| 28 | `.opencode/command/rmslop.md` | 15 | Prose rules | `RmslopDirectives` dataclass |
| 29 | `.opencode/command/translate.md` | 14 | Prose | `TranslateDirectives` dataclass |

### Tier 5 — Agent Definitions

| # | File | Lines | Current Style | Pythonization Target |
|---|------|-------|---------------|---------------------|
| 30 | `.opencode/agent/duplicate-pr.md` | — | Prose | `DuplicatePrConfig` dataclass |
| 31 | `.opencode/agent/triage.md` | — | Prose | `TriageConfig` dataclass |

### Tier 6 — Root Governance

| # | File | Lines | Current Style | Pythonization Target |
|---|------|-------|---------------|---------------------|
| 32 | `AGENTS.md` | 200+ | Prose + some code | `AgentGovernance` dataclass (convert remaining prose) |
| 33 | `GEMINI.md` | 61 | Prose project overview | `ProjectOverview` dataclass |
| 34 | `CONTRIBUTING.md` | 100+ | Prose contribution guide | `ContributingDirectives` dataclass |

### Tier 7 — Documentation (reference, lower priority)

| # | File | Lines | Current Style | Pythonization Target |
|---|------|-------|---------------|---------------------|
| 35 | `docs/ADID_Framework_15_4.md` (was 15.3) | 800+ | Prose + Python kernel | Reference `_prompts` conversion done, superseded by `opencode_prompts_kernel.py` |
| 36 | `docs/architecture.md` | 200+ | ASCII diagrams + prose | Architecture dataclasses |
| 37 | `docs/gated-workflow.md` | 31 | Prose | `GatedWorkflow` dataclass |
| 38 | `docs/external-file-locations.md` | — | Prose list | `ExternalPaths` dataclass |
| 39 | `docs/fossil-search-research.md` | — | Research prose | `FossilResearch` dataclass |
| 40 | `docs/bun-gemini-research.md` | — | Research prose | `BunGeminiResearch` dataclass |
| 41 | `DOCINDEX.md` | 61 | Table | Doc index as dataclass |
| 42 | `index.md` | 81 | Table | Repo map as dataclass |

---

## Architecture: How Prompts Actually Flow

### Current Prompt Loading Pipeline

```
┌─ Agent Prompt files ─────────────────────┐
│ packages/opencode/src/agent/prompt/*.txt  │  ──import→ agent.ts → Agent.Info.prompt
│   coder.txt, orchestrator.txt, ...        │           (raw text import)
└──────────────────────────────────────────┘
                                                     ┌─ system.ts ─────┐
┌─ Model Prompt files ────────────────────┐            │ PROMPT_REGISTRY │
│ packages/opencode/src/session/prompt/*.txt │  ──import──→ resolves by model  │
│   default.txt, anthropic.txt, gemini.txt │            │ uses frontmatter │
│   + reasoning.txt, plan.txt              │            └─────────────────┘
└──────────────────────────────────────────┘
                                                     ┌─ instruction.ts ─┐
┌─ Rules ──────────────────────────────────┐           │ Reads all *.mdc  │
│ .opencode/rules/*.mdc                    │  ──fs────→│ *.md from dir    │
│   adid-framework-and-adm.mdc, ...        │           │ Parses YAML fm   │
└──────────────────────────────────────────┘           └─────────────────┘
                                                     ┌─ skill/index.ts ─┐
┌─ Skills ────────────────────────────────┐            │ Scans for        │
│ .opencode/skills/*/SKILL.md             │  ──fs────→│ SKILL.md files   │
│   adm-exe/SKILL.md, cmd-runner/SKILL.md │           │ Parses YAML fm   │
└──────────────────────────────────────────┘           └─────────────────┘
                                                     ┌─ instruction.ts ─┐
┌─ Instructions ───────────────────────────┐           │ Finds AGENTS.md  │
│ AGENTS.md, CLAUDE.md, CONTEXT.md         │  ──fs────→│ up the directory │
│ config.instructions (URLs/files)         │           │ tree             │
└──────────────────────────────────────────┘           └─────────────────┘

Final assembly (prompt.ts:1342):
  system = [...rules, ...env, ...(skills ?? []), ...instructions]
```

### Key Fact: ALL prompts are loaded as raw strings

The TypeScript code treats everything as text — whether prose or Python code doesn't matter:
- `import PROMPT_CODER from "./prompt/coder.txt"` → raw string  
- `fs.readFileString(filepath)` → raw string
- The strings are concatenated into the system prompt array

**The Python code in prompt files is executed mentally by the AI**, not by TypeScript.
This means we can freely replace prose with Python dataclasses — the loader doesn't care.

## Architecture: `opencode_prompts_kernel.py`

New file at repo root containing ALL Pythonized prompt data. This is the canonical source.
After creating it, each prompt file becomes a thin wrapper that references the kernel.

```python
# opencode_prompts_kernel.py
# Python-native prompt definitions for the opencode project.
# All agent prompts, rules, skills, commands expressed as typed Python data.
# 
# How it works: the TypeScript prompt loader loads this file as raw text
# and injects it into the system prompt. The AI reads these Python data
# structures and "executes" them mentally — same pattern as _prompts/reasoning_kernel.py.

from dataclasses import dataclass, field
from typing import Optional, Any
from enum import Enum
import json
```

### Module Structure

```python
# === I. AGENT PROMPT DIRECTIVES ===
@dataclass class CoderDirectives: ...
@dataclass class ExploreDirectives: ...
@dataclass class OrchestratorConfig: ...
@dataclass class GeneralDirectives: ...
@dataclass class ResearcherDirectives: ...
@dataclass class MediaDirectives: ...
@dataclass class CompactionRules: ...
@dataclass class TitleDirectives: ...
@dataclass class SummaryDirectives: ...

# === II. RULES ===
ADID_FRAMEWORK_RULES: dict[str, str] = { ... }
CODING_AGENT_DIRECTIVES: dict[str, Any] = { ... }

# === III. SKILL DEFINITIONS ===
@dataclass class AdmExeSkill: ...
@dataclass class CmdRunnerDirectives: ...
@dataclass class RagSkillDirectives: ...
@dataclass class PatchToolDirectives: ...
# ... etc

# === IV. COMMAND DEFINITIONS ===
@dataclass class CommitConfig: ...
@dataclass class LearnConfig: ...
@dataclass class ChangelogConfig: ...
# ... etc

# === V. GOVERNANCE ===
GOVERNANCE_RULES: dict[str, str] = { ... }

# === VI. MODEL BASE PROMPTS ===
@dataclass class DefaultPromptDirectives: ...
@dataclass class AnthropicPromptDirectives: ...
@dataclass class GeminiPromptDirectives: ...
# ... etc
```

### Key Architecture Rules

1. **`opencode_prompts_kernel.py` is the canonical source** — all prompt data defined once
2. **Prompt files become thin wrappers** — they import/reference the kernel  
3. **TypeScript loading code stays unchanged** — it still reads raw strings
4. **Python code is for the AI to read** — same pattern as `_prompts/reasoning_kernel.py`

---

## Conversion Pattern

Each prose prompt follows this pattern:

**Before** (prose):
```
## Role: Coder

Implement code changes using the full tool suite.

Strengths:
- Targeted code edits via the edit tool
- Creating new files when needed via write
- ...

Guidelines:
- Read the current file state before modifying
- Follow existing code conventions
- ...
```

**After** (Pythonic):
```python
from dataclasses import dataclass, field

@dataclass
class CoderDirectives:
    """Role: Coder — implementation agent directives."""
    role_name: str = "Coder"
    description: str = "Implement code changes using the full tool suite."
    
    strengths: list[str] = field(default_factory=lambda: [
        "Targeted code edits via edit tool (prefer over write for existing)",
        "Creating new files via write",
        "Running build, test, lint, typecheck via bash",
        "Codebase exploration via grep, glob, read, list",
        "Multi-file changes via multiedit",
        "Applying patches via apply_patch",
    ])
    
    guidelines: list[str] = field(default_factory=lambda: [
        "Read current file state before modifying — no assumptions",
        "Follow existing code conventions and patterns",
        "Use the smallest coherent change set possible",
        "Run typecheck/lint after changes to verify correctness",
        "Prefer editing existing files over creating new ones",
        "Never commit changes unless user explicitly asks",
        "Verify with tests where available",
    ])
    
    sub_agent_constraint: str = (
        "Do NOT launch task agents (explore, general, coder, "
        "researcher, media, or any other agent)"
    )
    
    tone_style: str = "Be concise, direct, to the point. GitHub-flavored markdown. No emojis unless asked."
```

---

## Execution Order

### Phase 1 — Foundation: Create `opencode_prompts_kernel.py`
1. Define all enums, dataclasses, and data structures
2. Include all prompt directives, rules, skills, commands

### Phase 2 — Convert Agent Prompts (Tier 1)
1. `orchestrator.txt` → `OrchestratorConfig` + `WorkflowStep` + `InstructionFormat`
2. `coder.txt` → `CoderDirectives`
3. `explore.txt` → `ExploreDirectives`
4. `general.txt` → `GeneralDirectives`
5. `researcher.txt` → `ResearcherDirectives`
6. `media.txt` → `MediaDirectives` + `MediaContract`
7. `compaction.txt` → `CompactionRules`
8. `title.txt` → `TitleDirectives` + `TitleExamples`
9. `summary.txt` → `SummaryDirectives`

### Phase 3 — Convert Rules (Tier 2)
1. `adid-framework-and-adm.mdc` → Python dicts + dataclasses
2. `adid-rag.mdc` → `RagDirectives`
3. `semantic-coding-agent-drop-in.mdc` → `CodingAgentDirectives`
4. Sync receiver copies (`.cursor/rules/`, `.codex/rules/`)

### Phase 4 — Convert Skills (Tier 3)
1. `adm-exe/SKILL.md` → `AdmExeSkill` with command registry
2. `cmd-runner/SKILL.md` → `CmdRunnerDirectives`
3. `rag/SKILL.md` → `RagSkillDirectives`
4. `patch-tool/SKILL.md` → `PatchToolDirectives`
5. `agent-assets/SKILL.md` → `AgentAssetsDirectives`
6. `adm-mcp-service/SKILL.md` → `AdmMcpDirectives`
7. `apply-patch-edits/SKILL.md` → `ApplyPatchDirectives`
8. `delphi_builder/SKILL.md` → `DelphiBuilderDirectives`
9. `dunit/SKILL.md` → `DUnitDirectives`
10. Sync receiver copies (`.cursor/skills/`, `.codex/skills/`)

### Phase 5 — Convert Commands (Tier 4)
1. `commit.md` → `CommitConfig`
2. `learn.md` → `LearnConfig`
3. `changelog.md` → `ChangelogConfig`
4. `issues.md` → `IssuesConfig`
5. `translate.md` → `TranslateConfig`
6. `rmslop.md` → `RmslopConfig`
7. `ai-deps.md` → `AiDepsConfig`
8. `spellcheck.md` → `SpellcheckConfig`

### Phase 6 — Convert Governance (Tier 6)
1. `AGENTS.md` remaining prose → `AgentGovernance` dataclass
2. `GEMINI.md` → `ProjectOverview`
3. `CONTRIBUTING.md` → `ContributingDirectives`

### Phase 7 — Convert Tools (already TypeScript — keep as-is)
- `.opencode/tool/github-pr-search.ts` — Already TypeScript code
- `.opencode/tool/github-triage.ts` — Already TypeScript code
- These are already code, not prompts — mark as exempt

### Phase 8 — Documentation (Tier 7, lower priority)
1. `docs/gated-workflow.md` → `GatedWorkflow` dataclass
2. `docs/external-file-locations.md` → `ExternalPaths` dataclass
3. `DOCINDEX.md` → `DocIndex` dataclass
4. `index.md` → `RepoMap` dataclass

---

## Key Design Decisions

1. **Single kernel file**: All prompt data lives in `opencode_prompts_kernel.py` at repo root.
   - Mirror pattern from `_prompts/reasoning_kernel.py`
   - Makes imports simple: `from opencode_prompts_kernel import CoderDirectives`
   
2. **Prompt files stay as `.txt`/`.mdc`/`.md` but reference the kernel**:
   - The `opencode_prompts_kernel.py` is the source of truth
   - Prompt files become thin wrappers: "See kernel for CoderDirectives"
   - OR: prompt files embed the Python directly (like `_prompts/reasoning.txt`)

3. **Receiver syncing**: After modifying canonical files in `artefacts/`, run:
   - `python scripts/build_artefacts.py`
   - `python scripts/sync_agent_assets.py --targets all`

4. **No tool code changes**: TypeScript tool files (`.opencode/tool/*.ts`) are already code — exempt.

5. **Glossary files are exempt**: 17 translation glossaries — pure localization data.

---

## Summary Stats

| Tier | Category | Files | Objects Created | Status |
|------|----------|-------|-----------------|--------|
| 1 | Agent Prompts (`.txt`) | 9 | 9 dataclasses | ✅ Done |
| 2 | Rules (`.mdc`) | 3 | 2 dicts + 1 dataclass | ✅ Done |
| 3 | Skills (SKILL.md) | 9 | 9 dataclasses | ✅ Done |
| 4 | Commands (`.md`) | 8 | 8 dataclasses | ✅ Done |
| 5 | Agent defs (`.md`) | 2 | 2 dataclasses | ✅ Done |
| 6 | Governance (`.md`) | 3 | 1 dict + Python header | ✅ Done |
| — | **Total** | **34** | **15 dataclasses + 31 dict entries** | **✅ Phases 1-7** |

### Notable

- New file: `opencode_prompts_kernel.py` — 15 dataclasses, 31 config dict entries, all with type hints
- All agent prompts now reference the kernel instead of containing prose
- `reasoning.txt` synced from `_prompts` (Pythonized version)
- Rules synced to `.codex/rules/` and `.cursor/rules/`
- Phase 8 (remaining docs) deferred — these are reference/developer docs, not agent prompts
