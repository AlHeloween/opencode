# Application Workflow Diagram

## Provider Request Output Cap Flow

1. `packages/opencode/src/provider/transform.ts` / `maxOutputTokens`
   - Input: provider model limits and optional explicit output override.
   - Output: output token cap for provider request generation.
   - Logic: explicit override wins; normal native output limits are preserved; pathological `output >= context` metadata is capped to the smaller of native output, default output max, and a context reserve.

2. `packages/opencode/src/session/llm.ts` / request parameter assembly
   - Input: model, prompt messages, provider options, and session context.
   - Output: AI SDK stream/generation parameters.
   - Logic: pass the capped `maxOutputTokens` value to the provider request so input plus output cap does not start from an impossible full-context output claim.

3. `packages/opencode/test/session/llm.test.ts` / qwen-like request capture
   - Input: `alibaba/qwen-plus` fixture with in-memory `output == context` override.
   - Output: captured local mock-server request body.
   - Logic: verify the outgoing OpenAI-compatible `max_tokens` body field is capped below context.

Coverage estimate vs actual codebase: 9%.

## Session Prompt To Processor Flow

1. `packages/opencode/src/session/overflow.ts` / `usable`
   - Input: config and provider model limits.
   - Output: actual-usage threshold derived from explicit input limit or context minus reserved buffer.
   - Logic: treat `maxOutputTokens` as generation cap only; do not subtract output limit from usage capacity.

2. `packages/opencode/src/session/prompt.ts` / `SessionPrompt.loop`
   - Input: user/session/model/agent state.
   - Output: assistant message or loop break.
   - Logic: build system prompt and model messages, call `SessionProcessor.process`, handle `"stop"` and `"compact"`, and leave cache metrics passive.

3. `packages/opencode/src/session/processor.ts` / `SessionProcessor.process`
   - Input: `LLM.StreamInput`.
   - Output: `"compact" | "stop" | "continue"`.
   - Logic: stream provider events, update message parts, mark interruptions as aborted, run cleanup, return typed outcome.

4. `packages/opencode/src/session/processor.ts` / `cacheRatio`
   - Input: token usage with input/cache read/cache write counts.
   - Output: passive cache-read ratio.
   - Logic: compute cache-read share for diagnostics without changing processor control flow.

5. `packages/opencode/src/session/session.ts` / `Session.updateMessage`
   - Input: message info.
   - Output: updated message info.
   - Logic: run `MessageV2.Event.Updated`, whose projector persists the message row.

6. `packages/opencode/src/session/compaction.ts` / `select`
   - Input: ordered messages, config, model.
   - Output: `{ head, tail }` where `head` is summarized and `tail` is preserved.
   - Logic: keep only the newest real turn in `tail` for regular compaction; keep no extra tail for overflow replay because the replayed user request is inserted after the summary.

7. `packages/opencode/src/session/compaction.ts` / compaction continuation
   - Input: normal system prompt, compaction skill payload, dynamic compaction instruction, and processor result.
   - Output: compacted session continuation or stop.
   - Logic: summarize the ordered active history before the latest turn, pass the normal system prompt through unchanged, inject the static compaction template as `<skill_content name="compaction">`, store `tail_count`, and preserve database order as compaction summary followed by the latest turn.

Coverage estimate vs actual codebase: 8%.

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

## Read Tool Document Conversion Flow

1. `packages/opencode/src/tool/read.ts` / `isBinaryFile`
   - Input: requested file path and sample bytes.
   - Output: binary/text classification.
   - Logic: known binary/document extensions, including `.pdf`, enter the binary branch before byte heuristics.

2. `packages/opencode/src/tool/read.ts` / Windows path normalization
   - Input: requested file path and active instance directory.
   - Output: normalized absolute path for permission and stat checks.
   - Logic: drive-less absolute paths such as `/Users/...` are resolved on the active project drive instead of the process cwd drive.

3. `packages/opencode/src/tool/read.ts` / document conversion branch
   - Input: binary file bytes and file extension.
   - Output: `<content>` block containing converted markdown.
   - Logic: supported non-text document formats call `convertDocument`; binary bytes in text-like extensions remain rejected as binary.

4. `packages/opencode/src/util/markdownify.ts` / `resolveBinPath`
   - Input: runtime paths and platform executable suffix.
   - Output: resolved `opencode-markdownify` path.
   - Logic: check packaged cache/bin, executable-adjacent config/bin, actual executable directory, portable project `bin`, cwd `bin`, source-checkout `bin`, then development dist locations.

Coverage estimate vs actual codebase: 9%.
