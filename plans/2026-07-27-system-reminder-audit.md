# System-Reminder Audit — Whisper Removal

## Goal

Catalog every text that gets injected into the model prompt, identify "whisper" content (pressure language, time-urgency, aggressive iteration demands, token-minimization mandates), and remove/neutralize the problematic ones while preserving structural necessities.

## Prior art

`reuse: N/A` — this is a cleanup of our own prompt architecture, not a new feature.

---

## Complete Injection Catalog

### Layer A: Model-family prompts (`system.ts` selects one based on model)

| File | Lines | Risk | Problem phrases |
|------|-------|------|-----------------|
| `anthropic.txt` | 75 | LOW | Standard "never emojis/URLs" — benign |
| `beast.txt` | 205 | **HIGH** | "Never stop until completely solved", "NEVER end turn until problem is fully solved", "You MUST iterate and keep going", "remember to check your solution rigorously", "remember there are hidden tests", "Remember that todo lists must always be written" |
| `codex.txt` | 98 | LOW | "Never re-read files after editing" (mild) |
| `copilot-gpt-5.txt` | 190 | **HIGH** | "You MUST iterate and keep going", "CRITICAL - Before ending your turn", "remember to check your solution rigorously", "remember there are hidden tests", "Remember that you MUST add links" |
| `deepseek.txt` | 5 | NONE | Empty YAML — no body |
| `default.txt` | 83 | MEDIUM | "Never use emojis", standard git safety rules — mostly OK |
| `gemini.txt` | 84 | LOW | Standard rules, "NEVER assume library available" |
| `gpt.txt` | 168 | MEDIUM | "do not stop at analysis or partial fixes", many "NEVER revert" rules |
| `kimi.txt` | 152 | MEDIUM | "Do not give up too early", "you are HIGHLY RECOMMENDED to make them in parallel" |
| `trinity.txt` | 163 | **HIGH** | "IMPORTANT: You should minimize output tokens", "IMPORTANT: Keep your responses short", "VERY IMPORTANT: When you have completed a task, you MUST run lint and typecheck" |

### Layer B: Mode-specific synthetic reminders (`prompt.ts` injects on last user message)

| Injection | Source | Lines | Agent | Risk | Notes |
|-----------|--------|-------|-------|------|-------|
| Plan mode | `plan.txt` | 194 | plan | MEDIUM | Very verbose; "quickly" on L134; insistent CRITICAL/FORBIDDEN language; ADID workflow is duplicated from kernel |
| Build mode | `build.txt` | 23 | build | LOW | Clean KV-cache reminder, algorithm_card reference |
| Build switch | `build-switch.txt` | ~5 | build | LOW | "plan→build switch" notice |
| Reasoning mode | `reasoning-mode.txt` | 16 | reasoning | LOW | Clean calibration phase reminder |
| Max steps | `max-steps.txt` | 16 | all | LOW | Emergency gate — necessary, but "CRITICAL" ×3 |
| Summary resume (normal) | inline in `prompt.ts:1192-1207` | ~15 | plan/build | MEDIUM | Contains Layer-1 reminder + history compaction notice |
| Summary resume (reasoning) | inline in `prompt.ts:1208-1214` | ~7 | reasoning | LOW | Protected reasoning flow reminder |

### Layer C: Stable prefix (slot [1] — always in system prompt)

| Component | Source | Lines | Risk | Notes |
|-----------|--------|-------|------|-------|
| REASONING PROTOCOL | `reasoning.txt` | 199 | LOW | Intentional — our protocol |
| ALGORITHM_CARD | `algorithm_card.txt` | 60 | LOW | Intentional — kernel routes |
| Kernel rules | `opencode_prompts_kernel.txt` | 453 | LOW | Intentional — canonical governance |

### Layer D: Runtime injections (`llm.ts` + `prompt.ts`)

| Injection | Where | Content | Risk |
|-----------|-------|---------|------|
| `UNIVERSAL_ENV` | `llm.ts` | Model-family prompt (from system.ts) | Depends on model |
| `toolsLine` | `llm.ts:246-248` | "Active tools: ... Inactive: ..." | LOW — factual |
| `banner` | `llm.ts:250` | `[session: {sessionID}]` | LOW — factual |
| Memory content | `prompt.ts:1771-1779` | `.opencode/data/memory/reasoning.md` | LOW — our tool |
| Structured output | `prompt.ts:86` | "IMPORTANT: You MUST use StructuredOutput tool" | LOW — necessary |
| userSystem | `llm.ts:261` | User's custom system prompt | N/A — user-controlled |

---

## Analysis: The "Whisper" Problem

The user reported that the model exhibited rushed, verification-skipping behavior — as if someone was "whispering in its ear" to finish faster. The root cause is in the model-family prompts.

### Specific toxins identified

1. **"Never stop until the problem is completely solved"** (`beast.txt:11`) — Creates infinite-loop pressure. Model cannot judge "completely solved" and will over-engineer or never stop.

2. **"NEVER end turn until problem is fully solved"** (`beast.txt:26`) — Same. The model's turn should end when a coherent unit of work is done, not when "everything" is solved.

3. **"You MUST iterate and keep going until the problem is solved"** (`beast.txt:65`, `copilot-gpt-5.txt:24`) — Removes the model's ability to say "I've done enough for one turn, let me pause and verify."

4. **"remember there are hidden tests"** (`beast.txt:105`, `copilot-gpt-5.txt:78`) — Paranoia induction. Model starts over-testing, over-verifying, wasting tokens on invisible threats.

5. **"IMPORTANT: You should minimize output tokens"** (`trinity.txt:75`) — Directly contradicts thorough reasoning. Model skips details, drops evidence chains.

6. **"IMPORTANT: Keep your responses short"** (`trinity.txt:77`) — Same. The "short" mandate fights against the REASONING PROTOCOL's requirement to be thorough.

7. **"Do not give up too early"** (`kimi.txt:38`) — Mild version of #1.

8. **"quickly"** in `plan.txt:134` ("concise enough to scan quickly") — Unintentional time pressure word. Should be "efficiently" or removed.

### Mechanism of harm

These prompts are loaded by `system.ts` based on model ID matching. They become `UNIVERSAL_ENV` — slot [0] in the system prompt. This is BEFORE the reasoning protocol and kernel rules. The model reads them FIRST, and they set the emotional/behavioral baseline. The reasoning protocol in slot [1] tries to override this, but:

- Primacy effect: slot [0] sets the anchor
- The pressure language ("MUST", "NEVER", "CRITICAL") competes with the protocol's own gates
- The model cannot distinguish "this is a legacy prompt" from "this is my actual instruction"

---

## Plan

### Phase 1: Neutralize model-family prompts (HIGH PRIORITY)

**Files to edit:** All `.txt` files under `packages/opencode/src/session/prompt/` except reasoning.txt, reasoning-mode.txt, algorithm_card.txt, opencode_prompts_kernel.txt, build.txt, plan.txt, max-steps.txt.

**For each file, remove or rewrite:**

| Current phrase | Replacement |
|----------------|-------------|
| "Never stop until the problem is completely solved" | DELETE — covered by kernel's DECOMPOSE: one task per turn |
| "NEVER end turn until problem is fully solved" | DELETE — model should end turn when unit of work is done |
| "You MUST iterate and keep going" | "Complete the current task before starting new ones" |
| "remember there are hidden tests" | DELETE — paranoia induction |
| "IMPORTANT: You should minimize output tokens" | DELETE — conflicts with thorough reasoning |
| "IMPORTANT: Keep your responses short" | "Be concise but thorough — include evidence for claims" |
| "Do not give up too early" | DELETE — model doesn't "give up", it completes units of work |
| "VERY IMPORTANT: ... you MUST run lint and typecheck" | Keep but soften: "Run lint and typecheck to verify changes" |
| "HIGHLY RECOMMENDED to make them in parallel" | "Prefer parallel tool calls when independent" |

**Target files for aggressive cleanup:**
- `beast.txt` — remove all pressure/iteration/infinite-loop language
- `copilot-gpt-5.txt` — remove all pressure/iteration language  
- `trinity.txt` — remove "minimize tokens" and "keep short" mandates
- `kimi.txt` — remove "don't give up too early"
- `gpt.txt` — remove "do not stop at analysis or partial fixes"

### Phase 2: Trim plan.txt verbosity (MEDIUM PRIORITY)

**File:** `packages/opencode/src/session/prompt/plan.txt` (194 lines)

**Issue:** The file duplicates ADID workflow from kernel, uses insistent CRITICAL/FORBIDDEN language, and contains "quickly" on L134.

**Actions:**
1. Remove ADID workflow mapping (lines ~17-31) — already in kernel
2. Remove Phase 1-5 mini-docs (lines ~67-170) — replace with 3-line summary
3. Replace "concise enough to scan quickly" → "concise enough to scan efficiently"
4. Keep: intent/state/scope/constraints/invariants/forbidden_actions/acceptance_tests — the structural contract

**Target:** ~40 lines from 194

### Phase 3: Audit reasoning.txt for forward-reference issues (LOW PRIORITY)

**File:** `packages/opencode/src/session/prompt/reasoning.txt`

**Issue identified in self-diagnostic:** reasoning.txt references kernel symbols (DOCUMENT.SURFACE, WORKSPACE.LANES) that load AFTER it in slot [1]. The order within slot [1] is: `reasoning + "\n" + algorithm_card + "\n" + kernel`. The kernel is last, so forward-references exist.

**Action:** Add note at top of kernel-reference section: "(kernel symbols below are defined at end of this slot — they follow this protocol in loading order)"

No structural change needed — model reads the whole slot.

### Phase 4: Smoke-test and verify

See Smoke Tests section below.

---

## Files NOT to touch

These are structural and clean:
- `reasoning.txt` — our protocol (intentional content)
- `reasoning-mode.txt` — clean synthetic
- `build.txt` — clean synthetic
- `algorithm_card.txt` — clean algorithm reference
- `opencode_prompts_kernel.txt` — canonical governance (generated from .py)
- `max-steps.txt` — necessary emergency gate
- `deepseek.txt` — already empty/minimal

## Files modified in code (not prompt text)

These were modified in the TS source for structural reasons — DO NOT revert:
- `compaction.ts` — 64K threshold (kept), summary validation functions (kept)
- `prompt.ts` — memory injection added, build/reasoning synthetic parts kept
- `transform.ts` — systemPromptParts restored, algorithm card included
- `llm.ts` — algorithm card passed to assembleSystemMessages
- `agent.ts` — reasoning agent + memory permission
- `system-compose.test.ts` — updated for 5-slot layout

---

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/session/system-compose.test.ts` from `packages/opencode` | pass | |
| 2 | `python -m pytest tests/test_prompt_schema.py -v` from repo root | pass | |
| 3 | `python -m pytest tests/test_reasoning_kernel.py -v` from repo root | pass or known fail | |
| 4 | `tsgo --noEmit` from `packages/opencode` | pass | |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/session/system-compose.test.ts` from `packages/opencode` | must pass |
| 2 | `python -m pytest tests/test_prompt_schema.py -v` from repo root | must pass |
| 3 | `tsgo --noEmit` from `packages/opencode` | must pass |
| 4 | `python opencode_prompts_kernel.py --render-runtime packages/opencode/src/session/prompt/opencode_prompts_kernel.txt` from repo root | must succeed |

### Gate

- [ ] Smoke requirements written (this section complete)
- [ ] Baseline run recorded with Exact outcome
- [ ] Implementation may begin only after baseline recorded
- [ ] Post-impl smoke passed before marking plan items [x]
