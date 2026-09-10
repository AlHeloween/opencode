# Permissions dialog scroll fix (2026-09-08)

## Problem (user, verbatim)
«когда вызывается permissions список не скроллируется правильно» / «В смысле в tui /permissions»

## Root cause (code-grounded)
`DialogPermissions` (packages/opencode/src/cli/cmd/tui/component/dialog-navigation.tsx)
renders the navigable list in a plain `<box gap={0}>` — no `<scrollbox>`.
The dialog shell (`ui/dialog.tsx`) sizes to content and does not clip/scroll, so
when TOOL_POLICIES + agent-permission rows + directory rows exceed terminal
height, rows spill past the dialog border and cannot be scrolled (keys move the
cursor off-screen).

Additionally the keyboard cursor indexes into `allRows()` (= POLICY_ROWS +
agentPermRows + dirRows + FOOTER_ROWS), but the rendered Directories section
(lines ~1067–1145) duplicates dir rows already rendered inside the main `<For>`,
and the footer index math `POLICY_ROWS.length + rules().length + i()` ignores
agent-permission rows → cursor can highlight the wrong/absent row.

## Fix (canonical pattern from dialog-routing.tsx lines 312–339 + 437–497)
1. Wrap the navigable rows block (`<For each={allRows()}>` … hint text) in a
   native `<scrollbox>` with:
   - `maxHeight = min(estimatedLines, floor(termHeight/2) - 6)` (view-port guard)
   - `scrollAcceleration={getScrollAcceleration()}`
   - stable `id={`r${i()}`}` per row (and section headers count as lines)
   - `ref` → `ScrollBoxRenderable`
2. Add `syncScroll()` (canonical moveTo pattern) and call it from `moveCursor`
   and after mouse/keyboard cursor changes; also after list mutation
   (addDirectory/removeDirectory/toggle reload) clamp cursor into range.
3. Remove the duplicated Directories section (dir rows are already in `allRows`
   and rendered in the main list). Keep the hint text under the list.
4. Fix footer index math: use `allRows().length - FOOTER_ROWS.length + i()`
   (agent rows are dynamic).
5. Clamp `cursor` when `allRows()` shrinks (createEffect) so Enter/Del never hit
   a stale index.

## Non-goals
- No changes to dialog shell sizing (xlarge etc.).
- No config/permission logic changes — rendering + navigation only.

## Smoke Tests
1. `bun typecheck` in packages/opencode — PASS required. ✅ [Exact] 2026-09-08, tsgo --noEmit exit 0 (cmd_runner session 20260908T011344Z_0a2430a7).
2. Existing TUI tests unaffected: `bun test packages/opencode/test/...` targeted
   dialog-navigation related tests if present (search first). ✅ none reference
   DialogPermissions/dialog-navigation (grep: dialog-tui-config.test.tsx no match).
3. Manual TUI check: ✅ [Exact] 2026-09-08, performed via cmd_runner live TUI
   (session 20260908T064658Z_c45667fe, rebuilt binary 10.0.943): opened
   /permissions via command palette (ESC → / → permissions → ENTER — palette
   ate bare text while startup dialog was open); DOWN/j navigation scrolled
   the row list (Bash/PowerShell/Cmd/Run/Tools/Edit/Doom loop/Web fetch became
   visible after being clipped pre-fix); cursor kept in view (█ marker on Run
   row); footer Save/Reload/Close remained docked. User visually confirmed the
   dialog render in the terminal. Task fully closed; residual none.
