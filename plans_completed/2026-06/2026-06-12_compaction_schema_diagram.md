# Compaction Schema Analysis & Diagram

**Date:** 2026-06-12 (updated 2026-06-13 with normal-flow integration)  
**Status:** Validated (codebase cross-reference complete, corrections applied)  
**Priority:** Medium

---

## 1. Entity/Types Schema (ER Diagram)

```mermaid
erDiagram
    SessionTable ||--o{ MessageV2 : "has_many"
    MessageV2 ||--o{ CompactionPart : "has"
    MessageV2 ||--o{ MessageV2_Info : "info"
    SessionTable {
        integer time_compacting "Last prune timestamp (epoch ms)"
    }
    MessageV2 {
        string id PK "MessageID"
        string sessionID FK "SessionID"
        string role "user | assistant"
        boolean summary "Is compaction summary?"
        string finish "stop | error | undefined; boundary signal"
        string error "serialized error object or null"
        integer time_created "epoch ms"
        integer time_completed "epoch ms"
    }
    CompactionPart {
        string id PK "PartID (uuid)"
        string sessionID FK "SessionID"
        string messageID FK "MessageID"
        literal type "compaction"
        boolean auto "Auto-triggered vs manual"
        boolean overflow "Overflow trigger vs user-initiated"
        integer tail_count "Original post-boundary tail messages preserved"
    }
    CompactionConfig {
        boolean auto "Enable auto compaction (default: true)"
        boolean prune "Enable tool output pruning (default: true)"
        integer tail_turns "Recent turns kept verbatim (default: unlimited)"
        integer preserve_recent_tokens "Token budget for tail (default: 2K-10K dynamic)"
        integer reserved "Token buffer for compaction window (default: min(20K, maxOutput))"
    }
```

### Part Hierarchy (Discriminated Union)

```mermaid
classDiagram
    class PartBase {
        +PartID id
        +SessionID sessionID
        +MessageID messageID
    }
    class TextPart {
        +Literal "text"
    }
    class ToolPart {
        +Literal "tool"
        +ToolState state
    }
    class CompactionPart {
        +Literal "compaction"
        +Boolean auto
        +Boolean? overflow
        +Number? tail_count
    }
    class SubTaskPart {
        +Literal "subtask"
    }
    class ReasoningPart {
        +Literal "reasoning"
    }
    class FilePart {
        +Literal "file"
    }

    PartBase <|-- TextPart : extends
    PartBase <|-- ToolPart : extends
    PartBase <|-- CompactionPart : extends
    PartBase <|-- SubTaskPart : extends
    PartBase <|-- ReasoningPart : extends
    PartBase <|-- FilePart : extends

    note for CompactionPart "Discriminated by type='compaction'\nUnion discriminator in _Part type"
```

---

## 2. Compaction State Machine

```mermaid
stateDiagram-v2
    [*] --> Normal : session active

    Normal --> OverflowDetected : token usage >= usable context
    OverflowDetected --> CompactionTaskQueued : process() returns "compact"\n→ compaction.create() inserts\nuser msg w/ CompactionPart

    Normal --> OverflowFromContent : content-estimated\noverflow check
    OverflowFromContent --> CompactionTaskQueued : isOverflowFromContent()\n→ compaction.create(overflow=true)

    CompactionTaskQueued --> Compacting : prompt loop picks up\ncompaction part from tasks

    Compacting --> SelectingMessages : select() splits head/tail
    Note right of Compacting: tail_count stored on CompactionPart<br/>for filterCompactedEffect boundary logic
    SelectingMessages --> GeneratingSummary : normal processor invoked<br/>(same agent, same system prompt<br/>as the original user turn)

    Note right of Compacting: prune() is called separately\nafter each turn loop exit\n(prompt.ts main loop)\nNOT inside the compaction block

    GeneratingSummary --> SummaryDone : LLM returns summary text<br/>summary: true on assistant msg
    GeneratingSummary --> SummaryErrored : LLM error / ContextOverflowError

    SummaryDone --> Done : persist summary assistant\n(updateMessage)\n+ optional auto-continue prompt

    SummaryErrored --> Done : halt() marks finish="error"\nerrored summary still serves\nas compaction boundary

    Done --> Normal : filterCompactedEffect()\nloads only messages since\ncompaction boundary\n(uses tail_count + summary=true)

    note right of OverflowDetected
        processor.ts:553-558
        isOverflow() check after
        each finish-step event
    end note

    note right of SummaryErrored
        Fix applied 2026-06-11:
        errored summaries now
        valid boundaries
    end note
```

---

## 3. Module Interaction (Component Diagram)

```mermaid
graph TD
    subgraph "External Inputs"
        CONFIG[Config<br/>compaction.auto, .prune,<br/>.tail_turns, .preserve_recent_tokens,<br/>.reserved]
        ENV[Env Flags<br/>OPENCODE_DISABLE_AUTOCOMPACT<br/>OPENCODE_DISABLE_PRUNE]
    end

    subgraph "Session Module"
        OVERFLOW[overflow.ts<br/>usable()<br/>isOverflow()<br/>isOverflowFromContent()]
        COMPACTION[compaction.ts<br/>select() - head/tail split<br/>prune() - tool output erasure<br/>create() - task creation<br/>selectMessages() - public API]
        MESSAGE[message-v2.ts<br/>CompactionPart schema<br/>filterCompactedEffect()<br/>isCompactionBoundary()<br/>pageCompacted()]
        PROCESSOR[processor.ts<br/>needsCompaction flag<br/>halt() - error handling<br/>process() - return compact/stop/continue]
        PROMPT[prompt.ts<br/>task extraction<br/>compaction: normal processor path<br/>same agent, same system prompt<br/>overflow creation]
    end

    subgraph "Storage"
        DB[(SQLite DB<br/>session.time_compacting<br/>message with CompactionPart<br/>assistant with summary=true)]
    end

    subgraph "Skill System"
        SKILL[compaction SKILL.md<br/>built-in skill<br/>available to all agents<br/>via sys.skills(agent)]
    end

    CONFIG --> OVERFLOW
    CONFIG --> COMPACTION
    ENV --> CONFIG

    PROCESSOR -->|"calls isOverflow()"| OVERFLOW
    PROCESSOR -->|"sets needsCompaction"| PROCESSOR
    PROCESSOR -->|"returns 'compact'"| PROMPT

    PROMPT -->|"filterCompactedEffect()"| MESSAGE
    PROMPT -->|"compaction.create()"| COMPACTION
    PROMPT -->|"compaction.selectMessages()"| COMPACTION
    PROMPT -->|"compaction.prune()"| COMPACTION
    PROMPT -->|"isOverflowFromContent()"| OVERFLOW
    PROMPT -->|"handle.process()<br/>(normal processor)"| PROCESSOR

    COMPACTION -->|"select() - token estimation"| MESSAGE
    COMPACTION -->|"reads/writes"| DB

    SKILL -->|"loaded via<br/>sys.skills(agent)"| PROMPT

    MESSAGE -->|"loads messages"| DB
    PROCESSOR -->|"reads/writes"| DB

    style OVERFLOW fill:#e6f3ff
    style COMPACTION fill:#ffe6cc
    style MESSAGE fill:#e6ffe6
    style PROCESSOR fill:#f0e6ff
    style PROMPT fill:#ffe6e6
    style SKILL fill:#e6e6ff
```

---

## 4. Full Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant Prompt as prompt.ts<br/>(runLoop)
    participant Processor as processor.ts
    participant Overflow as overflow.ts
    participant Message as message-v2.ts
    participant Compaction as compaction.ts
    participant Agent as Compaction Agent
    participant DB as SQLite

    Note over Prompt,DB: === Normal Conversation ===

    loop Each turn
        Prompt->>Message: filterCompactedEffect(sessionID)
        Message->>DB: SELECT messages LIMIT 500<br/>WHERE id > lastBoundaryID
        DB-->>Message: message page
        Message-->>Prompt: msgs (since last compaction boundary)

        Prompt->>Processor: process(msgs)
        Note over Processor: LLM streaming...

        Processor->>Overflow: isOverflow(tokens, model, cfg)
        Overflow-->>Processor: overflow? (true/false)

        alt overflow detected
            Processor->>Processor: ctx.needsCompaction = true
            Processor-->>Prompt: return "compact"
        else no overflow
            Processor-->>Prompt: return "continue"
        end
    end

    Note over Prompt,DB: === Compaction Trigger ===

    opt result === "compact"
        Prompt->>Compaction: create({ sessionID, auto: true, overflow: true/false })
        Compaction->>DB: INSERT user message<br/>with CompactionPart (auto, overflow)
        Note over Prompt: continue loop
    end

    Note over Prompt,DB: === Compaction Execution ===

    Prompt->>Message: filterCompactedEffect(sessionID)
    Message->>DB: load all messages (no boundary found)
    DB-->>Message: all messages
    Message-->>Prompt: msgs

    Prompt->>Prompt: extract tasks from messages
    Note over Prompt: finds CompactionPart on latest user msg

    Prompt->>Compaction: selectMessages({ messages, model })
    Compaction->>Compaction: select() - head/tail split
    Note over Compaction: head = summarized<br/>tail = kept verbatim<br/>preserve_recent_tokens budget
    Compaction->>DB: UPDATE CompactionPart.tail_count
    Compaction-->>Prompt: { head, tail }

    Note over Prompt: construct system prompt<br/>IDENTICAL to normal turn:<br/>same agent → same skills<br/>same rules, instructions, env<br/>no timestamps or mutable markers

    Prompt->>Processor: handle.process({ user, agent, system, messages })
    Note over Processor: normal processor flow<br/>compaction skill loaded via sys.skills()<br/>instruction: "Please create a structured<br/>summary... Do not use any tools"
    Processor-->>Prompt: summary text

    alt summary successful
        Prompt->>DB: INSERT assistant message<br/>(summary=true, finish=stop, mode=agent.name)
        Prompt-->>Prompt: return "break"
    else summary errored
        Prompt->>DB: UPDATE assistant message<br/>(summary=true, finish=error)
        Prompt-->>Prompt: return "break"
    end

    Note over Prompt,DB: === Post-Compaction (Next Turn) ===

    Prompt->>Message: filterCompactedEffect(sessionID)
    Message->>DB: SELECT messages LIMIT 500<br/>newest first
    Message->>Message: iterate until compaction boundary found:
    Note over Message: assistant.summary=true<br/>+ assistant.finish set<br/>→ parent user with compaction part = boundary<br/>tail_count messages preserved before boundary
    Message-->>Prompt: msgs (only post-compaction)

    Note over Prompt,DB: === Pruning (after each turn loop exit) ===

    Prompt->>Compaction: prune({ sessionID })<br/>(forked, fire-and-forget)
    Compaction->>DB: load all messages
    Compaction->>Compaction: walk backwards, accumulate tool output<br/>skip protected tools, skip last 2 user turns
    Note over Compaction: accumulate until PRUNE_PROTECT (40K)<br/>then collect parts to prune
    Compaction->>DB: for each pruned part:<br/>UPDATE part.state.time.compacted = Date.now()
    Note over Compaction: only if total > PRUNE_MINIMUM (20K)
```

---

## 5. Head/Tail Selection Algorithm

```mermaid
flowchart TD
    A["select(messages, cfg)"] --> B["compute preserveRecentBudget<br/>= magic ∨ config.preserve_recent_tokens<br/>∨ default: 25% of usable context<br/>clamped to [MIN=2K, MAX=10K]"]
    B --> C["turns = extract turns from messages<br/>(user+response as one turn)"]
    C --> D["turns = reverse(turns)<br/>+ limit(tail_turns from config)"]
    D --> E["accumulated = 0<br/>keep = []"]

    E --> F{"next turn?"}
    F -->|yes| G["count = estimate(turn messages)"]
    G --> H{"accumulated + count<br/>> preserveRecentBudget?"}
    H -->|no| I["keep.unshift(turn)<br/>accumulated += count"]
    I --> F
    H -->|yes| J["splitTurn(turn, budget - accumulated)"]
    J --> K{"splitTurn finds<br/>a suffix within budget?"}
    K -->|yes| L["keep.unshift({start: splitIdx})<br/>turn truncated to fit budget"]
    K -->|no| M["stop; last turn would<br/>exceed entire budget"]
    L --> F

    F -->|no| N["head = messages[0 : keep[0].start]<br/>tail = messages[keep[0].start : ]"]
    N --> O["return { head, tail }"]

    style A fill:#ffe6cc
    style O fill:#e6ffe6
```

---

## 6. Token Budget Model

```mermaid
graph LR
    subgraph "Context Token Budget"
        CTX["Raw Context Window<br/>(varies by model)"]
    end

    subgraph "Reserved Overhead"
        MO["maxOutput<br/>(output tokens)"]
        RES["compaction.reserved<br/>(default: min(20K, maxOutput))"]
        BUFF["Compaction Buffer<br/>(COMPACTION_BUFFER = 20K)"]
    end

    subgraph "Usable Context"
        U["usable() = model.limit.input - reserved<br/>OR<br/>usable() = context - maxOutput"]
    end

    subgraph "Within Usable Context"
        HEAD["Head (summarized)<br/>= everything before tail"]
        TAIL["Tail (preserved verbatim)<br/>preserve_recent_tokens<br/>default: 25% of usable<br/>clamped [2K, 10K]"]
        WORKING["Working Space<br/>(remaining tokens for<br/>current turn generation)"]
    end

    CTX --> MO
    MO --> RES
    RES --> BUFF
    BUFF --> U
    U --> HEAD
    U --> TAIL
    U --> WORKING

    style U fill:#ffe6cc,stroke:#e69900,stroke-width:3px
    style HEAD fill:#ffcccc
    style TAIL fill:#ccffcc
```

---

## 7. Pruning Schema

```mermaid
flowchart TD
    A["compaction.prune(sessionID)<br/>called from prompt.ts:1422<br/>(forked after each turn loop exit<br/>NOT inside processCompaction)"] --> B{"compaction.prune<br/>enabled?"}
    B -->|no| Z["return (no-op)"]
    B -->|yes| C["msgs = load all messages<br/>skip last 2 user turns"]

    C --> D["walk msgs backwards<br/>(newest to oldest)<br/>total = 0, toPrune = []"]

    D --> E{"next message?"}
    E -->|yes| F{"has completed tool parts<br/>(excl. 'skill')<br/>with uncompacted output?"}
    F -->|yes| G["total += part output tokens"]
    G --> H{"total > PRUNE_PROTECT<br/>(40K tokens)?"}
    H -->|no| E
    H -->|yes| I["toPrune.push(part)"]
    I --> E
    F -->|no| E

    E -->|no| J{"pruned = sum(toPrune) > PRUNE_MINIMUM<br/>(20K tokens)?"}
    J -->|no| Z
    J -->|yes| K["toPrune.forEach(part =><br/>part.state.time.compacted = Date.now()<br/>+ session.updatePart(part))"]
    K --> Z

    Note right of K: session.time_compacting is NOT updated by prune()\nit exists in the DB schema but prune() only updates individual parts

    style A fill:#e6f3ff
    style K fill:#ffcccc
    style Z fill:#e6ffe6
```

---

## 8. Key Constants Reference

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `COMPACTION_BUFFER` | 20,000 | `overflow.ts:6` | Default reserved token buffer |
| `PRUNE_MINIMUM` | 20,000 | `compaction.ts:37` | Min tokens to trigger pruning |
| `PRUNE_PROTECT` | 40,000 | `compaction.ts:38` | Token threshold to keep unpruned |
| `TOOL_OUTPUT_MAX_CHARS` | 2,000 | `compaction.ts:39` | Max chars to collect from tool output |
| `PRUNE_PROTECTED_TOOLS` | `["skill"]` | `compaction.ts:40` | Tools whose outputs are never pruned |
| `DEFAULT_PRESERVE_RECENT_TOKENS` | 10,000 | `compaction.ts:41` | Default tail token budget |
| `MIN_PRESERVE_RECENT_TOKENS` | 2,000 | `compaction.ts:42` | Minimum tail token budget |
| Page size | 500 | `message-v2.ts` | Messages per DB page in `filterCompactedEffect` |

---

## 9. CompactionPart DB Schema (Drizzle)

```typescript
// message-v2.ts:225-233
export const CompactionPart = Schema.Struct({
  ...partBase,                              // id, sessionID, messageID
  type: Schema.Literal("compaction"),       // discriminator literal
  auto: Schema.Boolean,                     // auto-triggered (true) vs manual /summarize (false)
  overflow: Schema.optional(Schema.Boolean), // true when triggered by context overflow
  tail_count: Schema.optional(Schema.Number), // original post-boundary tail messages preserved
})

// Session DB column: session.sql.ts:37
time_compacting: integer(),                 // epoch ms; read/written via session.ts info.time.compacting
                                            // Note: prune() does NOT update this field — only individual parts are marked

// Config: config.ts:218-237
compaction: Schema.optional(Schema.Struct({
  auto: Schema.optional(Schema.Boolean),                   // default: true
  prune: Schema.optional(Schema.Boolean),                  // default: true
  tail_turns: Schema.optional(NonNegativeInt),             // default: unlimited (u32 max)
  preserve_recent_tokens: Schema.optional(NonNegativeInt), // default: dynamic 2K-10K
  reserved: Schema.optional(NonNegativeInt),               // default: min(20K, maxOutput)
})),
```

### JSON/Storage representation (tool part compaction state)

```typescript
// When prune() runs, it sets on tool parts:
part.state.time.compacted = Date.now()

// When filterCompactedEffect loads messages:
// Skips parts where part.state?.time?.compacted is set
// (these are tool outputs that have been summarized in a prior compaction)
```

---

## 10. Compaction Skill Definition

Compaction is a **built-in skill** (`src/skill/compaction/SKILL.md`), not a separate agent.
The skill is registered in `skill/index.ts` and available to all agents via `sys.skills(agent)`.

```yaml
# src/skill/compaction/SKILL.md (frontmatter)
name: compaction
description: Summarize conversation history using the anchored summary template.
```

The compaction turn uses the **same agent** as the original user turn (e.g., "build").
No tool-less "compaction" agent is needed — the text instruction says "Do not use any tools."
This keeps the system prompt byte-identical between turns, preserving KV cache continuity.

```typescript
// compaction.ts — create() inserts a user message with the summarization instruction
const msg = yield* session.updateMessage({
    role: "user",
    agent: input.agent,           // same agent as the original turn
    ...
})
yield* session.updatePart({
    type: "text",
    text: "Please create a structured summary of the conversation history. " +
          "Keep the most recent turn verbatim. " +
          "Do not use any tools — just produce the summary.",
    synthetic: true,
})
yield* session.updatePart({
    type: "compaction",
    auto: input.auto,
    overflow: input.overflow,
})

// prompt.ts — compaction block uses the same agent
const agent = yield* agents.get(lastUser.agent)  // user's original agent
// → sys.skills(agent) returns identical content to previous turn
// → system prompt is byte-stable → KV cache hits for prefix
```

---

## 11. KV Cache Continuity Model

The system prompt is **byte-stable** for the entire session:

| Component | Source | Changes between turns? |
|-----------|--------|----------------------|
| sessionIdBanner | `[session: <ID>]` | No |
| rules | `instruction.rules()` | No (file-based) |
| instructions | `instruction.system()` | No (file-based) |
| env | `sys.environment(model)` | No (no timestamps, no mutable markers) |
| skills | `sys.skills(agent)` | No (same agent used) |
| json_schema | `STRUCTURED_OUTPUT_SYSTEM_PROMPT` | Same condition → same result |

Date (`Today's date: ...`) is injected into **user messages**, not the system prompt
(`prompt.ts:1417-1430`). Providers see identical SHA256(system prompt) across all turns
including compaction → prefix cache hits → minimum recomputation.

---

## Verification Checklist

- [x] Confirm `CompactionPart` schema matches current `message-v2.ts` -- VERIFIED
- [x] Confirm `time_compacting` column exists in `session.sql.ts` -- VERIFIED
- [x] Confirm config schema matches `config.ts` -- VERIFIED
- [x] Confirm boundary detection logic in `filterCompactedEffect` at `message-v2.ts` -- VERIFIED
- [x] Confirm overflow detection in `overflow.ts` -- VERIFIED
- [x] 2026-06-13: Removed `processCompaction` — compaction now uses normal processor path -- VERIFIED
- [x] 2026-06-13: Compaction skill as proper SKILL.md + built-in registration -- VERIFIED
- [x] 2026-06-13: Same agent, same system prompt for KV cache continuity -- VERIFIED
- [x] 2026-06-13: `summary: true` + `tail_count` set before compaction processing -- VERIFIED
- [x] Validate against codebase via explore agent -- COMPLETED; corrections applied
- [x] Run typecheck: `bun typecheck` from `packages/opencode` -- passed
- [x] Run compaction tests: `bun test test/session/compaction.test.ts` from `packages/opencode` -- 31 pass, 0 fail
- [x] Run skill tests: `bun test test/skill/skill.test.ts` from `packages/opencode` -- 10 pass, 0 fail

### Corrections Applied (from explore validation)

| Section | Issue | Fix |
|---------|-------|-----|
| 2 | ManualSummarize path not implemented in code | Removed from state machine |
| 2, 4, 7 | `prune()` shown as step inside `processCompaction` | Corrected: `prune()` is called separately from `prompt.ts` after loop exit |
| 7 | `session.time_compacting` shown as updated by `prune()` | Corrected: `prune()` only updates individual `part.state.time.compacted` |
| 3, 10 | Agent prompt shown as file `compaction.txt` | Corrected: compaction is a built-in skill (`SKILL.md`) loaded via `sys.skills()` |
| 10 | Compaction as separate "compaction" agent | Corrected: uses same agent as original turn; skill loaded via normal skill system |
| 2, 4, 9 | Diagram still showed synthetic tail copies and omitted `tail_count` | Corrected: removed synthetic tail insertions and added `CompactionPart.tail_count` |
| 4 | Compaction process omitted normal system prompt | Corrected: normal processor constructs identical system prompt (same agent → same skills) |
