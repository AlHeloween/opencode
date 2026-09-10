---
title: Application Workflow Diagram
owner: Local_Development
status: production
last_verified: 2026-09-06
reproduce:
  files:
    - packages/opencode/src/provider/transform.ts
    - packages/opencode/src/session/llm.ts
    - packages/opencode/test/session/llm.test.ts
  commands:
    - cd packages/opencode && bun test test/session/llm.test.ts
    - cd packages/opencode && bun typecheck
  inputs: Provider request assembly for an OpenRouter parent or child task session.
  expected_outputs: Mutable banner, body session_id, header x-session-id, and prompt_cache_key share one provider cache namespace.
---

# Application Workflow Diagram

## Tools Wire Era-Freeze Flow (2026-08-16)

1. `packages/opencode/src/session/tools.ts` / `SessionTools.resolve`
   - Input: agent/providerAgent/model/session/processor/messages/promptOps/userDisabled.
   - Output: `Record<string, AITool>` — полный каталог на проводе (registry + MCP + aliases).
   - Logic: registry-тулы (execute с ACL `denied()`: mode + userDisabled + summary-mode guard), MCP-тулы из эра-снапшота `mcpEraStore` (wire заморожен per session+model; `mcpLiveSig` детектит изменения → defer-лог; execute из живого клиента, при дисконнекте — deny-стаб), alias-регистрация. Wire никогда не режется.

2. `packages/opencode/src/tool/registry.ts` / `ToolRegistry.tools` + `createEraMemo`
   - Input: providerID/modelID/agent/sessionID.
   - Output: `Tool.Def[]` с описаниями task/skill.
   - Logic: описания task/skill вычисляются один раз на эру (per-session memo), замораживаются до `invalidateToolDescriptions(sessionID)` (compact / identity mismatch).

3. `packages/opencode/src/mcp/index.ts` / `MCP.tools`
   - Input: connected MCP-клиенты + defs-кэш.
   - Output: `Record<string, Tool>` в детерминированном порядке (sorted clients, server-listed tools).
   - Logic: при отсутствии defs — re-fetch (без silent-drop); провал re-fetch → warn «bug:» и пропуск.

4. `packages/opencode/src/session/prompt.ts` / summary turn + captureSummary
   - Input: runLoop state / emergency route input.
   - Output: llm.stream с полным каталогом.
   - Logic: `summaryAttempt` больше не шлёт `tools: {}`; ин-луп саммари-тур обёрнут в `Constitution.setSummaryMode` (исполнение заблокировано, схемы на проводе); `captureSummary` резолвит тот же каталог (стаб-processor); compact/identity-mismatch → инвалидация обеих эр (registry + MCP).

5. `packages/opencode/src/session/llm.ts` / request shape + stability checks
   - Input: tools/system/messages/options.
   - Output: audit-хэши + warn при дрейфе.
   - Logic: `hashInfo(Object.keys(tools))` в insertion order; `checkToolStability` (порядок+описания+схемы, включая `_noop`) → «bug: tool catalog changed mid-session»; `resolveTools` = identity (user.tools=false — runtime-deny в SessionTools).

Coverage estimate vs actual codebase: 9%.

## Provider Request Output Cap Flow

1. `packages/opencode/src/provider/transform.ts` / `maxOutputTokens`
   - Input: provider model limits and optional explicit output override.
   - Output: output token cap for provider request generation.
   - Logic: explicit override wins; normal native output limits are preserved; pathological `output >= context` metadata is capped to the smaller of native output, default output max, and a context reserve.

2. `packages/opencode/src/session/llm.ts` / request parameter assembly
   - Input: model, prompt messages, provider options, and session context.
   - Output: AI SDK stream/generation parameters.
   - Logic: pass the capped `maxOutputTokens` value to the provider request so input plus output cap does not start from an impossible full-context output claim; derive the final provider cache namespace before system assembly and use it in OpenRouter's `x-session-id` header.

3. `packages/opencode/src/provider/transform.ts` / OpenRouter request identity
   - Input: final provider cache namespace (a model-scoped parent key or a reusable child-task lease).
   - Output: OpenRouter provider options containing body `session_id` and `prompt_cache_key` equal to that namespace.
   - Logic: the OpenRouter SDK spreads these options into the HTTP body. The mutable `[session: …]` banner and `x-session-id` header use the same value, so a physical child-session ID never splits the affinity/cache sequence.

4. `packages/opencode/test/session/llm.test.ts` / qwen-like request capture
   - Input: `alibaba/qwen-plus` fixture with in-memory `output == context` override.
   - Output: captured local mock-server request body.
   - Logic: verify the outgoing OpenAI-compatible `max_tokens` body field is capped below context.

5. `packages/opencode/src/session/sidecar-policy.ts` + `prompt.ts` / Layer-1 summary request
   - Input: byte-stable checkpoint system/M, full trunk tool catalog, and the synthetic summary user tail.
   - Output: at most two requests, each capped at 8,192 output tokens.
   - Logic: preserve the trunk `providerCacheKey` and request prefix; Constitution denies tool execution; failed and successful cycles both start the 30s cooldown.

6. `packages/opencode/src/session/processor.ts` / `recordSessionUsage`
   - Input: normalized `finish-step` usage from either a normal turn or the summary sidecar.
   - Output: shared session token/cost totals plus sidecar cache/cost/duration diagnostics.
   - Logic: the sidecar consumes rather than discards `finish-step`, classifies raw cache reporting, and uses the same totals writer as the normal processor.

7. `packages/opencode/src/provider/balance-storage.ts` / cumulative cost baseline
   - Input: session total at snapshot time and the next session total.
   - Output: validation cost delta that includes detached sidecar requests.
   - Logic: persist the baseline in the existing snapshot metadata field; use message-row summation only for older or cross-session snapshots.

Coverage estimate vs actual codebase: 10%.

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
   - Logic: one cached DB connection per project DB path. On first open, logs each native stage, applies `busy_timeout = 5000` before WAL mode, and does not run a startup checkpoint.

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

## Session Run Lifecycle Semantics (2026-09-10)

## Portable Session Recovery (2026-09-10)

1. `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx` / `DialogSessionList`
   - Input: `/sessions` and an optional previous worktree supplied by the user.
   - Output: ordinary sessions labelled with their saved and current paths, plus a recovery entry point.
   - Logic: keeps file backup restore separate and delegates portable session recovery to its own dialog.

2. `packages/opencode/src/session/recovery.ts` / `preview`, `restore`
   - Input: an explicit source worktree, one root session ID, and the active instance context.
   - Output: a validated preview or an event-replayed session in the current database.
   - Logic: source DB is queried only; replay rebases project ID and source-root paths, normalizes the source sequence to a fresh target, and rejects malformed or duplicate streams.

1. `packages/opencode/src/effect/runner.ts` / `ensureRunning`, `supersede`, `cancel`
   - Input: work effect; current Runner state (`Idle`/`Running`/`RunningThenRun`/`Shell*`).
   - Output: joined internal-loop result or immediate replacement result; guaranteed-cancel return.
   - Logic: `ensureRunning` keeps internal callers joined. `supersede` interrupts the provider-owning fiber, settles the old deferred, drops pending internal work, then starts a new run; the interrupt is bounded so wedged native I/O cannot block replacement. Cancel retains its fire-and-forget 3s interrupt + 2s wait + idempotent force-fail.

2. `packages/opencode/src/session/prompt.ts` + `session/run-state.ts` / user prompt and loop dispatch
   - Input: a fresh `prompt()` or an internal `loop()` continuation.
   - Output: a realtime replacement or a joined loop result.
   - Logic: a fresh `prompt()` persists the user message then dispatches `supersede`; direct `loop()` remains joined. Replacement work carries the current `InstanceRef`; `InstanceState.bind()` restores the same project ALS for synchronous system-environment formatting.

3. `packages/opencode/src/session/session.ts` / `patch`
   - Input: sessionID + info patch.
   - Output: `session.updated` SyncEvent.
   - Logic: event carries projectID/directory from InstanceState.context (updatePart parity) — target DB resolves without ambient ALS on Effect fibers.

4. `packages/opencode/test/session/prompt.test.ts` / contract alignment
   - Input: poll/dump diagnostics on timeout.
   - Output: tests asserting product contracts, not incidental identities.
   - Logic: task-tool polls match by tool part; part-order accepts the static UTC suffix; polls run in-context (detached runPromise loses the database LocalContext).

Coverage estimate vs actual codebase: 9% core-deep; session lifecycle layer now fully documented.

## Explicit Portable Database Fix (2026-09-10)

1. `packages/opencode/src/project/instance.ts` / `boot`
   - Input: a normal project launch.
   - Output: project context and log setup.
   - Logic: `fromDirectory` performs the normal one-row project upsert; startup does not perform relocation repair or session mutation.

2. `packages/opencode/src/project/database-fix.ts` / `ProjectDatabaseFix.run`
   - Input: current worktree only.
   - Output: `{ projects, sessions }` update counts.
   - Logic: reads the saved project root from that DB (or one unambiguous old session path), opens `BEGIN IMMEDIATE`, remaps only selected path prefixes, and rolls back on failure.

3. `packages/opencode/src/cli/cmd/db.ts` / `opencode db fix`
   - Input: current working directory.
   - Output: a user-visible summary or an error.
   - Logic: exposes path repair as an explicit operator action, separate from ordinary startup and `/sessions` event replay.

## Startup SQLite Freeze Guard (2026-09-10)

1. `packages/opencode/src/storage/db.ts` / `startupStage`
   - Input: a native SQLite startup operation.
   - Output: paired start/completion records with duration, or a failure record with the error.
   - Logic: establishes the last-known blocking operation even when native SQLite itself cannot be cancelled in-process.

2. `packages/opencode/src/project/instance.ts` / `boot`, `track`
   - Input: first instance request and its bootstrap phases.
   - Output: explicit completion or rejection records, with the failed cache entry evicted.
   - Logic: a DB failure is propagated and logged rather than leaving later callers attached to an opaque startup promise.
