# OpenCode Architecture & System Design (2026-06-24)

**Status:** production
**Last Updated:** 2026-07-17
**See also:**
- `docs/reasoning-framework.md` — PromptSpec schema, syntax/disciplinary projections, IR compilation
- `docs/compaction.md` — mechanistic compaction (stable continuous memory)

---

## 1. Prompt System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PROMPT ASSEMBLY                           │
│                                                              │
│  prompt.ts: runLoop()                                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Checkpoint.load(sessionID, model)                  │   │
│  │    ├── HIT → reuse systemPrompt + messages            │   │
│  │    └── MISS → Effect.all([skills, env, instructions,  │   │
│  │               rules]) → assemble fresh                 │   │
│  │                                                       │   │
│  │ 2. system = [banner, ...rules, ...env, ...skills,     │   │
│  │              ...instructions]                          │   │
│  │                                                       │   │
│  │ 3. modelMsgs = toModelMessagesEffect(msgs, model)     │   │
│  │                                                       │   │
│  │ 4. llm.stream(system, modelMsgs, tools)               │   │
│  │    ├── Provider prefix cache: [session: key]          │   │
│  │    ├── plugin.transform hook (mutates system in-place) │   │
│  │    └── Cache collapse: header → second → tail         │   │
│  │                                                       │   │
│  │ 5. Success → Checkpoint.save(system + modelMsgs)      │   │
│  │    Failure → checkpoint untouched (rollback)           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  System prompt order:                                        │
│  [session banner] [rules] [env] [skills] [instructions]      │
│  AGENTS.md LAST (recency bias, max attention weight)         │
└─────────────────────────────────────────────────────────────┘
```

## 2. Per-Model Encrypted Checkpoint System

```
┌─────────────────────────────────────────────────────────────┐
│                   CHECKPOINT SYSTEM                          │
│                                                              │
│  Storage: {data}/log/.checkpoints/                           │
│    {provider}_{model}_{agent}_{sessionID}_S{0|1}.enc         │
│  Memory: process map published on save (no disk race)        │
│                                                              │
│  Encryption: AES-256-GCM                                     │
│  Key: SHA-256(projectID:sessionID:salt)                      │
│  Atomic: write .tmp → rename → .enc (2-slot rotate)          │
│                                                              │
│  CheckpointData v4 {                                         │
│    systemPrompt[]          path system (frozen until compact)│
│    identityFingerprint     kernel+agent prompt only          │
│    messages[] + messageIDs[] + messageFingerprints[]         │
│    model, agent, turn, timestamp                             │
│  }                                                           │
│                                                              │
│  Policy (KV continuous, multi-project stable):               │
│    • Path system (AGENTS.md/skills/rules) frozen mid-era     │
│    • Refresh only on compact OR identity fingerprint break   │
│    • Per model (+ agent) slots — switch models, nothing lost │
│    • Message reuse: ordered prefix + content fingerprints    │
│      (in-place edits re-convert from first dirty message)    │
│                                                              │
│  Diffs: request-diff remembers last formatted request so     │
│  post-compact turns still produce a diagnostic .diff         │
└─────────────────────────────────────────────────────────────┘
```

## 3. Agent Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AGENT SYSTEM                             │
│                                                              │
│  Primary agents (user-facing):                               │
│    build    — full-access development (provider prompt)      │
│    plan     — read-only planning (denies edits)              │
│                                                              │
│  Subagents (invoked via task tool or pipeline):              │
│  ┌──────────┬──────────────┬────────────────────────────┐   │
│  │ general  │ explore      │ coder      │ researcher    │   │
│  │ planning │ file search  │ implement  │ gather info   │   │
│  │ strategy │ code grep    │ edit/write │ read-only     │   │
│  ├──────────┼──────────────┼────────────┼───────────────┤   │
│  │ media    │ title        │ summary    │               │   │
│  │ generate │ name         │ describe   │               │   │
│  │ images   │ sessions     │ sessions   │               │   │
│  └──────────┴──────────────┴────────────┴───────────────┘   │
│  (No separate compaction agent — see § Mechanistic Compaction)│
│                                                              │
│  Pipeline tool: chains subagents sequentially                │
│    researcher → coder: gather evidence → implement           │
│    explore → general: find files → plan approach             │
│    media → researcher: generate → verify                     │
│                                                              │
│  Tools (23 built-in):                                        │
│    capability, pipeline, task, bash, edit, write, read,      │
│    glob, grep, list, multiedit, apply_patch, webfetch,       │
│    universalsearch, messagesearch, session-read,             │
│    job_output, job_wait, todowrite, question, skill,         │
│    lsp, plan, invalid                                         │
└─────────────────────────────────────────────────────────────┘
```

## 4. Multimodal & Media Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MEDIA SYSTEM                              │
│                                                              │
│  Attachment Pipeline:                                        │
│    User upload → Handler.classify() → UniversalAttachment    │
│    → Handler.enrich() → metadata extraction                  │
│    → Handler.normalize() → resize/optimize                   │
│    → toModelMessagesEffect() → provider format               │
│                                                              │
│  14 Handlers:                                                │
│    audio, video, image, document, binary, text, code,        │
│    sensor, spatial, archive, data, spreadsheet,              │
│    presentation, image_vector                                │
│                                                              │
│  Terminal TUI Media (Module C):                              │
│    MediaImage  ← chafa --format symbols (inline terminal)    │
│    MediaVideo  ← ffmpeg thumbnail + mpv --vo=gpu (external)  │
│    MediaAudio  ← mpv --vo=null (terminal playback)           │
│                                                              │
│  Multimodal Messages (Module D):                             │
│    • case "file" in processor.ts → FilePart creation         │
│    • Output modalities in system prompt                      │
│    • FilePart rendering in assistant messages                │
│    • toModelMessagesEffect includes assistant media           │
│                                                              │
│  Capability Tool:                                            │
│    Queries models_capabilities.yaml → cross-refs auth.json   │
│    → returns ranked models by modality + API key status      │
└─────────────────────────────────────────────────────────────┘
```

## 5. Mechanistic Compaction (Stable Continuous Memory)

**Canonical (code Exact):** [`docs/compaction.md`](compaction.md) · [`session-memory-graph.md`](session-memory-graph.md)

Do **not** summarize this section from memory — the control-flow traps are real:

```
stop path:   finishStep → Checkpoint M → maybeCaptureSidecar? → break
             ^^^ no compact() here

in-band compact: only if loop does NOT break first (e.g. tool-continue)
                 AND needsContentCompaction(open ≥ 65_536)

emergency:   processor needsCompaction → compact()

injectSummaryRequest: implemented, NOT called from prompt.ts
```

| Piece | Tokens | When |
|-------|--------|------|
| Sidecar | ephemeral LLM | stop + thresholds |
| compact() | **zero** | emergency, or in-band if loop continues |
| Safety size | content/4 + 10k | fit / usable (not cadence) |

**Model** = Inferred prose. **System** = Exact IDs / diffs / materialize / soft-hide.

## 6. KV Cache & Diff Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 CACHE & DIFF SYSTEM                          │
│                                                              │
│  cache-control.ts:                                           │
│    • MD5 fingerprint per turn (system + messages + tools)    │
│    • Stored in memory (LRU 500) + SQLite (persistent)        │
│    • auditCache(): detect system/tool/message changes        │
│    • modelMsgsCache: reuse when fingerprint stable           │
│                                                              │
│  request-diff.ts:                                            │
│    • Encrypted baseline (.enc files in .baselines/)          │
│    • AES-256-GCM, key = SHA-256(project:worktree:sid:salt)  │
│    • Section-aware diff: META + SYSTEM + MESSAGES            │
│    • alignLines: fast-path prefix scan (O(N) for identical  │
│      system prompts, avoids O(N²) sync-point search)         │
│    • Written every turn (fire-and-forget), survives restarts │
│                                                              │
│  checkpoint.ts:                                              │
│    • Reuses encryption + baselinePath from request-diff      │
│    • Stores structured prompt (not debug-formatted text)     │
│    • kind: "checkpoint" distinguishes from diff baselines    │
│    • Atomic write: tmp → rename → .enc                       │
└─────────────────────────────────────────────────────────────┘
```

## 7. Complete Data Flow

```
┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐
│  User    │───▶│  prompt.ts   │───▶│   llm.ts    │───▶│ Provider │
│  Input   │    │  assemble    │    │  reorganize │    │   API    │
└──────────┘    └──────┬───────┘    └──────┬──────┘    └────┬─────┘
                       │                   │                │
                 ┌─────▼─────┐       ┌─────▼─────┐    ┌────▼─────┐
                 │ Checkpoint │       │  Plugin   │    │ Response │
                 │ Load/Save  │       │  Hook     │    │ Stream   │
                 └─────┬─────┘       └───────────┘    └────┬─────┘
                       │                                   │
                 ┌─────▼─────┐                       ┌────▼─────┐
                 │  .enc     │                       │Processor │
                 │  Files    │                       │  Events  │
                 └───────────┘                       └────┬─────┘
                                                         │
                     ┌───────────────────────────────────┤
                     │                                   │
               ┌─────▼─────┐                       ┌─────▼─────┐
               │  Diff     │                       │  Session  │
               │  Logger   │                       │    DB     │
               │  .enc     │                       │  SQLite   │
               │  .diff    │                       └───────────┘
               └───────────┘
```

## 8. AGI plan hygiene

See **`docs/agi-workflow.md`**. Runtime `util/plan-status.ts` standardizes `plans/` vs `plans_completed/` by checkbox presence; AGI only terminates when hygiene is clean.

## 9. Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `session/prompt.ts` | Main prompt loop, checkpoint, `maybeCaptureSidecar`, Layer-2 cadence gate | — |
| `util/plan-status.ts` | Plan progress + reconcilePlans hygiene | — |
| `cli/cmd/tui/context/agi-mode.tsx` | AGI loop, plan hygiene integration | — |
| `session/llm.ts` | LLM orchestration; request size ≈ content/4+10k | — |
| `session/system.ts` | Environment, capabilities, provider prompts | — |
| `session/instruction.ts` | AGENTS.md/rules loading, caching | — |
| `session/checkpoint.ts` | Per-model encrypted checkpoint save/load | — |
| `session/incremental-checkpoint.ts` | Sidecar `project_checkpoint` CRUD / materialize | — |
| `session/cache-control.ts` | MD5 fingerprint, cache audit | — |
| `session/request-diff.ts` | Encrypted baseline, diff engine | — |
| `session/compaction.ts` | `compact()` + legacy summary helpers | — |
| `session/overflow.ts` | Cadence vs safety gates; `needsContentCompaction` | — |
| `sync/index.ts` | `SyncEvent.run` / `runBatch` (finishStep one TX) | — |
| `session/message-v2.ts` | Schema, conversion, `filterCompacted*` | — |
| `agent/agent.ts` | 10 built-in agent definitions | 395 |
| `tool/pipeline.ts` | Pipeline tool (agent chaining) | 191 |
| `tool/capability.ts` | Model capability lookup tool | 101 |
| `tool/registry.ts` | 23 built-in tool registry | 376 |
| `attachment/handlers/` | 14 media type handlers | ~800 |
| `cli/cmd/tui/component/` | Terminal TUI components (31 files) | ~3000 |
