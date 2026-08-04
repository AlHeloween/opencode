# First-class Git no-index tree diff

## Intent

Give the coding agent a text-native, repository-independent comparison tool for
two arbitrary directory trees. It must expose Git's `diff --no-index` as a
structured capability, rather than relying on a generic shell command or the
existing size/timestamp-only `compare` inventory.

## Contract

- Canonical tool name: `treediff`.
- Inputs are two directory trees plus a selectable output mode: `names`,
  `numstat`, or `patch`.
- Execute `git diff --no-index --no-ext-diff --no-textconv`; exit code `1` means differences,
  not tool failure.
- Never require either input directory to be a Git repository.
- Read-only permission only. Do not invoke external diff tools or a GUI.
- Return text that a model can consume directly; include a stable title and
  metadata showing whether differences were found.

## Smoke Tests

### Baseline — 2026-07-27

From `packages/opencode`:

```powershell
bun test test/tool/registry.test.ts
bun typecheck
```

Actual [Exact]: `registry.test.ts` had 4 pass and 3 failures, each a 5-second
timeout in custom-tool loading cases (`.opencode/tool`, `.opencode/tools`, and
external dependencies). This plan does not use those paths. Typecheck output
was not available because the parallel baseline command exited with the test
failure; rerun it independently before completion.

### Post-implementation

From `packages/opencode`:

```powershell
bun test test/tool/treediff.test.ts test/tool/registry.test.ts
bun typecheck
```

Pass criteria:

1. Two temporary non-repository directories produce `name-status`, `numstat`,
   and unified patch output.
2. A difference exit code is represented as a successful tool result.
3. Git/process failures remain visible errors.
4. The tool is present in the registry under the canonical name `treediff`.

Actual [Exact] — 2026-07-27:

- `bun test test/tool/treediff.test.ts` — 3 pass, 0 fail.
- `bun test test/tool/registry.test.ts --test-name-pattern "unique platform"` —
  1 pass, 0 fail; asserts `treediff` is registered.
- `bun typecheck` — pass.

## Implementation steps

- [x] Add `treediff.ts` plus model-facing `treediff`/`ai-call` descriptions
  that teach whole-tree Git comparison before a bounded one-pass LLM call.
- [x] Register the tool without changing the existing `compare` inventory.
- [x] Add real temporary-directory regression coverage for all output modes and
  normal difference exit handling.
- [x] Run smoke tests; reconcile this plan with code and move it only when all
  steps are verified.
