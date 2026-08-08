#!/usr/bin/env python3
"""Apply compact DSL to schemas and policy specs."""
import os, re

PROJECT = r'D:\zPython\opencode'

# === 1. Update core_schemas.yaml schemas ===
path = os.path.join(PROJECT, 'prompts_kernel', 'core_schemas.yaml')
with open(path) as f: c = f.read()

# Replace from # SEMANTIC VECTOR through end of bug_fix
old_start = c.find('\n# SEMANTIC VECTOR (SV)')
old_end = c.find('\nexplorer_goal:')
if old_end == -1: old_end = c.find('\n# DOMAIN SOURCES')

compact_schemas = '''
# SCHEMAS — compact DSL

sv_output:
  tag: SV_OUTPUT_SCHEMA
  see: "@SV_FORMAT"

clean_next_state:
  tag: CLEAN_NEXT_STATE
  done: [{item: str, mark: EpistemicStatus}]
  pending: [str]
  blocked: [{item: str, kind: real|fake, reason: str}]
  terminal: bool
  terminal_mode: enum[SUCCESS, BLOCKED, OUT_OF_SCOPE, CONTINUE, RESUME]
  next: DERIVED from Blocked[0] else Pending[0] else 'none'

blocker:
  tag: BLOCKER
  kind: real|fake
  real: capability/dependency/knowledge gap
  fake: unfinished prior task — finish, do not halt

task_statuses:
  tag: TASK_STATUSES
  enum: [pending, in_progress, materialized, blocked, done, out_of_scope]
  transitions: {pending:[in_progress,out_of_scope], in_progress:[materialized,blocked,pending], materialized:[done,blocked,pending], blocked:[pending]}

ACTION_CLASS: {activity: enum[CONVERSATION,OBSERVE,EXECUTE_TEST,MODIFY_CANDIDATE,MODIFY_PROJECT,PROMOTE_STABLE,SELF_MODIFY], effect: enum[NO_WRITE,DECLARED_TEMP_WRITE,CANDIDATE_WRITE,PERSISTENT_WRITE], risk: enum[LOW,ELEVATED,DESTRUCTIVE,CRITICAL]}

EXECUTION_ENVELOPE: {id: uuid, scope: [glob], budget: {created: int, modified: int, deleted: int}, expires_at: ISO8601, hmac: str, auth: @G4}

MASTER_PLAN_SCHEMA: {goal: str, premises: [claim_id], tasks: [{id: T_num, what: str, oracle: @STAMPS, status: enum['[ ]','[x]']}], ledger: @CLAIM_LEDGER}

CLAIM_LEDGER: {claims: [{id: C_num, text: str, status: enum[Unknown,Guess,Hypothetical,Inferred,Exact], deps: [C_num], evidence: str}], premises: [C_num]}

STAMPS: {oracle_stamp: {claim: C_num, scope_hash: sha256, attestation: hmac, result: PASS -> Exact}, inference_stamp: {claim: C_num, deps: [C_num], result: VALID -> Inferred}}

SMOKE_CONTRACT: {smoke_na: bool|str, baseline: [{label: str, cmd: str, expected_exit: int}], post_checks: [{cmd: str}], blast_radius: str}

CLEAN_NEXT_STATE: {done: [{item: str, mark: EpistemicStatus}], pending: [str], blocked: [{item: str, reason: str}], terminal: bool, next: str}

SIGNAL_CLUSTER: {source: str, pattern: str, n: int, delta: float, disposition: enum[COLLAPSED_DUPLICATES,CONFIRMATION,DIVERGENCE]}

BUG_FIX_SCHEMA: {symptom: str, error_test: {cmd: str, expect: FAIL}, real_fix: {change: str, oracle: PASS}, status: enum[open,fixed]}

FRACTAL_GEOMETRY: {model: enum[Sierpinski,QuadOct,LSystem], tau: float, k: int, depth: int, metric: Manhattan_L1}

MSG_TAG: {md5_msg_tag: 8-32 hex, serialization: canonical}

EXPLORER_GOAL: {question: str, scope: {paths: [str], symbols: [str]}, return: [file_paths, line_numbers, signatures]}
'''

c = c[:old_start] + compact_schemas
with open(path, 'w') as f: f.write(c)
print('Updated core_schemas.yaml schemas')

# === 2. Update 24_specs_policies.py ===
path = os.path.join(PROJECT, 'prompts_kernel', '24_specs_policies.py')
with open(path) as f: c = f.read()

# Replace policy specs with compact versions
compact_policies = '''"""Kernel fragment: 24_specs_policies — compact policy specifications."""

ADID_FRAMEWORK_RULES = _spec(
    state={"kind": "policy"},
    intent="Framework integrity: ADID receivers frozen, host-agnostic SPECS.",
    scope="framework_integrity",
    constraints={"adid_receivers_frozen": True, "specs_host_agnostic": True, "grounding_required": True},
    invariants=["@ADID_FREEZE", "@ADID_OPS"],
    forbidden_actions=["hand_editing_receivers"],
    acceptance_tests=[],
)

ADID_OPS = _spec(
    state={"kind": "policy"},
    intent="Tool hygiene: product tools over shell, no external CLI in SPECS.",
    scope="tool_hygiene",
    constraints={"prefer_product_tools": True, "no_external_cli_in_specs": True},
    invariants=["codegraph before grep/glob for structure", "messagesearch → session-read for conversation", "universalsearch web+code before agent for prior art", "aicall only on attached files; output Inferred until verified"],
    forbidden_actions=[],
    acceptance_tests=[],
)

AGENT_DIRECTIVES = _spec(
    state={"kind": "policy"},
    intent="Coding agent directives: State → SV → Plan → Implement → Verify → Clean.",
    scope="agent_directives",
    constraints={"state_before_reasoning": True, "reuse_before_invent": True, "smoke_before_implementation": True, "plan_before_code": True, "oracle_decides_correctness": True, "minimize_tokens": True, "no_url_guessing": True},
    invariants=["Output: State → SV → Plan (with Smoke) → Implement → Verify → Clean state", "Tag claims: @INFOMARK_SEP"],
    forbidden_actions=["Making code edits before plan approval", "Adding preamble, postamble, or code explanation unless asked", "Generating or guessing URLs", "Claiming fixed without oracle evidence", "Never commit unless user explicitly asks"],
    acceptance_tests=[],
)

GOVERNANCE = _spec(
    state={"kind": "policy"},
    intent="Security governance: inspection≠repair, triple separation, explicit @G4 for persistent write.",
    scope="security",
    constraints={"inspection_is_not_repair": True, "triple_separation": True, "enforce_action_class": True, "protected_surfaces": True, "explicit_g4_for_persistent_write": True},
    invariants=["Inspection does not authorize repair (@G4)", "Executor ≠ Oracle ≠ Analyst (@G8)", "@G4 explicit approval for persistent write"],
    forbidden_actions=["Shell for file ops when product tools exist", "Embedding external CLI cookbooks into SPECS"],
    acceptance_tests=[],
)

GROUNDING_RULES = _spec(
    state={"kind": "policy"},
    intent="Evidence grounding: intent-based routing per @G1.search_intent.",
    scope="evidence",
    constraints={},
    invariants=["@GROUND"],
    forbidden_actions=["Applying single linear tool order without intent routing", "Claiming 'not found' without checking intent-appropriate tool", "Internal knowledge alone insufficient for Inferred confidence"],
    acceptance_tests=[],
)

PLANNING = _spec(
    state={"kind": "policy"},
    intent="Task geometry: fractal decomposition, Manhattan L1, k-medoids → CENTRAL_TASKS.",
    scope="task_geometry",
    constraints={"fractal_geometry_required": True, "linear_mode_1_forbidden": True},
    invariants=["6-step ADID loop: GOAL_SVM_PREP → SVM_INGESTION → PRE_FLIGHT → EXECUTION → VERIFICATION → STATE_EVAL", "One task in_progress at a time; transition_task atomically with version guard", "@DECOMPOSE", "@PLANS_COMPLETED"],
    forbidden_actions=["Creating second task identity outside authoritative task store"],
    acceptance_tests=[],
)

REASONING_MODE = _spec(
    state={"kind": "policy"},
    intent="Pure reasoning: conversation memory only, no tools, offer build switch.",
    scope="conversation_memory_only",
    constraints={"zero_tools": True, "no_external_access": True, "offer_build_switch_on_stuck": True},
    invariants=["@INFOMARK_SEP"],
    forbidden_actions=["Using any tool", "Accessing database or file system", "Searching message history beyond current window", "Making claims about facts not present in current conversation", "Guessing or inventing information not in current memory"],
    acceptance_tests=["Agent answers from current conversation without invoking any tools", "Agent declines to answer when information is not in current window", "Agent offers reasoning_exit when tools would be needed"],
)
'''

with open(path, 'w') as f: f.write(compact_policies)
print('Updated 24_specs_policies.py')
