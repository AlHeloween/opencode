# UNIVERSAL_ENV — detailed reference

**Code:** `packages/opencode/src/session/system.ts`  
**Consumed by:** `llm.ts` → `assembleSystemMessages({ universalEnv: UNIVERSAL_ENV, ... })`  
**Position:** always **`system[0]`** in the provider-facing system array  
**Related:** `docs/system-prompt-order.md`

---

## 1. One-sentence definition

**`UNIVERSAL_ENV` is the immutable head of every model system prompt:** a thin product role + handoff to REASONING PROTOCOL / ALGORITHM_CARD + Exact-over-recall stance. It must never change across sessions, projects, agents, or models — so the provider’s KV cache can always hit the first prefix bytes.

It is **not** OS environment variables (`process.env`).  
It is **not** the per-project `<env>` block from `SystemPrompt.environment()` (working directory, platform, git). That is separate and lives later in the path system.  
It is **not** a tool capabilities catalogue — tool schemas (slot 1) and pocket cards own that.

---

## 2. Exact composition

```ts
// system.ts
export const UNIVERSAL_ENV = [
  "You are a coding assistant for software engineering in this product.",
  "Follow the framework governance (kernel + ADID) in the system identity.",
  "Prefer Exact evidence (tools) over unaided recall.",
].join("\n")
```

| Line | Role |
|------|------|
| coding assistant… | Product role (no brand, no project, no model name) |
| Follow the framework governance… | Handoff to kernel + ADID in the identity block |
| Prefer Exact… | Epistemic stance before tools/schemas expand |

**[KV-CACHE]** Eternal — no dates, paths, agent names, session IDs, tool lists.

---

## 3. Where it sits in the full system stack

```
system[0]  UNIVERSAL_ENV              ← THIS DOCUMENT (thin head)
system[1]  tool schemas (serialized)  ← machine capability truth
system[2]  stable body (joined):
             reasoning.txt
             → algorithm_card.txt
             → opencode_prompts_kernel.txt
             → pathSystem (rules → skills → env → AGENTS)
             → agent.prompt (subagents only; not plan/build)
system[3]  mutable tail:
             active/inactive tools line
             [session: …] banner
             optional user.system
```

Plan/build mode text is **conversation-tail synthetic**, not UNIVERSAL_ENV.

---

## 4. Why not a long capabilities list

Former brochure bullets (read formats, universalsearch, messagesearch, …) duplicated:

- tool JSON schemas (slot 1)
- REUSE / SEARCH.ORDER in kernel
- ALGORITHM_CARD grounding steps

Fat catalogue at position 0 expanded attention before the mind (reasoning + card). Detail lives in schemas + cards + skills.

---

## 5. Invariants

- Byte-identical for all agents/models/projects/sessions
- No path, cwd, branch, or date
- No plan/build mode text
- Keep under ~500 bytes; handoff only
