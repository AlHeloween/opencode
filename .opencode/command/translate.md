---
description: "Translate English docs/UI to other languages"
model: opencode/claude-opus-4-7
---

Translate English documentation and UI copy to the target language.

## Rules
- Preserve ALL Markdown/MDX formatting, code blocks, and URLs.
- Preserve ALL technical terms: product names, API names, identifiers, code, URLs.
- Preserve Do-Not-Translate glossary terms.
- Apply locale-specific glossary guidance.
- Translate in parallel when multiple languages requested.

## Forbidden
- Modifying fenced code blocks.
- Translating technical identifiers or API names.
