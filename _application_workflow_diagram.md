---
title: Application Workflow Diagram
owner: Local_Development
status: production
last_verified: 2026-09-13
reproduce:
  files:
    - packages/opencode/src/provider/transform.ts
    - packages/opencode/src/session/llm.ts
    - packages/opencode/test/session/llm.test.ts
    - packages/opencode/src/cli/cmd/tui/component/dialog-routing.tsx
    - packages/opencode/src/cli/cmd/tui/component/dialog-routing-state.ts
    - packages/opencode/test/tui/dialog-routing-state.test.ts
    - packages/opencode/src/provider/provider-sync.ts
    - packages/opencode/src/cli/cmd/tui/component/dialog-streamlake-vanchin-state.ts
    - packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx
    - packages/opencode/test/tui/dialog-streamlake-vanchin-state.test.ts
  commands:
    - cd packages/opencode && bun test test/session/llm.test.ts
    - cd packages/opencode && bun test test/tui/dialog-routing-state.test.ts
    - cd packages/opencode && bun test test/provider/provider-sync.test.ts test/tui/dialog-streamlake-vanchin-state.test.ts
  inputs: Provider request assembly for an OpenRouter parent or child task session; or a Vanchin Pay-as-you-go endpoint with the deployed model selected from the official catalog.
  expected_outputs: Mutable banner, body session_id, header x-session-id, and prompt_cache_key share one provider cache namespace; Vanchin setup persists an endpoint model profile with documented text/image/video input modalities and no API key.
---

# Application Workflow Diagram

## StreamLake Vanchin Provider Setup (2026-09-13)

1. `provider-sync.ts` / `PROVIDER_SOURCES` registers `streamlake-vanchin` as a visible static provider with the Pay-as-you-go OpenAI-compatible gateway. It intentionally has no bundled account endpoint.
2. `DialogProvider` gathers the API key through existing auth storage and validates an `ep-…` endpoint ID. It then presents a picker backed by `STREAMLAKE_VANCHIN_MODELS`, rather than text fields for guessed capabilities.
3. The selected official profile patches only `provider.streamlake-vanchin.models.<endpoint-id>` with documented context/output limits, reasoning, Function Call, text/image/video input modalities, and `options.enable_thinking: true` for reasoning profiles. `/config` never receives the API key.
4. On request assembly, the profile’s `enable_thinking` option is forwarded in the OpenAI-compatible provider namespace. Request-level `modalities` is deliberately absent: the official protocol reserves it for Qwen-Omni audio output, not generic image/video understanding.
5. The retired coding-template option is limited to `/api/gateway/coding/v1`; it cannot enter the Pay-as-you-go `vanchin.streamlake.ai/api/gateway/v1/endpoints` request path.
6. The Pay-as-you-go gateway did not expose endpoint metadata through six authenticated `GET` routes (all HTTP 400); the endpoint ID is therefore from the Vanchin console and the model metadata from the official catalog snapshot.

Oracle: focused Vanchin state and provider-option tests.

## OpenRouter Routing Editor Flow (2026-09-12)

1. `DialogAgent` or `DialogModel` opens `DialogRouting` with an explicit session, worktree, or global write scope.
2. `DialogRouting` resolves the effective agent → model → provider routing source and fetches live endpoints for the selected OpenRouter model.
3. `dialog-routing-state.ts` exposes an existing `only` or `order` selection, validates native `price`/`throughput`/`latency` sorting, and chooses fp8 by default only when live endpoint metadata supports it.
4. Choosing dynamic sort clears manual provider selection; choosing a provider clears dynamic sort. Unknown native routing keys survive reconstruction.
5. The Save row calls the scope-specific writer once and closes only after that write succeeds. There is no follow-up confirmation dialog.
6. Global `/agents` model selection passes a pending model into `DialogVariant`; variant selection stays local until `Save model and variant`, which calls `setGlobalAgentSelection` once.
7. For the active agent only, that explicit global Save writes the chosen model and variant into the open session's settings. Session precedence makes the next prompt and its status row agree with the saved selection; another agent and an in-flight request are not changed.

Oracle: `test/tui/dialog-routing-state.test.ts`, package typecheck, and cmd_runner TUI render showing sort rows, `[x] fp8`, `Save to GLOBAL config`, and `Save model and variant`.

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
   - Output: at most two requests, each capped at 32,768 output tokens (16K reasoning window + 16K body; only the answer is stored — a floor, not a dial).
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

## Anthropic Claude Pro/Max OAuth Flow (2026-09-12)

1. `packages/opencode/src/plugin/anthropic.ts` / `AnthropicAuthPlugin.methods`
   - Input: `/connect` or `opencode auth login anthropic`, then browser or pasted callback input.
   - Output: OAuth `{ access, refresh, expires, accountId?, email?, orgId?, orgName? }` persisted by the existing auth route.
   - Logic: builds OMP-compatible Claude PKCE parameters, validates callback state on a loopback server (preferred 54545, ephemeral fallback), and exchanges JSON authorization codes at Anthropic's OAuth token endpoint.

2. `packages/opencode/src/auth/index.ts` / `Oauth`
   - Input: plugin callback result or a refreshed OAuth token pair.
   - Output: encrypted auth record with optional account, organisation, and initial authorization metadata.
   - Logic: keeps the existing API-key union untouched; optional fields preserve identity for the OAuth-specific login display without becoming a migration requirement.

3. `packages/opencode/src/plugin/anthropic.ts` / auth loader + `transformOAuthRequest`
   - Input: stored OAuth credential and the AI SDK's final Anthropic request.
   - Output: `POST /v1/messages?beta=true` with Bearer auth, Claude-Code beta/header fingerprint, CCH-attested billing system block, Claude agent identity block, original system blocks/cache markers, and a 64K output ceiling.
   - Logic: refreshes expired access tokens once, removes the SDK dummy API key, preserves API-key mode when the credential is not OAuth, and never logs token material.

## Codex Tool-Host Kernel Render (2026-09-12)

1. `prompt_kernel/addons_codex.py` / `CODEX_GATE_ADDONS`
   - Input: the current Codex harness tool catalog.
   - Output: host-specific advisory tool bindings while the core graph remains shared.
   - Logic: binds CodeGraph, Read/Glob/Grep, Edit/Write, LSP/AST Edit, Hub,
     Eval Browser, Todo, Task, and `cmd_runner`; excludes unavailable
     OpenCode/Claude tools.

2. `prompt_kernel/__main__.py` / `--codex`
   - Input: explicit renderer mode.
   - Output: timestamped runtime, review, manifest, and migration artifacts in
     `prompt_kernel/dist_codex/`.
   - Logic: renders only; `--codex --install` returns an error because the
     external harness has no repository-local import contract.

3. `prompt_kernel/source.py` + `render.py` / authorization wording
   - Input: a host whose authorization-inspection tool is not `getmode`.
   - Output: host-neutral core language; the product registry retains its
     concrete `getmode` instruction.
   - Logic: prevents a shared render from commanding a tool absent on the
     target host.

Coverage estimate vs actual codebase: 9% core-deep; kernel host rendering is now documented for OpenCode, Claude Code, and Codex.

## TUI Per-Model Sampling and Stable Endpoint Routing (2026-09-13)

1. `packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx` / `DialogAgent`
   - Input: highlighted agent and selected configuration scope.
   - Output: visible `Sampling parameters` (`ctrl+g`) opens the resolved model's parameter editor.
   - Logic: keeps model selection, variant selection, and sampling independent; configuring a non-active agent never changes the prompt agent.

2. `packages/opencode/src/cli/cmd/tui/component/dialog-model-parameters.tsx` / `DialogModelParameters`
   - Input: model plus session/worktree/global scope.
   - Output: editable temperature, repetition penalty, top-p, and presence penalty with Save as the final row.
   - Logic: numeric edits remain staged until Save; Escape exits without a write.

3. `packages/opencode/src/cli/cmd/tui/context/local.tsx` + `session/model-sampling.ts`
   - Input: a persisted model key and the selected scope.
   - Output: effective sampling values.
   - Logic: session state overrides worktree `model.json`, which overrides provider model configuration; missing or invalid fields normalize to the four standard defaults.

4. `packages/opencode/src/session/llm.ts` / `LLM.run`
   - Input: effective sampling and selected model.
   - Output: `streamText` sampling parameters and namespaced repetition penalty.
   - Logic: agent-specific temperature/top-p still take precedence; the model-level values control the remaining request surface.

5. `packages/opencode/src/cli/cmd/tui/component/dialog-routing.tsx` / `DialogRouting`
   - Input: asynchronous OpenRouter endpoint data plus keyboard or pointer activation.
   - Output: one permanent endpoint-status line, a persistent routing-mode summary, and stable form headings.
   - Logic: the first focusable row is the dynamic-sort radio group; keyboard traversal (`routingMoveCursor`, heading-skip unit-tested) skips headings, pointer release and Space/Enter share the same action, every dynamic choice clears manual providers, and the summary line is derived by `routingModeLabel` (unit-tested). Live loading never inserts/removes status text or changes headings, so the selector does not visibly flash while endpoints resolve.
