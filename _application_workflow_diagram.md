# Application Workflow Diagram

## Session Prompt To Processor Flow

1. `packages/opencode/src/session/prompt.ts` / `SessionPrompt.loop`
   - Input: user/session/model/agent state.
   - Output: assistant message or loop break.
   - Logic: build system prompt and model messages, call `SessionProcessor.process`, handle `"stop"` and `"compact"`, and leave cache metrics passive.

2. `packages/opencode/src/session/processor.ts` / `SessionProcessor.process`
   - Input: `LLM.StreamInput`.
   - Output: `"compact" | "stop" | "continue"`.
   - Logic: stream provider events, update message parts, mark interruptions as aborted, run cleanup, return typed outcome.

3. `packages/opencode/src/session/processor.ts` / `cacheRatio`
   - Input: token usage with input/cache read/cache write counts.
   - Output: passive cache-read ratio.
   - Logic: compute cache-read share for diagnostics without changing processor control flow.

4. `packages/opencode/src/session/session.ts` / `Session.updateMessage`
   - Input: message info.
   - Output: updated message info.
   - Logic: run `MessageV2.Event.Updated`, whose projector persists the message row.

5. `packages/opencode/src/session/compaction.ts` / compaction continuation
   - Input: compaction prompt state and processor result.
   - Output: compacted session continuation or stop.
   - Logic: retry context-overflow handling and user-driven compaction without stream-stall fallback.

Coverage estimate vs actual codebase: 6%.

This diagram covers the modified session-processing and compaction path only, not the full opencode runtime.

## Project Runtime Path Flow

1. `packages/core/src/global.ts` / module initialization
   - Input: process launch working directory and executable path.
   - Output: initial `Global.Path.*` values.
   - Logic: data/cache/state/log/bin start under the launch working directory; config remains executable-adjacent.

2. `packages/opencode/src/project/instance.ts` / `Instance.provide`
   - Input: requested project directory.
   - Output: instance context with project ID and worktree.
   - Logic: resolve project metadata, call `Global.initFromWorktree`, then run project-scoped initialization in `Database.withProject`.

3. `packages/opencode/src/project/project.ts` / `Project.fromDirectory`
   - Input: requested directory.
   - Output: `{ project, sandbox }` discovery result.
   - Logic: import local project DB if present, otherwise honor local opencode config files or child `bin` config files as a boundary, otherwise discover parent git worktree.

4. `packages/opencode/src/storage/db.ts` / `Database.getProjectDb`
   - Input: project ID and resolved worktree.
   - Output: SQLite client for `{worktree}/.opencode/data/opencode.db`.
   - Logic: one cached DB connection per project DB path.

5. `packages/opencode/src/account/repo.ts` / `AccountRepo.layer`
   - Input: experimental console account operations in the current process.
   - Output: active account/org state for that process only.
   - Logic: store account rows in memory; no config-level SQLite database or `account.db` file is created.

Coverage estimate vs actual codebase: 7%.

## TUI Session Exit Banner Flow

1. `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` / `currentExecutableCommand`
   - Input: process executable path, original argv0, and current working directory.
   - Output: shell-copyable executable command path.
   - Logic: use the launched runtime name for development runtimes, otherwise resolve the packaged executable and prefer a relative path when it is inside the current directory.

2. `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` / session exit message effect
   - Input: active session title and session ID.
   - Output: terminal exit banner with a portable continue command.
   - Logic: render `Continue <executable> -s <session>` so copied bundles point at `bin\\opencode.exe` instead of a possibly unrelated `opencode` on `PATH`.

Coverage estimate vs actual codebase: 8%.
