---
description: "Create UPCOMING_CHANGELOG.md from structured changelog input"
model: opencode/gpt-5.4
---

Create or update UPCOMING_CHANGELOG.md from the provided changelog data.

## Rules
- Inspect real diff with `git show --stat` — do not trust summary alone.
- User-facing changes ONLY. Drop internal/CI/test/refactor commits.
- One bullet per commit, capitalized. No prefixes or PR numbers.
- Sections: ## Core, ## TUI, ## Desktop, ## SDK, ## Extensions.
- Ignore existing UPCOMING_CHANGELOG.md contents entirely — rebuild from git.
- Use `git show`, not `git log` or author metadata for attribution.
- No "No notable changes." if there IS a contributor block.

## Forbidden
- Keeping internal/CI/test/refactor commits.
- Adding attribution from git metadata.
