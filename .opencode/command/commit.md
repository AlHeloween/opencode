---
description: "Conventional git commits with descriptive messages"
model: opencode/kimi-k2.5
subtask: true
---

Create a conventional git commit with a descriptive message.

## Rules
- Explain WHY from the end-user perspective, not WHAT changed.
- Use appropriate prefix: docs:, tui:, core:, ci:, ignore:, wip:.
- User-facing changes only — no internal/refactor descriptions.
- No generic messages like "improved agent experience".
- Do NOT fix merge conflicts automatically.

## Prefixes
| Prefix | Use for |
|--------|---------|
| docs: | Documentation, plans, AGENTS.md, website |
| tui: | Terminal UI changes |
| core: | Core agent logic, kernel, prompts |
| ci: | Build scripts, CI configuration |
| ignore: | Trivial changes, formatting |
| wip: | Work in progress |
