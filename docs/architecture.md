# OpenCode Architecture & System Design (2026-06-24)

**Status:** production
**Last Updated:** 2026-06-24

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
│  Storage: .opencode/data/log/.baselines/                     │
│           {provider}_{model}_{sessionID}.enc                  │
│                                                              │
│  Encryption: AES-256-GCM                                     │
│  Key: SHA-256(projectID:worktree:sessionID:salt)             │
│  Atomic: write to .tmp → fs.renameSync → .enc                │
│                                                              │
│  CheckpointData {                                            │
│    kind: "checkpoint"     ← distinguishes from diff baseline │
│    version: 1                                                │
│    systemPrompt: string[]  ← assembled system array          │
│    messages: ModelMessage[] ← AI SDK format, ready to send   │
│    messageIDs: string[]    ← DB message IDs included        │
│    model: { providerID, modelID }                            │
│    turn: number                                              │
│  }                                                           │
│                                                              │
│  Per turn:                                                   │
│    Load .enc → reuse systemPrompt → convert only new deltas  │
│    Send → success → save new .enc (atomic overwrite)         │
│    Send → failure → .enc untouched (automatic rollback)      │
│                                                              │
│  Guarantees:                                                 │
│    • System prompt frozen between compactions                │
│    • 100% provider-side KV cache hit rate                    │
│    • AGENTS.md changes deferred to compaction boundary       │
│    • No partial state ever touches disk                      │
│                                                              │
│  Performance:                                                │
│    10x (short) → 100x+ (long sessions) faster per-turn       │
│    assembly vs full rebuild from source files + DB           │
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
│  │ media    │ compaction   │ title      │ summary       │   │
│  │ generate │ summarize    │ name       │ describe      │   │
│  │ images   │ conversation │ sessions   │ sessions      │   │
│  └──────────┴──────────────┴────────────┴───────────────┘   │
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

## 5. KV Cache & Diff Architecture

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

## 6. Complete Data Flow

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

## 7. Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `session/prompt.ts` | Main prompt loop, checkpoint integration, compaction | 2028 |
| `session/llm.ts` | LLM orchestration, system reorder, plugin hook | ~600 |
| `session/system.ts` | Environment, capabilities, provider prompts | 168 |
| `session/instruction.ts` | AGENTS.md/rules loading, caching | 270 |
| `session/checkpoint.ts` | Per-model encrypted checkpoint save/load | 121 |
| `session/cache-control.ts` | MD5 fingerprint, cache audit | 601 |
| `session/request-diff.ts` | Encrypted baseline, diff engine | 726 |
| `session/compaction.ts` | Message summarization, token budgeting | 380 |
| `session/message-v2.ts` | Message schema, conversion, filtering | 1550 |
| `agent/agent.ts` | 10 built-in agent definitions | 395 |
| `tool/pipeline.ts` | Pipeline tool (agent chaining) | 191 |
| `tool/capability.ts` | Model capability lookup tool | 101 |
| `tool/registry.ts` | 23 built-in tool registry | 376 |
| `attachment/handlers/` | 14 media type handlers | ~800 |
| `cli/cmd/tui/component/` | Terminal TUI components (31 files) | ~3000 |
