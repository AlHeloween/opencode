# Unified rich-text rendering for transcript messages

## Context / goal

Render CommonMark and fenced-code syntax consistently for user and assistant transcript messages while preserving Mermaid's PNG-to-Sixel/image-plane path.

## Prior art

reuse: local — `TextPart` already splits Mermaid fences before selecting a Markdown renderer; `UserMessage` currently bypasses that pipeline and writes plain text.

## Implementation

- [x] Record the existing focused renderer baselines.
- [x] Extract the agent text/Mermaid segment flow into a reusable transcript renderer.
- [x] Route user messages through the reusable renderer with `streaming={false}`.
- [x] Route agent Markdown segments through the dedicated Markdown renderer, retaining Mermaid image rendering.
- [x] Add regression coverage for Markdown preservation and terminal bold attributes.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/cli/tui/text-segments.test.ts` (`packages/opencode`) | pass | 2 pass, 0 fail (20260727T204239Z_38aca19c) |
| 2 | `bun test src/lib/tree-sitter-styled-text.test.ts --test-name-pattern "bold text should work in all contexts"` (`packages/opentui/packages/core`) | pass | 1 pass, 0 fail (20260727T204239Z_0621158d) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/cli/tui/text-segments.test.ts` | segmentation tests pass |
| 2 | `bun test src/renderables/__tests__/Markdown.test.ts --test-name-pattern "paragraph applies bold attributes to co-committed test text"` (`packages/opentui/packages/core`) | terminal bold attribute passes |
| 3 | `bun typecheck` (`packages/opencode`) | no TypeScript diagnostics |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation may begin after baseline.
- [x] Post-impl smoke passed before completion: segmentation 3 pass, Markdown attribute 1 pass, typecheck 0 diagnostics.
