# Reasoning Kernel: Hierarchical Keyword Dictionary and Deterministic Runtime Compilation

## Intent

Keep the proven hybrid Python/text reasoning framework and its test oracles, while making the runtime prompt a compact, canonical, Pythonic keyword dictionary. The goal is better semantic retrieval and rule navigation—not replacing the framework with prose or weakening its reasoning model.

## Current State

- `opencode_prompts_kernel.py` is the canonical source: reasoning protocol, project specifications, syntax projections, epistemic projections, IR helpers, schema, examples, and tests.
- `packages/opencode/src/provider/transform.ts` concatenates `reasoning.txt` and the deterministic compact runtime kernel generated into `opencode_prompts_kernel.txt` into every model prefix.
- Runtime roots: `PROMPT_ABI`, `TERMS`, `RULES`, `WORKFLOWS`, `PACKS`, `CONTRACTS` (+ SPECS section).
- Provider assembly: pure `system-compose.ts` used by `llm.ts`.
- Checkpoint v4: `identityFingerprint` invalidates on kernel/identity change.

## Invariants

- Pythonic declarations, typed data, and science/discipline projections remain first-class model-facing concepts.
- Every runtime concept has one canonical keyword and one canonical owner; other rules reference that keyword rather than restating its semantics.
- The compiled runtime prefix is deterministic: canonical section order, canonical key order, LF line endings, no timestamps, random values, environment values, or per-turn selection.
- Checkpoint migration: identity must match via SHA-256 fingerprint; mismatch rebuilds system path (no silent old-tail + new-identity mix under a mismatched era).
- The source kernel, schema validator, and reasoning tests remain the complete development oracle.

## Work Plan

### 1. Establish a canonical taxonomy and ownership map

- [x] Add an explicit `PROMPT_ABI` with a version and precedence order.
- [x] Define the runtime root taxonomy: `TERMS`, `RULES`, `WORKFLOWS`, and `PACKS`.
- [x] Inventory every existing runtime instruction and assign a canonical owner and stable ID.
- [x] Convert repeated prose in agent, tool, governance, and grounding specifications into references to canonical rule IDs.
- [x] Fix the duplicate `search_priority_chain` source key and add an AST regression oracle for duplicate literal mapping keys.

### 2. Separate source-only machinery from model-facing declarations

- [x] Keep enums, dataclasses, state machines, PromptSpec validation, IR expansion, examples, and Python test helpers in the canonical source.
- [x] Mark the model-facing declarations explicitly rather than relying on source-file location.
- [x] Keep discipline projections as hierarchical Pythonic packs (`universal → natural/social → discipline`) with explicit parent references and precedence.
- [x] Preserve all existing agent/tool contracts, but compile them through the shared keyword vocabulary (`RUNTIME_CONTRACTS` → TERMS/RULES only).
- [x] Define how agent prompt files reference generated rule IDs and how their compact Python-shaped contracts compose with the runtime kernel.
- [x] Audit the unreferenced agent-prompt kernel copy; contracts reference generated IDs without importing the Python module.

### 3. Implement deterministic runtime compilation

- [x] Compiler entry point produces `packages/opencode/src/session/prompt/opencode_prompts_kernel.txt`.
- [x] Render readable Python-like declarations with semantic names.
- [x] Enforce canonical ordering of sections, mapping keys, rules, pack ancestry, and LF output line endings.
- [x] Update the prompt-copy/generation workflow so the generated runtime file cannot silently drift from its canonical source.
- [x] Replace the current build-time blind copy with deterministic generation.
- [x] Change the runtime import to the generated kernel while retaining `reasoning.txt` as the complementary execution protocol.

### 4. Add structural compiler oracles

- [x] AST-level duplicate mapping-key test.
- [x] Normalized semantic-rule deduplication test.
- [x] Reference/reachability test for workflows and packs.
- [x] Precedence tests for global policy (`PROMPT_ABI`), discipline pack parents, projection `resolve_precedence`, and contract keyword vocabulary.
- [x] Deterministic compilation tests: identical source → byte-identical output and stable digest.
- [x] Existing PromptSpec, projection, IR round-trip, and reasoning behavior tests retained.

### 5. Validate runtime integration and cache continuity

- [x] `transform.test.ts` asserts generated prefix load/order and absence of source-only harness symbols.
- [x] `system.test.ts` asserts runtime roots and compact packs.
- [x] System-prefix snapshot/digest test with update procedure (`test/session/system-compose.test.ts` header).
- [x] `llm.ts` / session-level composition via pure `system-compose.ts` + unit tests (UE, schemas, identity, path, tools line, banner, user system, collapse; plugin mutates before collapse).
- [x] Checkpoint migration: v4 `identityFingerprint`; load rejects mismatch/missing; prompt rebuilds system when incompatible.
- [x] Targeted Python runtime compiler tests + package Bun tests.
- [x] Prefix size report (dict section &lt; 12KB; full kernel &lt; 80KB; reasoning ~32KB; kernel ~39KB as of 2026-07-17).

## [KV-CACHE RISK]

Identity/kernel changes invalidate checkpoints (fingerprint) and change the immutable identity prefix for **new** assemblies. Within a session with a matching fingerprint, system path remains byte-stable. Do not inject dates, counters, or per-turn values into the system prefix.

## Acceptance Tests

- [x] No duplicate dictionary keys or unapproved semantic duplicates in the canonical kernel.
- [x] Every generated keyword/reference resolves and obeys declared precedence.
- [x] Generated runtime kernel is byte-identical across repeated builds and is synchronized with its source.
- [x] Provider transform loads the generated kernel in a stable order.
- [x] Checkpoint migration behavior is explicit, tested, and cannot combine eras silently.
- [x] Full provider-facing system composition has stable byte order through assembly and collapse.
- [x] Existing reasoning, PromptSpec, projection, and IR tests pass.
- [x] Compiled runtime dictionary section is compact; SPECS retained as model-facing contracts.

## Non-Goals

- Replacing the hybrid Python/text framework with prose-only instructions.
- Removing the scientific/epistemic projection system.
- Changing policy semantics or claiming quality improvements without the existing behavioural oracles.
- Dynamically changing packs within a session.

## Size snapshot (2026-07-17)

| Artifact | Bytes (approx) |
|----------|----------------|
| Runtime dictionary section (pre-SPECS) | ~5.3K |
| Full `opencode_prompts_kernel.txt` | ~38.8K |
| `reasoning.txt` | ~32.0K |
| Combined identity prefix | ~70.8K+ |
