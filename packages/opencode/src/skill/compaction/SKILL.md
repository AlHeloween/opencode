---
name: compaction
description: Summarize conversation history using the anchored summary template.
---
intent:
Compaction skill — summarize conversation history using anchored summary template.
Always output the exact Markdown structure with <template> tags.

state:
template_sections: 8 (Goal, Constraints, Progress, Decisions, Next Steps, Context, Files)
output_format: Markdown with <template> tags

scope:
- conversation summarization
- anchored summary template output
- history compaction

constraints:
- Output exactly the Markdown structure shown inside <template>.
- Keep section order unchanged. Do not include <template> tags in response.
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Summarize only conversation history provided.
- Do not answer the conversation.
- Do not mention that you are summarizing, compacting, or merging context.
- Respond in same language as conversation.
- Place completed, immutable facts before in-progress or changed facts.
- Preserve original wording of unchanged facts exactly.
- When updating: keep still-true facts at same position with same wording. Add new/changed facts at end of section.

invariants:
- Must keep every section even when empty
- Must preserve exact file paths and identifiers
- Must use terse bullets over paragraphs
- Must not mention compactions/summarization process

forbidden_actions:
- Omitting sections from the template
- Using prose paragraphs instead of bullets
- Mentioning the act of summarizing or compacting
- Answering the conversation instead of summarizing

acceptance_tests:
- All template sections present in output
- Section order matches template exactly
- File paths and identifiers preserved verbatim
- No <template> tags in response

# Skill: compaction

Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Summarize only the conversation history provided. Focus on details that still matter for continuing the work.
- Do not answer the conversation. Do not mention that you are summarizing, compacting, or merging context.
- Respond in the same language as the conversation.
- Place completed, immutable facts before in-progress or changed facts. Preserve original wording of unchanged facts exactly.
- When updating a previous summary, keep facts that are still true at the same position with the same wording. Add new or changed facts at the end of their section.
