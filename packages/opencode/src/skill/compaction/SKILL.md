---
name: compaction
description: Summarize conversation history using the anchored summary template.
---

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
