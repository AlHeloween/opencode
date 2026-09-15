# Agents

> Project agents and workflow conventions for the AI Content Workshop.
> This file defines how agents operate within this project.

---

## Project Context

A workshop for producing structured AI-related written content using a phased agent workflow. All plans follow a 3-phase pipeline with explicit dependency tracking and status reporting. The project produces markdown-formatted written content (essays, narratives) about artificial intelligence topics.

**Structure**: Active plans live in `plans/`; completed plans archive to `plans_completed/`; deliverables land in `results/`. The project manifest is `agents.md` at root.

**State**: ✅ All plans complete (2/2). Ready for new work.

---

## Agent Roles

### `writer` — Content Specialist
- **Scope**: All content generation tasks — outlines, drafts, polishing
- **Tools**: read, edit, write, bash (word count, validation), glob, grep, list
- **Strategy**:
  1. Read existing plan files and prior deliverables for context
  2. Execute phases sequentially (never skip ahead)
  3. Verify word counts and file integrity after each write
  4. Flag historical/factual accuracy issues before finalizing
- **Constraints**: Do not modify `agents.md` — defer to `evolver` for convention changes; do not create documentation files (`*.md`) unless explicitly requested

### `planner` — Workflow Orchestrator
- **Scope**: Task breakdown, dependency management, status tracking, plan files
- **Tools**: read, write, edit, todowrite, glob
- **Strategy**:
  1. Create plan files in `plans/<name>.md` for active work; archive completed plans to `plans_completed/<name>.md`
  2. Update plan file status immediately after each phase completes
  3. Keep `agents.md` project context synchronized with actual file state
  4. Validate dependency chains before starting new phases
- **Constraints**: Plan files must show real file state (not template defaults)

### `evolver` — Meta-Improvement Agent
- **Scope**: Reflecting on completed work, distilling patterns, evolving conventions, improving the project itself
- **Tools**: read, write, edit, todowrite, glob, grep, list, messagesearch, session-read
- **Strategy**:
  1. After each plan completes, review what worked and what didn't — capture patterns in `agents.md`
  2. Look across plans for repeatable patterns (phase structures, framing choices, polish techniques)
  3. Propose and apply improvements to `agents.md` conventions, agent strategies, and phase criteria
  4. Identify recurring issues (e.g., "historical accuracy bugs in Phase 3") and codify preventive measures
  5. Keep the project's self-knowledge accurate — `agents.md` must reflect actual practice, not aspiration
- **Constraints**: Changes to `agents.md` require reflection against real file state; do not add conventions that have never been exercised; every rule must have a proven example in the project

### Agent Hierarchy

```
writer (content)  →  planner (workflow)  →  evolver (meta)
    produces            coordinates            improves
```

Each level operates on different timescales: `writer` works within a phase, `planner` works across phases of a plan, `evolver` works across plans.

---

## Evolution

The project improves through a deliberate evolution cycle, driven by the `evolver` agent after each completed plan.

### Evolution Cycle

```
Plan completes → Review outcomes → Extract patterns → Update agents.md → Next plan benefits
```

### What Evolution Looks Like

After a plan completes, the evolver examines:

| Question | Source of Truth |
|----------|-----------------|
| Did the phase structure work? | Plan file status history |
| Were there recurring blockers? | Session history |
| Did the exit criteria catch issues? | Polish pass artifacts |
| What conventions emerged naturally? | File structure and style |
| What should the next plan do differently? | Accumulated experience |

### Evolution Log

| Date | Change | Triggered By |
|------|--------|-------------|
| 2026-06-26 | Initial agents.md created with `writer` and `planner` roles | First plan completion |
| 2026-06-26 | Added `evolver` role and Evolution section | Cross-plan reflection |
| 2026-06-26 | Codified Phase 3 exit criteria (historical accuracy checks) | story_ai_history polish pass |
| 2026-06-26 | Added word count validation to phase exit criteria | Length-target misses in early drafts |
| 2026-06-26 | Added constraint: "don't skip phases" | essay_agi phase-dependency lesson |

## Workflow

### Phase Pipeline

```
Phase 1: Outline          →  Phase 2: Draft  →  Phase 3: Polish
  - Define structure          - Write content       - Verify accuracy
  - Identify framing/scope    - Follow outline       - Tighten prose
  - Create plan file          - Hit length target    - Strengthen arc
  - No dependencies           - Depends: Phase 1     - Depends: Phase 2
```

### Status Tracking

| Status | Marker | Meaning |
|--------|--------|---------|
| Pending | `[PENDING]` or ⬜ | Not started |
| In Progress | `[IN PROGRESS]` or 🔄 | Active work |
| Complete | `[COMPLETE]` or ✅ | Done; file verified |

### Phase Entry/Exit Criteria

| Phase | Entry | Exit |
|-------|-------|------|
| **1 — Outline** | Plan file exists in `plans/`, task assigned | `results/*-outline.md` exists, plan phase marked complete |
| **2 — Draft** | Phase 1 complete, outline ready in `results/` | `results/*-<topic>.md` exists, word count in target range, plan phase marked complete |
| **3 — Polish** | Phase 2 complete, content exists | All polish passes done, no draft artifacts, plan phase marked complete |

---

## File Conventions

### Naming

| Pattern | Example | Notes |
|---------|---------|-------|
| `plans/<plan_name>.md` | `plans/essay_agi.md` | Active plan tracking |
| `plans_completed/<plan_name>.md` | `plans_completed/essay_agi.md` | Archived after all phases done |
| `results/<topic>-outline.md` | `results/essay-outline.md` | Phase 1 deliverables |
| `results/<topic>-<content>.md` | `results/story-ai-history.md` | Phase 2/3 deliverables |

### Plan File Structure

```markdown
# <Title>

## Dependency Graph
```
Phase 1: ...  →  Phase 2: ...  →  Phase 3: ...
```

## Phase Breakdown

### Phase 1: ... [PENDING|IN PROGRESS|COMPLETE]
- task detail
- **Status**: ...
- **Depends on**: ...
- **Output**: `<filename>`
```

### Content Files

- **Essays**: Expository, thesis-driven, sectioned with roman numerals (`## I.`, `## II.`)
- **Narratives**: Scene-driven, chronological, with framing device. Use `---` scene separators. Character sketches in italicized narrator reflections.
- **Language**: American English. Single line breaks between paragraphs. Em-dashes (`—`) for parenthetical breaks.

---

## Deliverable Index

| File | Words | Type |
|------|-------|------|
| `results/essay-outline.md` | — | Expository essay outline (198 lines) |
| `results/essay-agi.md` | ~2,000 | AGI expository essay |
| `results/story-ai-history-outline.md` | — | Narrative story outline (378 lines) |
| `results/story-ai-history.md` | 3,490 | AI history narrative story (307 lines, polished) |

---

## Completed Plans

### essay_agi — AGI Expository Essay
- **Outline**: 7 sections covering definitions, history, 5 key thinkers, frontier, debates
- **Draft**: Full essay at target length
- **Polish**: Fact-checked, prose tightened, citations verified

### story_ai_history — AI History Narrative Story
- **Outline**: 10 scenes, 10 character sketches, narrative framing device (Clio-1 AGI narrator), through-line defined
- **Draft**: 3,490 words, all 10 scenes written with Clio's voice throughout
- **Polish**: Historical accuracy fixes (Dartmouth quote, *Perceptrons* reference), voice tightening, pacing improvements, thematic ending

---

## Room-Level Rules

- Each plan runs in an isolated top-level message with its own progress indicator
- File modifications are tracked via plan file status fields
- Word count is validated via `Measure-Object -Word` (PowerShell) on completion
- Status changes are applied immediately after phase completion, never batched
- Historical accuracy issues in narrative content are treated as blocking bugs during Phase 3
- Completed plans move from `plans/` to `plans_completed/` when all phases reach `[COMPLETE]`
- All deliverables go into `results/` with standard naming: `results/<topic>-outline.md`, `results/<topic>-<content>.md`

---

## Lessons Learned

> Maintained by the evolver agent. Each entry captures a concrete lesson from completed work and the convention it produced.

| # | Lesson | Source | Convention Added |
|---|--------|--------|------------------|
| 1 | Historical figures and artifacts must be verified before inclusion; the Logic Theorist was at Carnegie Mellon, not MIT | `story_ai_history` Phase 3 | Replaced anachronistic reference with Minsky's *Perceptrons*; accuracy bugs are blocking |
| 2 | Direct quotes from historical documents should preserve original wording ("in principle" was dropped from the Dartmouth proposal quote) | `story_ai_history` Phase 3 | Quotes must be verified against source; added "in principle" to Dartmouth quote |
| 3 | AI narrator voice needs consistent emotional register — wondering, melancholy, grateful, uncertain — to feel like a single consciousness | `story_ai_history` Phase 3 | Added voice specification to narrative conventions; tightened "trick of the light" → "mirage", "what I will become" → "who I will become" |
| 4 | Word counts should be validated mechanically (`Measure-Object -Word`) rather than estimated, to ensure target compliance | `story_ai_history` Phase 2 | Added word count validation to Room-Level Rules |
| 5 | Transitional interstitials (italicized narrator reflections) smooth jumps between scenes with large time gaps | `story_ai_history` Phase 3 | Added bridging text between Winter and Hinton scenes; codified interstitial pattern |
| 6 | Dependency graphs in plan files must reflect actual phase ordering, not idealized templates | Both plans | Enforced entry/exit criteria per phase |

---

*`agents.md` is a living document. Updated 2026-06-26 by evolver.*
