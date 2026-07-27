# Reasoning rich-text rendering

## Context / goal

Route reasoning text through the shared transcript rich-text pipeline so it keeps muted Markdown styling and renders Mermaid through the same PNG-to-Sixel/image path as user and assistant text.

## Prior art

reuse: local — `RichText` already provides Markdown segmentation and Mermaid image rendering for user and assistant transcript text.

## Implementation

- [x] Record focused Markdown and Mermaid-segmentation baselines.
- [x] Preserve the `Thinking` label while routing reasoning through `RichText` with muted syntax styling.
- [x] Validate the shared renderer and commit only the rich-text slice.

## Smoke Tests (required — PRE-FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/cli/tui/text-segments.test.ts` (`packages/opencode`) | pass | 3 pass, 0 fail (20260727T235009Z_ee7b9258) |
| 2 | `bun test src/renderables/__tests__/Markdown.test.ts --test-name-pattern "paragraph applies bold attributes to co-committed test text"` (`packages/opentui/packages/core`) | pass | 1 pass, 0 fail (20260727T235009Z_1f4fe744) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/cli/tui/text-segments.test.ts` (`packages/opencode`) | Markdown plus Mermaid segmentation passes |
| 2 | `bun test src/renderables/__tests__/Markdown.test.ts --test-name-pattern "paragraph applies bold attributes to co-committed test text"` (`packages/opentui/packages/core`) | terminal bold attribute passes |
| 3 | `bun typecheck` (`packages/opencode`) | no TypeScript diagnostics |
| 4 | `pwsh -File .\\_build.ps1 -SkipOpenTui` (repository root) | packaged binary version smoke passes |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation may begin after baseline.
- [x] Post-implementation smoke passed before completion: segmentation 4 pass, Markdown attribute 1 pass, typecheck 0 diagnostics, packaged smoke 10.0.645.
