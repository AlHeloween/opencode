# Reasoning Kernel: Hierarchical Keyword Dictionary and Deterministic Runtime Compilation

## Intent

Keep the proven hybrid Python/text reasoning framework and its test oracles, while making the runtime prompt a compact, canonical, Pythonic keyword dictionary. The goal is better semantic retrieval and rule navigation—not replacing the framework with prose or weakening its reasoning model.

## Current State

- `opencode_prompts_kernel.py` is the canonical 3,513-line source: reasoning protocol, project specifications, syntax projections, epistemic projections, IR helpers, schema, examples, and tests.
- `packages/opencode/src/provider/transform.ts` concatenates `reasoning.txt` and the deterministic compact runtime kernel generated into `opencode_prompts_kernel.txt` into every model prefix.
- The documented `compile_to_ir()` helper is exercised by Python tests but is not the runtime compilation path.
- The canonical source retains development-only implementation, comments, examples, and validators alongside operating rules; the generated runtime artifact excludes those source-only sections. The former duplicate `GROUNDING_RULES.state["search_priority_chain"]` key is covered by an AST regression oracle.
- Prefix order is intentionally stable and checkpoint/cache behavior is already strong. This plan must preserve deterministic ordering and session-level prompt immutability.

## Invariants

- Pythonic declarations, typed data, and science/discipline projections remain first-class model-facing concepts.
- Every runtime concept has one canonical keyword and one canonical owner; other rules reference that keyword rather than restating its semantics.
- The compiled runtime prefix is deterministic: canonical section order, canonical key order, LF line endings, no timestamps, random values, environment values, or per-turn selection.
- The current checkpoint replay behavior reconstructs the identity prefix and drops the stored prefix head. The migration must either preserve the checkpointed identity exactly or deliberately invalidate/rebuild checkpoints with an explicit compatibility rule.
- The source kernel, schema validator, and reasoning tests remain the complete development oracle. Runtime compilation removes no validated capability from the canonical source.
- Tool and agent contracts use the same keyword and precedence vocabulary, so no conflicting prompt dialect is introduced.

## Target Runtime Shape

The canonical source is reorganized around stable namespaces; the generated runtime file renders the same hierarchy as compact Python-like declarations:

```py
PROMPT_ABI = MappingProxyType({
    "version": "4",
    "precedence": ("safety", "governance", "task", "domain", "style"),
})

TERMS = MappingProxyType({
    "evidence": EvidencePolicy(...),
    "scope": ScopePolicy(...),
    "mutation": MutationPolicy(...),
    "verification": VerificationPolicy(...),
    "cache": CachePolicy(...),
    "plan": PlanPolicy(...),
})

WORKFLOWS = MappingProxyType({"observe": (...), "diagnose": (...), "modify": (...), "research": (...)})
PACKS = MappingProxyType({"agent.build": BuildPack(...), "lang.typescript": TypeScriptPack(...), "domain.physics": PhysicsPack(...)})
```

`TERMS` defines meanings once. `WORKFLOWS` reference term/rule IDs. `PACKS` extend the relevant parent hierarchy rather than repeat root policy. The generated file contains runtime declarations and selected compact comments only; Python implementation, test fixtures, long examples, schema mechanics, and validation code remain source-only.

## Work Plan

### 1. Establish a canonical taxonomy and ownership map

- [x] Add an explicit `PROMPT_ABI` with a version and precedence order.
- [x] Define the runtime root taxonomy: `TERMS`, `RULES`, `WORKFLOWS`, and `PACKS`.
- [x] Inventory every existing runtime instruction and assign a canonical owner and stable ID, for example `EVIDENCE.ORDER`, `WRITE.SCOPE`, and `VERIFY.OUTCOME`.
- [x] Convert repeated prose in agent, tool, governance, and grounding specifications into references to canonical rule IDs.
- [x] Fix the duplicate `search_priority_chain` source key and add an AST regression oracle for duplicate literal mapping keys.

### 2. Separate source-only machinery from model-facing declarations

- [x] Keep enums, dataclasses, state machines, PromptSpec validation, IR expansion, examples, and Python test helpers in the canonical source.
- [x] Mark the model-facing declarations explicitly rather than relying on source-file location.
- [ ] Keep discipline projections as hierarchical Pythonic packs (`universal → natural/social → discipline`) with explicit parent references and precedence.
- [ ] Preserve all existing agent/tool contracts, but compile them through the shared keyword vocabulary.
- [x] Define how agent prompt files reference generated rule IDs and how their compact Python-shaped contracts compose with the runtime kernel.
- [x] Audit the unreferenced `packages/opencode/src/agent/prompt/opencode_prompts_kernel.txt` copy; remove it or make it an explicitly generated, tested consumer so it cannot drift.

### 3. Implement deterministic runtime compilation

- [x] Add a compiler entry point that consumes the marked model-facing taxonomy and produces `packages/opencode/src/session/prompt/opencode_prompts_kernel.txt`.
- [x] Render readable Python-like declarations with semantic names; do not use an opaque abbreviation-only IR.
- [x] Enforce canonical ordering of sections, mapping keys, rules, pack ancestry, and LF output line endings.
- [x] Update the prompt-copy/generation workflow so the generated runtime file cannot silently drift from its canonical source.
- [x] Replace the current build-time blind copy with deterministic generation.
- [x] Change the runtime import to the generated kernel while retaining `reasoning.txt` as the complementary execution protocol.

### 4. Add structural compiler oracles

- [x] Add an AST-level duplicate mapping-key test so Python's last-write-wins behavior cannot hide a lost rule.
- [x] Add a normalized semantic-rule deduplication test; duplicates require an explicit alias declaration.
- [x] Add a reference/reachability test: every workflow and pack rule ID resolves exactly once, and every active term is reachable from a runtime root.
- [ ] Add precedence tests for global policy, workflow policy, and domain/tool projections.
- [x] Add deterministic compilation tests: identical source produces byte-identical output and a stable digest.
- [ ] Keep existing PromptSpec, projection, IR round-trip, and reasoning behavior tests unchanged unless the public contract intentionally changes.

### 5. Validate runtime integration and cache continuity

- [x] Extend `packages/opencode/test/provider/transform.test.ts` to assert the generated prefix is loaded, ordered, and free of source-only sections.
- [x] Replace the current `test/session/system.test.ts` expectation that runtime contains every agent, skill, command, and self-test helper with assertions for runtime roots, required compact packs, and absence of source-only symbols.
- [ ] Add a system-prefix snapshot/digest test with a deliberately documented update procedure for intentional kernel revisions.
- [ ] Add an `llm.ts`/session-level exact-composition test covering universal environment, active/inactive-tools marker, serialized tool schemas, session banner, optional user system content, compiled identity, agent prompt order, plugin `experimental.chat.system.transform`, and final system collapse—not only the inner `transform.ts` prefix.
- [ ] Design and test checkpoint migration: either replay the saved identity prefix byte-for-byte, or invalidate and atomically rebuild pre-migration checkpoints before a request is sent.
- [x] Run targeted Python reasoning/schema tests and package-level Bun prompt tests from their respective directories.
- [ ] Measure prefix bytes/tokens before and after; report separate totals for `reasoning.txt`, compiled kernel, agent contract, and tool/skill additions.

## [KV-CACHE RISK]

Replacing the raw source prefix changes the immutable system-prompt bytes for newly created sessions. This is an intentional migration, not a per-turn cache risk. The compiler must produce a byte-stable output and prompt selection must remain fixed after session creation; no task-, time-, filesystem-, or tool-dependent content may alter the system prefix between turns.

## Acceptance Tests

- [x] No duplicate dictionary keys or unapproved semantic duplicates in the canonical kernel.
- [ ] Every generated keyword/reference resolves and obeys declared precedence.
- [x] Generated runtime kernel is byte-identical across repeated builds and is synchronized with its source.
- [ ] Provider transform loads the generated kernel in a stable order.
- [ ] Checkpoint migration behavior is explicit, tested, and cannot combine an old checkpoint tail with a new identity prefix silently.
- [ ] Full provider-facing system composition has stable byte order through plugin transformation and final collapse, including environment, tools-active state, tool schemas, session banner, optional user system, compiled identity, and agent prompt.
- [x] Existing reasoning, PromptSpec, projection, and IR tests pass.
- [ ] The compiled runtime prefix is materially smaller while retaining all active operating rules and Pythonic structural cues.

## Non-Goals

- Replacing the hybrid Python/text framework with prose-only instructions.
- Removing the scientific/epistemic projection system.
- Changing policy semantics or claiming quality improvements without the existing behavioural oracles.
- Dynamically changing packs within a session. Per-session pack selection may be considered only after this deterministic all-runtime compilation is proven.
