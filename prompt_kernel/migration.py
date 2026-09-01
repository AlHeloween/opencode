from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType

from .model import Kernel


@dataclass(frozen=True, slots=True)
class MigrationDecision:
    disposition: str
    targets: tuple[str, ...]
    boundary: str
    rationale: str


def _keep(target: str, rationale: str = "Preserved as one canonical rule.") -> MigrationDecision:
    return MigrationDecision("preserved", (target,), "kernel", rationale)


def _merge(*targets: str, rationale: str) -> MigrationDecision:
    return MigrationDecision("merged", targets, "kernel", rationale)


def _delegate(boundary: str, rationale: str) -> MigrationDecision:
    return MigrationDecision("delegated", (), boundary, rationale)


LEGACY_RULE_MIGRATION = MappingProxyType({
    "EVIDENCE_ORDER": _keep("EVIDENCE_ORDER"),
    "SEARCH_ORDER": _merge("CAPABILITY_GRAPH_RULE", "GROUND_PLAN_RULE", rationale="Intent routing and bounded plan grounding replace a universal linear search order."),
    "WHERE_WHICH": _delegate("host tool policy", "Executable lookup syntax is host-specific, not universal reasoning."),
    "REUSE_BEFORE": _keep("REUSE_BEFORE"),
    "GROUND": _merge("INTENT_PROJECTION_RULE", "PROJECT_GEOMETRY_RULE", rationale="Grounding is split into intent projection and project evidence geometry."),
    "NO_HARDCODE": _delegate("project governance", "Configuration discovery depends on the active project and runtime."),
    "VCS_ROOT": _delegate("host tool policy", "VCS traversal restrictions belong to the host's tool constitution."),
    "READ_ENTIRE_FILE": _delegate("host tool policy", "File-read mechanics and limits belong to product tools."),
    "MEMORY_RANK": _keep("MEMORY_RANK"),
    "MEMORY_LINKS": _merge("MEMORY_RANK", rationale="Exact-handle recovery is part of memory evidence ranking."),
    "DECOMPOSE": _keep("DECOMPOSE"),
    "FRACTAL_CANDIDATES": _keep("FRACTAL_CANDIDATES"),
    "GOAL_SEEDS": _merge("FRACTAL_CANDIDATES", rationale="Seed generation is an internal step of fractal candidate generation."),
    "GOAL_PEAKS": _merge("MANHATTAN_L1", rationale="Peak selection is represented by medoid selection under the declared metric."),
    "SV_DELTA": _merge("SV_TRAJECTORY", rationale="Attention delta is defined once inside the semantic trajectory rule."),
    "SMOKE_BEFORE": _keep("SMOKE_BEFORE"),
    "SMOKE_SPEC": _merge("SMOKE_BEFORE", rationale="The baseline rule now includes naming the post-change oracle."),
    "SMOKE_VALIDATE": _merge("SMOKE_VERIFY", rationale="Smoke validation is the G8 verification rule."),
    "INFOMARK_SEP": _merge("INFORMATION_STATUS", rationale="Status separation is part of the canonical information-status rule."),
    "NAMING": _merge("MASTER_PLAN_RULE", rationale="Plan naming belongs to the master-plan state contract."),
    "PLAN_LIFECYCLE": _merge("MASTER_PLAN_RULE", rationale="Lifecycle is a master-plan field rather than a free-standing global rule."),
    "PLAN_REVISION": _merge("MASTER_PLAN_RULE", rationale="Revision is a master-plan field and reauthorization trigger."),
    "WRITE_SCOPE": _keep("WRITE_SCOPE"),
    "DOCUMENT_SURFACE": _merge("DEPENDENCY_BINDING", rationale="Documentation consumers are part of the concrete dependency surface."),
    "CODE_STANDARDS": _delegate("project governance", "Language and repository style rules are host/project-specific packs."),
    "CACHE_STABILITY": _merge("KV_CACHE_STABILITY", rationale="Prefix stability is one shared rule; G7 does not restate it."),
    "CONSTITUTION_BLOCKS": _delegate("runtime ACL", "Hard tool blocks must be enforced by runtime policy, not repeated as prompt prose."),
    "ADID_OPS": _delegate("ADID skill and runtime tools", "Tool manuals and framework receivers are capability-specific packs."),
    "NO_SCRIPT_EDITING": _delegate("runtime tool policy", "Editing mechanism restrictions depend on available product tools."),
    "WORKSPACE_LANES": _delegate("project governance", "Workspace topology and lane ownership are project-specific."),
    "ADID_FREEZE": _delegate("ADID framework governance", "Generated receiver ownership belongs to the ADID pipeline."),
    "FRAMEWORK_INHERITANCE": _delegate("project governance", "Framework inheritance rules are not universal kernel semantics."),
    "PLAN_CONTRACT": _merge("PLAN_CONTRACT_ENFORCEMENT", rationale="State schema and enforcement rule have distinct, unambiguous names."),
    "PLAN_BINDING": _merge("PLAN_BINDING_ENFORCEMENT", rationale="State schema and enforcement rule have distinct, unambiguous names."),
    "VERIFY_OUTCOME": _merge("ORACLE", rationale="Outcome verification is the oracle's gate-local responsibility."),
    "SMOKE_VERIFY": _keep("SMOKE_VERIFY"),
    "OBSOLETE_CLEANUP": _merge("CHANGE_SCOPE", "CLOSURE_PROOF_RULE", rationale="Removal stays inside authorized scope and is verified at closure."),
    "CLEAN_STATE": _merge("CLEAN_STATE_RULE", rationale="Clean-state output is owned by G9."),
    "SV_OUTPUT": _merge("CURRENT_SV", rationale="The end-of-turn write is the current semantic vector, not the format."),
    "SV_EVERY_TURN": _merge("CURRENT_SV", rationale="Same current-vector obligation."),
    "RESIDUAL_LOOP": _merge("RESIDUAL_ROUTING", "RESIDUAL_GOAL_RULE", rationale="Residual semantics are split into global routing and G9 materialization."),
    "EMIT_STATE": _merge("CLEAN_STATE_RULE", rationale="State emission is part of the G9 clean-state contract."),
    "PLANS_COMPLETED": _merge("MASTER_PLAN_RULE", "CLOSURE_PROOF_RULE", rationale="Plan lifecycle is reconciled only when closure evidence passes."),
    "CLOSURE_PROOF": _merge("CLOSURE_PROOF_RULE", rationale="State schema and proof rule have distinct names."),
    "METRIC_ADAPTATION": _merge("SV_TRAJECTORY", "QUALITY_VECTOR_RULE", rationale="Metric adaptation is local to attention and evolution measurements."),
    "PROGRESS_LOG": _merge("CLEAN_STATE_RULE", rationale="Progress is emitted as concise verified state, not a second protocol."),
    "TONE_AND_STYLE": _delegate("style layer", "Tone is a lower-precedence identity or host concern, not execution control."),
})

# Closed snapshot of the retired package's RUNTIME_RULES keys. Do not import prompts_kernel.
LEGACY_RUNTIME_RULES = (
    "ADID_FREEZE",
    "ADID_OPS",
    "CACHE_STABILITY",
    "CLEAN_STATE",
    "CLOSURE_PROOF",
    "CODE_STANDARDS",
    "CONSTITUTION_BLOCKS",
    "DECOMPOSE",
    "DOCUMENT_SURFACE",
    "EMIT_STATE",
    "EVIDENCE_ORDER",
    "FRACTAL_CANDIDATES",
    "FRAMEWORK_INHERITANCE",
    "GOAL_PEAKS",
    "GOAL_SEEDS",
    "GROUND",
    "INFOMARK_SEP",
    "MEMORY_LINKS",
    "MEMORY_RANK",
    "METRIC_ADAPTATION",
    "NAMING",
    "NO_HARDCODE",
    "NO_SCRIPT_EDITING",
    "OBSOLETE_CLEANUP",
    "PLAN_BINDING",
    "PLAN_CONTRACT",
    "PLAN_LIFECYCLE",
    "PLAN_REVISION",
    "PLANS_COMPLETED",
    "PROGRESS_LOG",
    "READ_ENTIRE_FILE",
    "RESIDUAL_LOOP",
    "REUSE_BEFORE",
    "SEARCH_ORDER",
    "SMOKE_BEFORE",
    "SMOKE_SPEC",
    "SMOKE_VALIDATE",
    "SMOKE_VERIFY",
    "SV_DELTA",
    "SV_EVERY_TURN",
    "SV_OUTPUT",
    "TONE_AND_STYLE",
    "VCS_ROOT",
    "VERIFY_OUTCOME",
    "WHERE_WHICH",
    "WORKSPACE_LANES",
    "WRITE_SCOPE",
)


def kernel_symbols(kernel: Kernel) -> set[str]:
    symbols = set(kernel.terms) | set(kernel.state_fields) | set(kernel.action_classes)
    symbols.update(gate.id for gate in kernel.gates)
    symbols.update(gate.anchor for gate in kernel.gates)
    symbols.update(rule.id for rule in kernel.shared_rules)
    symbols.update(rule.id for gate in kernel.gates for rule in gate.local_rules)
    symbols.update(protocol.id for protocol in kernel.protocols)
    symbols.update(rule.id for protocol in kernel.protocols for rule in protocol.local_rules)
    symbols.update(identity.id for identity in kernel.identities)
    symbols.update(kernel.terminals)
    symbols.add(kernel.sv_contract.tag)
    symbols.add(kernel.source_routing.tag)
    symbols.add(kernel.source_routing.alias)
    return symbols


def validate_migration(legacy_rule_ids: tuple[str, ...], kernel: Kernel) -> list[str]:
    errors = []
    expected = set(legacy_rule_ids)
    actual = set(LEGACY_RULE_MIGRATION)
    for missing in sorted(expected - actual):
        errors.append(f"legacy rule has no migration decision: {missing}")
    for unknown in sorted(actual - expected):
        errors.append(f"migration decision has no legacy rule: {unknown}")
    symbols = kernel_symbols(kernel)
    for legacy, decision in LEGACY_RULE_MIGRATION.items():
        if decision.disposition not in {"preserved", "merged", "delegated", "retired"}:
            errors.append(f"{legacy}: invalid disposition {decision.disposition}")
        if decision.disposition in {"preserved", "merged"}:
            for target in decision.targets:
                if target not in symbols:
                    errors.append(f"{legacy}: target does not resolve in kernel: {target}")
        if decision.disposition == "delegated" and not decision.boundary:
            errors.append(f"{legacy}: delegated rule has no owning boundary")
        if not decision.rationale:
            errors.append(f"{legacy}: migration decision has no rationale")
    return errors
