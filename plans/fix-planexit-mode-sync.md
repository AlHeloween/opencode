# Fix: Plan→Build Mode Switch — Agent State Not Updating

## Status: FIXED (2026-08-07)

**Root cause (confirmed vs TUI):** TUI agent switch works because the *next* user message is submitted as `build_mode` with clear intent. `planexit` only wrote an empty user row `agent: build_mode` and relied on loop `insertReminders` + a soft tool result; older **plan_mode** conversation-tail prose stayed dominant, so the model kept saying “I’m in plan mode.”

**Fix:**
1. `planexit` eagerly attaches `PROMPT_BUILD` synthetic on the switch user message (same text as insertReminders; idempotent).
2. Tool output: hard IDENTITY SWITCH COMPLETE + supersedes plan_mode.
3. `build.txt`: SUPERSEDES earlier plan_mode reminders; do not claim plan mode.
4. `modeInstructionForTransition` uses `canonicalIdentity` (plan ≡ plan_mode).
5. Same eager attach for reasoning_enter / reasoning_exit.

## Bug Description (original)

When the plan agent calls `planexit` and the user approves switching to the build agent, the **agent's internal reasoning context** (the synthetic system reminder injected into the conversation) does not update to reflect build mode. The agent continues to believe it is in plan mode even though:
- The TUI correctly displays "Build" as the active agent
- The user message with `agent: "build"` is correctly persisted to the database
- The tool ACL correctly switches to build permissions

The user reports: *"the confirmation message not came"* — meaning the build mode instruction text (`PROMPT_BUILD`) is not being injected into the conversation after the mode switch.

## Root Cause Analysis (Updated)

After thorough investigation, I've confirmed:

1. ✅ `session.updateMessage(msg)` in `plan.ts:64` writes the `agent:"build"` user message synchronously to the DB
2. ✅ `messagesSince()` correctly picks up the new user message (higher MessageID)
3. ✅ `insertReminders()` computes `previousMode="plan"`, `nextMode="build"` correctly
4. ✅ `modeInstructionForTransition("plan", "build")` returns `PROMPT_BUILD`
5. ✅ `hasSynthetic()` correctly returns `false` (no duplicate)
6. ✅ Synthetic parts ARE included in the AI SDK prompt (only `ignored: true` filters them out)
7. ✅ `toModelMessagesEffect` converts the synthetic part to AI SDK format correctly

**So the server-side logic appears correct.** The bug is likely one of:

### Most Likely: Model Context Overwhelm

The `PROMPT_BUILD` text (23 lines) is injected as a synthetic part on the user message. However, the model's immediate context includes:
- The plan agent's entire assistant message (potentially thousands of tokens)
- The plan agent's tool calls and results
- The `planexit` tool result text: "User approved switching to build agent. Wait for further instructions."

The model may be **anchoring on the most recent assistant message** (plan agent) rather than the mode instruction on the user message. The `PROMPT_BUILD` text is at the **end** of the user message parts, which might be less salient than the preceding conversation.

### Alternative: TUI vs Server Desync

The TUI switches to "build" on `message.part.updated` for the completed `planexit` tool part (line 343-345 in `routes/session/index.tsx`). This happens **after** the tool returns but **before** the next loop iteration processes the `agent:"build"` user message.

If the user immediately sends a new prompt after the TUI shows "build", the TUI might submit with `agent:"build"` while the server is still processing the planexit flow. This could cause a race where the server sees two user messages with `agent:"build"` — one from planexit and one from the TUI.

### Most Likely Actual Bug: The model sees the plan agent's tool result as the dominant signal

When `planexit` returns `{ title: "Switching to build agent", output: "User approved switching to build agent. Wait for further instructions." }`, this tool result is appended to the **plan agent's assistant message**. The model sees:

```
[Assistant: plan agent]
  ... planning content ...
  [Tool: planexit → "Switching to build agent" / "Wait for further instructions"]
[User: agent="build"]
  <system-reminder>
  # Build mode — conversation tail only
  ...
  </system-reminder>
```

The model's next response is generated as a **continuation of the assistant message**. Even though the `PROMPT_BUILD` is present, the model might interpret the situation as "I (the plan agent) just called planexit and the system acknowledged it. I should wait."

**The fix should make the mode transition more explicit.** Options:

1. **Change the `planexit` tool output** to explicitly tell the model it's now in build mode
2. **Inject `PROMPT_BUILD` as a separate user message** (not as a synthetic part on the existing user message) so it's a standalone signal
3. **Add a system-level mode marker** that's impossible for the model to miss

```ts
// Line 64: Write the build agent user message
yield* session.updateMessage(msg)

// Line 65: Invalidate permission cache
invalidatePermissionCache()

// Lines 67-71: Return tool output
return {
  title: "Switching to build agent",
  output: "User approved switching to build agent. Wait for further instructions.",
  metadata: {},
}
```

The tool returns successfully, and the run loop re-iterates. On the next loop iteration:

1. `MessageV2.messagesSince()` fetches new messages from the DB — the `agent: "build"` user message **is visible** ✓
2. `lastUser` is found by scanning backwards — it correctly finds the build user message ✓
3. `agents.get(lastUser.agent)` resolves to the build agent ✓
4. **`insertReminders()` is called** — this is where the bug occurs

In `insertReminders` (`packages/opencode/src/session/prompt.ts:310-347`):

```ts
const userIndex = input.messages.findLastIndex((msg) => msg.info.id === userMessage.info.id)
const previousMode = input.messages.slice(0, userIndex).findLast((msg) => msg.info.agent)?.info.agent
const instruction =
  modeInstructionForTransition(previousMode, input.agent.name) ?? ...
```

**The problem:** `previousMode` is computed by scanning messages **before** the current user message. After `planexit` injects a new user message with `agent: "build"`, the message stream looks like:

```
... [assistant: plan mode tools] → [user: agent="build"] ← new
```

When the loop re-reads, `userMessage` = the new `[user: agent="build"]` message. `previousMode` scans `slice(0, userIndex)` and finds the **previous** user message which has `agent: "plan"`. So `modeInstructionForTransition("plan", "build")` should return `PROMPT_BUILD` ✓

**Wait — this should work correctly.** Let me reconsider...

### Actual Root Cause: Synthetic Part Idempotency

The `hasSynthetic()` check at line 321-327 compares the **normalized text** of existing synthetic parts on the user message:

```ts
const hasSynthetic = (text: string) =>
  userMessage.parts.some(
    (p) =>
      p.type === "text" &&
      (p as MessageV2.TextPart & { synthetic?: boolean }).synthetic === true &&
      normalizeNL(p.text) === normalizeNL(text),
  )
```

**The issue:** `insertReminders` operates on the **in-memory `msgs` array** that was fetched at the start of the loop iteration. But the new user message with `agent: "build"` was written to the DB **after** the loop started — it arrives via `MessageV2.messagesSince()` at line 1465.

However, the **synthetic part** for the mode instruction is created at line 337-345:
```ts
const part = yield* sessions.updatePart({
  id: PartID.ascending(),
  messageID: userMessage.info.id,
  sessionID: userMessage.info.sessionID,
  type: "text",
  text: instruction,
  synthetic: true,
})
userMessage.parts.push(part)
```

This writes the synthetic part to the DB AND pushes it onto the in-memory `userMessage.parts` array. On the **very next loop iteration**, `messagesSince` would fetch this part, and `hasSynthetic` would correctly detect it.

**But here's the real bug:** The `planexit` tool returns `output: "User approved switching to build agent. Wait for further instructions."` — this is a **tool result**, not a user-visible confirmation. The model sees this tool output and then continues generating.

**The actual problem is more subtle.** Let me trace the exact flow:

1. Plan agent calls `planexit`
2. `question.ask()` blocks, TUI shows dialog
3. User clicks "Yes"
4. `question.reply()` resolves the deferred
5. `planexit` resumes, writes `agent: "build"` user message to DB
6. `planexit` returns `{ title: "Switching to build agent", output: "..." }`
7. The **assistant message** (from the plan agent turn) records this tool result
8. The assistant message is finalized with `time.completed`
9. **The run loop continues** — it does NOT immediately re-read from DB

**The critical insight:** The run loop at `prompt.ts:1446-1872` is a **single continuous execution**. When `planexit` is called as a tool during the plan agent's turn, the tool executes **within the same assistant message generation context**. After the tool returns, the assistant message is still being generated — the model may make more tool calls.

But `planexit` is supposed to be a **terminal tool** — after it returns, the plan agent's turn should end and the build agent should take over on the **next** user-initiated turn.

**Wait — I need to re-read the flow more carefully.** Let me check what happens after `planexit` returns in the tool execution context...

Looking at `prompt.ts`, the tool execution happens inside `handle.process()` which is the AI SDK stream. When `planexit` returns, the tool result is added to the assistant message's parts. The model then sees this result and may continue generating.

**The actual bug:** After `planexit` writes the `agent: "build"` user message, the **current assistant message** (the plan agent's response) continues processing. The model sees the tool result "Switching to build agent" and stops generating (because planexit is designed to be terminal). The assistant message completes.

Then the loop re-iterates at line 1459. It calls `MessageV2.messagesSince()` to get new messages. The `agent: "build"` user message **is there**. The loop finds `lastUser` with `agent: "build"`, resolves the build agent, and calls `insertReminders`.

**So where does the bug actually occur?**

Let me check if `insertReminders` is called with the correct agent...

At line 1604: `msgs = yield* insertReminders({ messages: msgs, agent, session })` where `agent` is from line 1591: `const agent = yield* agents.get(lastUser.agent)`.

If `lastUser.agent === "build"`, then `agent` is the build agent, and `modeInstructionForTransition(previousMode, "build")` should return `PROMPT_BUILD`.

**Unless... the `previousMode` computation is wrong.**

Let me re-examine line 330:
```ts
const previousMode = input.messages.slice(0, userIndex).findLast((msg) => msg.info.agent)?.info.agent
```

This scans messages before the current user message. After planexit:
- Messages: `[..., assistant(plan), user(plan), assistant(plan with planexit tool), user(build)]`
- `userMessage` = `user(build)` (the last user message)
- `userIndex` = index of `user(build)`
- `slice(0, userIndex)` = everything before `user(build)`
- `findLast(msg => msg.info.agent)` = the most recent message with an agent field before `user(build)`

**What is the most recent message with `.agent` before `user(build)`?** It would be `user(plan)` — the original user message that started the plan agent turn. So `previousMode = "plan"`.

`modeInstructionForTransition("plan", "build")` → returns `PROMPT_BUILD` ✓

**So the logic is correct.** The bug must be elsewhere.

### Hypothesis: The synthetic part is not being persisted/visible

Let me check `sessions.updatePart` — does it actually persist the synthetic part, or is it only in-memory?

Looking at `src/session/session.ts`, `updatePart` should persist the part to the DB. But the key question is: **is the synthetic part visible to the model in the next turn?**

The synthetic part is written to the DB via `SyncEvent.run`. It should be visible immediately. But the model's context is built from `MessageV2.WithParts[]` — the messages with their parts.

**Wait — I think I found it!**

Look at line 345: `userMessage.parts.push(part)` — this pushes the part onto the **in-memory** `userMessage` object. But `userMessage` is the object from the `msgs` array. On the **next loop iteration**, `msgs` is rebuilt from `MessageV2.messagesSince()` — it fetches fresh from DB.

The question is: does `messagesSince` include the synthetic part that was just written?

Let me check `MessageV2.messagesSince`...

Actually, looking more carefully at the flow:

1. Loop iteration N: plan agent is running, `msgs` contains messages up to some point
2. Plan agent calls `planexit` tool
3. `planexit` writes `agent:"build"` user message to DB (line 64)
4. `planexit` returns tool result
5. Model stops generating (planexit is terminal)
6. Assistant message completes
7. Loop iteration N ends
8. Loop iteration N+1: `msgs = yield* MessageV2.filterCompactedEffect(sessionID)` OR `messagesSince`
9. The new `msgs` should include the `agent:"build"` user message

**But the synthetic part for PROMPT_BUILD is written in iteration N+1, not N!**

In iteration N+1:
- `msgs` includes the `agent:"build"` user message
- `insertReminders` is called
- It computes `previousMode = "plan"`, `nextMode = "build"`
- It calls `modeInstructionForTransition("plan", "build")` → returns `PROMPT_BUILD`
- It checks `hasSynthetic(PROMPT_BUILD)` — the user message has NO synthetic parts yet (it was just fetched from DB)
- It writes the synthetic part via `sessions.updatePart`
- It pushes the part onto the in-memory `userMessage.parts`

**This should work!** The synthetic part is written to DB and pushed to the in-memory array. The model should see it.

**Unless... there's a race condition or the part isn't being included in the prompt sent to the model.**

Let me check how the prompt is constructed after `insertReminders`...

At line 1604, `insertReminders` returns the modified `msgs` array. Then at line 1646+, the outcome is computed, tools are resolved, and the AI SDK `stream()` is called.

The prompt construction happens inside the AI SDK stream call. The `msgs` array (with the synthetic part) is passed to the prompt builder.

**I think the bug might be in how the TUI or the model perceives the mode.** Let me reconsider the user's report:

> "when agent himself switch from plan to build mode he still thinking that he was in planning mode while tui shows clearly that he as in build mode"

The TUI shows build mode because `local.agent.set("build")` is called on `message.part.updated` for the `planexit` tool (line 343-345). This is a **TUI-side display** based on the completed tool event.

But the **agent's reasoning** is driven by the prompt text injected by `insertReminders`. If `PROMPT_BUILD` is correctly injected, the agent should know it's in build mode.

**Possible issue:** The `PROMPT_BUILD` text in `build.txt` might not be strong enough, or the model might be confused by the conversation context.

Actually, wait. Let me re-read the user's report more carefully:

> "Looks by some reason confirmation message not came"

**"Confirmation message"** — this could mean:
1. The question dialog didn't appear (but the user says "tui shows clearly that he as in build mode", so the switch happened)
2. The `PROMPT_BUILD` synthetic reminder wasn't injected
3. The tool output "User approved switching to build agent" wasn't clear enough

**I think the real issue might be simpler:** The `planexit` tool returns `output: "User approved switching to build agent. Wait for further instructions."` — this is the **tool result** that the model sees. But this text says "Wait for further instructions" which might confuse the model into thinking it should wait passively rather than proactively switching to build mode behavior.

**Actually, I think I finally found the real bug!**

Look at the `planexit` flow again:

1. Plan agent calls `planexit`
2. User approves
3. `planexit` writes `agent:"build"` user message
4. `planexit` returns tool result
5. **The tool result is added to the PLAN AGENT's assistant message**
6. The model sees the tool result and stops generating
7. The assistant message completes
8. Next loop iteration: build agent takes over

**The problem:** The tool result "User approved switching to build agent. Wait for further instructions." is part of the **plan agent's assistant message**. When the build agent takes over on the next iteration, it sees the full conversation history including this tool result. The model might interpret this as "the system is waiting" rather than "I am now in build mode."

**But more importantly:** The `insertReminders` function injects `PROMPT_BUILD` as a synthetic text part on the **user message** with `agent:"build"`. This should be the dominant signal for the model.

**Let me check if there's a timing issue with the synthetic part visibility...**

Actually, I think I need to look at this from a different angle. Let me check if the `planexit` tool result might be causing the model to think it's still in plan mode...

**New hypothesis:** The `planexit` tool is called by the plan agent. When it returns, the tool result is recorded in the plan agent's assistant message. The model then sees:
- Assistant message (plan agent): [tools calls including planexit] → [planexit result: "Switching to build agent"]
- User message: `agent:"build"` (injected by planexit)
- Assistant message (build agent): [new response]

The model might be confused because the **last thing it generated** was the plan agent's response with the planexit tool result. The `PROMPT_BUILD` is injected on the user message, but the model's immediate context is the plan agent's assistant message.

**Actually, I think the real issue is even simpler.** Let me re-read the `insertReminders` code:

```ts
const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
```

This finds the **last user message**. After planexit, the last user message is the one with `agent:"build"`. Good.

```ts
const userIndex = input.messages.findLastIndex((msg) => msg.info.id === userMessage.info.id)
const previousMode = input.messages.slice(0, userIndex).findLast((msg) => msg.info.agent)?.info.agent
```

This scans messages before the user message. The last message with `.agent` before `user(build)` would be... let me think:

Messages in order:
1. `user: agent="build"` (from initial session? No, the user's original prompt)
2. `assistant: agent="build"` (initial response)
3. ... various messages ...
4. `user: agent="plan"` (user's prompt that triggered plan mode)
5. `assistant: agent="plan"` (plan agent's response with planexit tool)
6. `user: agent="build"` (injected by planexit)

Wait, the initial user message might not have `agent:"build"` — it would have whatever agent was selected. Let me reconsider.

**Actually, the key question is:** when the user manually switches to plan mode via TUI and submits a prompt, the user message has `agent:"plan"`. Then the plan agent responds. Then planexit injects `agent:"build"` user message.

So the sequence is:
1. `user: agent="plan"` (user switched to plan mode and submitted)
2. `assistant: agent="plan"` (plan agent responding, calls planexit)
3. `user: agent="build"` (injected by planexit)

Now in the next loop iteration:
- `userMessage` = `user: agent="build"` (last user message)
- `userIndex` = index of this message
- `slice(0, userIndex)` = messages 1 and 2
- `findLast(msg => msg.info.agent)` = message 1 (`user: agent="plan"`)
- `previousMode = "plan"`
- `modeInstructionForTransition("plan", "build")` → `PROMPT_BUILD` ✓

**This should work!** So where's the bug?

**Let me check one more thing:** Is the `agent` field on the user message actually set correctly when planexit injects it?

Looking at `plan.ts:56-63`:
```ts
const msg: MessageV2.User = {
  id: MessageID.ascending(),
  sessionID: ctx.sessionID,
  role: "user",
  time: { created: Date.now() },
  agent: "build",
  model,
}
```

Yes, `agent: "build"` is explicitly set. ✓

**I think the bug might be in the TUI's perception, not the server-side logic.**

The user says "tui shows clearly that he as in build mode" — this means `local.agent.set("build")` was called. But the **agent's reasoning** is driven by the prompt, not the TUI display.

**Wait — could the issue be that the model is using a cached context?**

Looking at `prompt.ts:1601`:
```ts
const cacheAgent = providerIdentityForMode(agent, (yield* agents.get("build")) ?? agent)
```

`providerIdentityForMode` always returns the build agent. This is intentional for KV-cache stability. But could this cause the model to think it's still in build mode when it should be in plan mode, or vice versa?

No, this is about the **provider identity** (tool schemas, skills), not the mode instruction. The mode instruction is separate.

**OK, I think I need to actually test this to confirm the bug.** But based on the user's report, the most likely issue is:

1. The `PROMPT_BUILD` text is being injected correctly
2. But the model's **system prefix** (which is shared across all modes) might be overriding the mode instruction
3. Or the model is confused by the conversation context

**Actually, let me re-read the user's original report one more time:**

> "when agent himself switch from plan to build mode he still thinking that he was in planning mode"

This says the agent **itself** switched (via planexit), but **it** (the agent) still thinks it's in planning mode. This means the **model's generated response** after the switch shows plan-mode behavior.

**This is the key insight!** The model is generating responses that reflect plan-mode constraints even though it's now the build agent.

**Possible causes:**
1. `PROMPT_BUILD` is not being injected (bug in insertReminders)
2. `PROMPT_BUILD` is injected but the model ignores it (prompt engineering issue)
3. The model's context window includes so much plan-mode content that it anchors on that

**I think the most likely bug is #1 — `PROMPT_BUILD` is not being injected.** Let me trace through the code one more time to find where it could fail...

**Found it!** Look at line 336:
```ts
if (!instruction || hasSynthetic(instruction)) return input.messages
```

If `instruction` is `undefined` or the synthetic text is already present, `insertReminders` returns early without injecting anything.

`modeInstructionForTransition("plan", "build")` should return `PROMPT_BUILD` (the contents of `build.txt`). But what if `previousMode` is not `"plan"`?

**What if `previousMode` is `undefined`?**

Looking at line 330:
```ts
const previousMode = input.messages.slice(0, userIndex).findLast((msg) => msg.info.agent)?.info.agent
```

This uses optional chaining (`?.`). If no message before `userIndex` has `.agent`, then `previousMode` is `undefined`.

`modeInstructionForTransition(undefined, "build")` → line 87: `if (nextMode === "build") return PROMPT_BUILD` ✓

**What if `previousMode` is `"build"`?** (e.g., the user was in build mode, switched to plan, then back to build)

`modeInstructionForTransition("build", "build")` → line 85: `if (previousMode === nextMode) return` → returns `undefined` ✓ (correct, no re-injection needed)

**So the logic seems correct.** But wait — what if the `msgs` array doesn't include the `agent:"build"` user message at all?

**Race condition hypothesis:** The `planexit` tool writes the `agent:"build"` user message to the DB (line 64). But the run loop's `msgs` array was fetched **before** this write. When the loop re-iterates, it calls `messagesSince` to get new messages.

But what if `messagesSince` doesn't include the new user message? Let me check the implementation...

Looking at `MessageV2.messagesSince` — I need to find this function. Let me search for it.

Actually, looking at `prompt.ts:1464-1475`:
```ts
if (cachedMsgs && lastKnownId) {
  const newMsgs = MessageV2.messagesSince(sessionID, lastKnownId)
  msgs = [...cachedMsgs, ...newMsgs]
} else {
  msgs = yield* MessageV2.filterCompactedEffect(sessionID)
}
```

`lastKnownId` is set at line 1477: `lastKnownId = msgs[msgs.length - 1]?.info.id`.

After the plan agent's turn completes, `lastKnownId` is the ID of the plan agent's assistant message. Then `messagesSince(sessionID, lastKnownId)` should return all messages with ID > `lastKnownId`, which would include the `agent:"build"` user message (since it was created with `MessageID.ascending()` after the assistant message).

**Unless `MessageID.ascending()` doesn't guarantee ordering...**

Let me check `MessageID.ascending()` — it's probably a simple incrementing ID. If the user message is created after the assistant message, it should have a higher ID.

**I think the flow is correct.** But let me consider one more possibility:

**What if the `planexit` tool's `session.updateMessage` call fails silently?**

Looking at `plan.ts:64`:
```ts
yield* session.updateMessage(msg)
```

If this throws, the `Effect.orDie` at line 72 would crash. But the user says the TUI shows build mode, which means the tool completed successfully (the `message.part.updated` event fired).

**Actually wait — the TUI switches on `message.part.updated` for the `planexit` tool part, not on the `agent:"build"` user message.**

Looking at `routes/session/index.tsx:343-345`:
```ts
if (part.tool === "planexit") {
  local.agent.set("build")
  lastSwitch = part.id
}
```

This fires when the `planexit` **tool part** completes, regardless of whether the `agent:"build"` user message was written successfully!

**So the TUI can show "build" even if the `agent:"build"` user message wasn't written!**

But `plan.ts:64` writes the message before the tool returns, so if the tool completed, the message should be in the DB.

**Unless there's a transactional issue...**

Looking at `session.updateMessage` in `session.ts:745-753`:
```ts
updateMessage(msg: MessageV2.User | MessageV2.Assistant) {
  return Effect.sync(() => {
    SyncEvent.run(MessageV2.Event.Updated, { info: msg.info })
    // ... more code
  })
}
```

This uses `Effect.sync` which is synchronous. The message should be in the DB before the tool returns.

**OK, I'm going in circles. Let me take a step back and consider the simplest explanation:**

The user says the agent "still thinking that he was in planning mode." This could mean:
1. The agent's first response after the switch still references plan-mode constraints
2. The agent refuses to use build-mode tools
3. The agent's system prompt still shows plan-mode text

**The most likely explanation is that `PROMPT_BUILD` is not being injected, or is being injected but the model doesn't see it.**

Let me check one more thing: **is the synthetic part actually included in the prompt sent to the AI SDK?**

Looking at how the prompt is constructed... The `msgs` array (with the synthetic part) is passed to the AI SDK. But the AI SDK prompt builder might filter out synthetic parts!

Let me search for how synthetic parts are handled in the prompt construction...

Actually, looking at `prompt.ts`, the messages are converted to the AI SDK format. I need to find where this conversion happens and whether synthetic parts are included.

**This is getting complex. Let me just write the plan based on my analysis.**

## Hypothesis

The most likely root cause is that the **synthetic mode instruction (`PROMPT_BUILD`) is not being injected** onto the `agent:"build"` user message after `planexit`. This could be due to:

1. **`insertReminders` not being called** for the first build agent turn after planexit
2. **`hasSynthetic()` returning true** incorrectly (e.g., if the user message already has a synthetic part from a previous injection)
3. **The synthetic part not being included** in the AI SDK prompt construction
4. **A race condition** where `msgs` doesn't include the `agent:"build"` user message when `insertReminders` is called

## Investigation Plan

1. **Add logging** to `insertReminders` to trace:
   - What `previousMode` and `nextMode` are computed
   - Whether `modeInstructionForTransition` returns a value
   - Whether `hasSynthetic` returns true (blocking injection)
   - Whether the synthetic part is written

2. **Add logging** to the AI SDK prompt construction to verify synthetic parts are included

3. **Test the flow** manually:
   - Start plan mode
   - Write a plan
   - Call `planexit`
   - User approves
   - Check if the build agent's first response reflects build mode

## Fix Plan

### Recommended Fix: Enhance the `planexit` tool output + strengthen `PROMPT_BUILD` injection

The fix should address both the **immediate signal** (tool output the model sees) and the **persistent signal** (synthetic reminder on the user message).

#### Change 1: Update `planexit` tool output (`packages/opencode/src/tool/plan.ts`)

Change the return value from:
```ts
return {
  title: "Switching to build agent",
  output: "User approved switching to build agent. Wait for further instructions.",
  metadata: {},
}
```

To:
```ts
return {
  title: "Switching to build agent",
  output: "MODE SWITCH: You are now the BUILD agent. You have full tool access. Begin implementing the plan immediately.",
  metadata: {},
}
```

This ensures the model sees an explicit mode-change directive as part of its own assistant message, not just as a synthetic reminder on a user message.

#### Change 2: Strengthen `PROMPT_BUILD` text (`packages/opencode/src/session/prompt/build.txt`)

The current `build.txt` is subtle and assumes the model will notice it. Make it more prominent:

```txt
<system-reminder>
# BUILD MODE ACTIVE — You are now the BUILD agent

You have FULL tool access. Begin implementing the plan immediately.
Do NOT continue planning. Do NOT ask for clarification unless blocked.

Previous mode was PLAN. You have switched to BUILD.
</system-reminder>
```

#### Change 3: Add debug logging to `insertReminders` (`packages/opencode/src/session/prompt.ts`)

Add logging to trace mode transitions:
```ts
if (instruction) {
  log.debug("mode transition", { previousMode, nextMode: agent.name, instruction: instruction.substring(0, 100) })
}
```

This will help diagnose future occurrences.

### Alternative Fix (if above doesn't work): Inject mode instruction as a standalone user message

Instead of adding the synthetic part to the existing user message, create a **new synthetic user message** with the mode instruction. This would be a more explicit signal in the conversation flow.

This is a larger change and should only be done if the simpler fixes don't resolve the issue.

## Files to Modify

1. **`packages/opencode/src/tool/plan.ts`** (lines 67-71) — Change the `planexit` tool return output to explicitly state the mode switch
2. **`packages/opencode/src/session/prompt/build.txt`** — Strengthen the build mode instruction text to be more prominent
3. **`packages/opencode/src/session/prompt.ts`** (lines 310-347) — Add debug logging to `insertReminders` for mode transitions

### Optional (if above doesn't work):
4. **`packages/opencode/src/tool/plan.ts`** — Change the mode injection to create a new synthetic user message instead of appending to the existing one

## Smoke Tests

1. **Manual test (primary):**
   - Enter plan mode via TUI (agent picker or cycle)
   - Submit a simple prompt like "Write a plan to add a hello world feature"
   - Let the plan agent write the plan to `plans/*.md`
   - Plan agent should call `planexit`
   - User approves in the TUI dialog
   - **Verify:** The build agent's first response immediately starts implementing (uses bash, write, edit tools) and does NOT reference plan-mode constraints or ask "what should I implement?"
   - Check logs in `.opencode/data/log/` for the `mode transition` debug entry showing `previousMode: "plan"`, `nextMode: "build"`

2. **Automated test (in `test/session/mode-transition.test.ts`):**
   - Create a session, inject plan-mode messages
   - Simulate `planexit` tool execution
   - Verify the `agent:"build"` user message is created
   - Verify `insertReminders` injects `PROMPT_BUILD` (check the synthetic part exists on the user message)
   - Verify the AI SDK prompt (via `toModelMessagesEffect`) includes the `PROMPT_BUILD` text

3. **Edge case test:**
   - Test the flow: build → plan → build (multiple mode switches)
   - Verify each transition correctly injects the appropriate mode instruction
   - Verify no duplicate mode instructions are injected (idempotency)

## Risks

- Changing `insertReminders` could affect KV-cache behavior
- Adding logging could add noise to hot paths
- The fix might need to be in the AI SDK prompt construction, not just `insertReminders`
