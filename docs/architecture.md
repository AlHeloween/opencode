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

Full write-up: **`docs/compaction.md`**.

**Problem:** One-shot “summarize 500k tokens” produces unreliable memory soup; the agent drifts.

**Solution:** Bounded normally ~64k summaries (with a provider-safe lower fallback) + soft-hide compact into `message*`. **Model** writes Inferred prose only (SVM / goal / decisions / state). **System** owns Exact digits (range IDs, stamps, fossil diffs, CodeGraph). Archive stays in DB for `session-read` / `messagesearch`. Full ownership table: **`docs/compaction.md` § Model vs system**.

```
┌─────────────────────────────────────────────────────────────┐
│              MECHANISTIC COMPACTION LOOP                     │
│                                                              │
│  Layer 1 — open window reaches ~64K content tokens (chars/4), │
│  or a lower provider-safe target:                             │
│    SYSTEM: ignored range marker + prose inject               │
│    MODEL:  s = SVM / Goal / Key decisions / Current state    │
│    SYSTEM: Exact stamp + fossil diffs for from_id..to_id     │
│            (CodeGraph = structural detail on those diffs)    │
│                                                              │
│  Layer 2 — on overflow (SYSTEM only):                        │
│    (m,m,s,m,m,s,m,m) → message* = (s,s, recent m…)           │
│    soft-hide all visible (info.compacted); never delete      │
│                                                              │
│  Loop:  (m*, s, m, m, …) → compact again → message**         │
│  counter after compact := len(message*)/4                    │
│                                                              │
│  Memory model:                                               │
│    active  = message* + recent s/m                           │
│    archive = full SQLite history (session-read / search)     │
│                                                              │
│  Checkpoint: remove on compact; save after next success      │
└─────────────────────────────────────────────────────────────┘
```

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
| `session/prompt.ts` | Main prompt loop, checkpoint, Layer-1 summary tokens | — |
| `util/plan-status.ts` | Plan progress + reconcilePlans hygiene | — |
| `cli/cmd/tui/context/agi-mode.tsx` | AGI loop, plan hygiene integration | — |
| `session/llm.ts` | LLM orchestration, system reorder, plugin hook | ~600 |
| `session/system.ts` | Environment, capabilities, provider prompts | 168 |
| `session/instruction.ts` | AGENTS.md/rules loading, caching | 270 |
| `session/checkpoint.ts` | Per-model encrypted checkpoint save/load | — |
| `session/cache-control.ts` | MD5 fingerprint, cache audit | — |
| `session/request-diff.ts` | Encrypted baseline, diff engine | — |
| `session/compaction.ts` | Mechanistic compact + injectSummaryRequest | — |
| `session/overflow.ts` | Content/token overflow detection | — |
| `session/message-v2.ts` | Schema, conversion, `filterCompacted*` | — |
| `agent/agent.ts` | 10 built-in agent definitions | 395 |
| `tool/pipeline.ts` | Pipeline tool (agent chaining) | 191 |
| `tool/capability.ts` | Model capability lookup tool | 101 |
| `tool/registry.ts` | 23 built-in tool registry | 376 |
| `attachment/handlers/` | 14 media type handlers | ~800 |
| `cli/cmd/tui/component/` | Terminal TUI components (31 files) | ~3000 |
