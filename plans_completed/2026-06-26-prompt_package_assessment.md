# Prompt Package Assessment Plan

**Created:** 2026-06-26
**Status:** Active
**Goal:** Audit all 24 prompt files. Remove content redundant with or contradicting reasoning.txt. Eliminate ambiguity.

## Files to Assess

### Tier 1 — HIGH RISK (may duplicate/contradict gates)
| File | Lines | Risk |
|------|-------|------|
| `session/prompt/plan.txt` | ? | Plan mode — overlaps with Gate 4 |
| `session/prompt/plan-reminder-anthropic.txt` | ? | Plan mode — overlaps with Gate 4 |
| `session/prompt/build-switch.txt` | ? | Mode switch — overlaps with Gate 7 |
| `session/prompt/max-steps.txt` | ? | Step limit |
| `agent/prompt/coder.txt` | ? | Implementation rules — Gate 7 |
| `agent/prompt/general.txt` | ? | Planning — Gates 2-4 |
| `agent/prompt/orchestrator.txt` | 163 | Already enhanced, verify consistency |

### Tier 2 — MEDIUM RISK (specialized, may have minor overlap)
| File | Lines | Risk |
|------|-------|------|
| `agent/prompt/explore.txt` | ? | Explorer — Gate 6 details |
| `agent/prompt/researcher.txt` | ? | Research — Gate 6 details |
| `agent/prompt/compaction.txt` | ? | Summary — operational |
| `agent/prompt/media.txt` | ? | Media — no overlap |
| `agent/prompt/summary.txt` | ? | PR summary — no overlap |
| `agent/prompt/title.txt` | ? | Title gen — no overlap |

### Tier 3 — LOW RISK (provider-specific, YAML frontmatter only)
| File | Lines |
|------|-------|
| `session/prompt/anthropic.txt` | YAML |
| `session/prompt/beast.txt` | YAML |
| `session/prompt/codex.txt` | YAML |
| `session/prompt/copilot-gpt-5.txt` | YAML |
| `session/prompt/default.txt` | YAML |
| `session/prompt/gemini.txt` | YAML |
| `session/prompt/gpt.txt` | YAML |
| `session/prompt/kimi.txt` | YAML |
| `session/prompt/trinity.txt` | YAML |
| `session/prompt/reasoning.txt` | Already restructured |

## Assessment Criteria

For each file, check:
1. **Redundancy**: Does it repeat instructions already in reasoning.txt?
2. **Contradiction**: Does it conflict with any gate in reasoning.txt?
3. **Ambiguity**: Are instructions vague where reasoning.txt is specific?
4. **Scope**: Is content appropriate for this file's specific audience?

## Procedure

1. Read each Tier 1 file in full
2. Compare against reasoning.txt gates
3. Flag: redundant passages → remove, contradictory → fix, ambiguous → clarify
4. Read Tier 2 files, same process
5. Tier 3: verify YAML frontmatter only, no conflicting instructions
6. Update files, typecheck, commit
