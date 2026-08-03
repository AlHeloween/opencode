"""Kernel fragment: 06_contracts (former monofile L476-732)."""


@dataclass
class Budget:
    """§7.2 Concrete numeric budgets for change accounting."""
    maximum_created: int = 0
    maximum_modified: int = 0
    maximum_deleted: int = 0
    maximum_bytes_written: int = 0
    maximum_database_rows: int = 0
    maximum_network_requests: int = 0
    maximum_external_messages: int = 0
    maximum_package_changes: int = 0
    maximum_ref_changes: int = 0
    maximum_child_processes: int = 0


@dataclass
class ResourceIdentity:
    """§6.1 Stable identity binding (path ≠ identity)."""
    device: Optional[str] = None
    inode: Optional[int] = None
    file_id: Optional[str] = None
    content_hash: Optional[str] = None
    size: Optional[int] = None
    link_count: Optional[int] = None
    etag: Optional[str] = None
    version: Optional[str] = None


@dataclass
class Resource:
    """§5.1 Typed, individually scoped resource with identity binding."""
    id: str = ""
    kind: str = "file"
    requested_locator: str = ""
    canonical_locator: str = ""
    boundary: str = ""
    existence_precondition: str = "may_exist"
    identity: ResourceIdentity = field(default_factory=ResourceIdentity)
    parent_identity: ResourceIdentity = field(default_factory=ResourceIdentity)
    binding_preconditions: dict[str, Any] = field(default_factory=dict)
    descendant_policy: str = "none"
    allowed_descendants: list[str] = field(default_factory=list)
    wildcard_policy: str = "reject"
    expanded_matches: list[str] = field(default_factory=list)
    link_policy: str = "reject"
    mount_policy: str = "remain_on_mount"
    case_policy: str = "platform_default"
    allowed_operations: list[str] = field(default_factory=list)
    read_scope: str = "content"
    data_egress_policy: str = "none"


@dataclass
class AllowedEffect:
    """§5.2 Each intended effect declared separately."""
    resource_id: str = ""
    operation: str = "read"
    maximum_objects: int = 1
    maximum_bytes_written: int = 0
    atomic_group: Optional[str] = None
    idempotency_key: Optional[str] = None
    expected_after_state: dict[str, Any] = field(default_factory=dict)


@dataclass
class Classification:
    """§3 Five-axis activity classification.

    v6: SELF_MODIFY activity separated from MODIFY — different permission
    boundary. See ExecutionEnvelope for scope/budget pre-approval.
    """
    activity: Activity = Activity.CONVERSATION
    effect: Effect = Effect.NO_WRITE
    risk: Risk = Risk.LOW
    reversibility: Reversibility = Reversibility.REVERSIBLE
    data_sensitivity: DataSensitivity = DataSensitivity.INTERNAL
    information_mark: Optional[EpistemicStatus] = None


@dataclass
class ExecutionEnvelope:
    """§9.1 Execution Envelope — pre-approved scope+budget boundary.

    v6: Replaces per-MODIFY approval for MODIFY_CANDIDATE operations.
    The user approves the envelope ONCE. Within the envelope, the agent
    can freely experiment (create branches, modify candidates, run tests).
    Approval is only needed again when:
      - Expanding scope beyond envelope boundaries
      - Promoting a candidate to stable (PROMOTE_STABLE)
      - Any SELF_MODIFY activity (separate permission boundary)

    This resolves the Gate 4 vs action_class contradiction:
      Gate 4: approval for any MODIFY
      action_class: approval only for ELEVATED/DESTRUCTIVE MODIFY

    With envelopes: all MODIFY within envelope = pre-approved.
    MODIFY outside envelope → re-approval. PROMOTE_STABLE → explicit approval.
    """
    envelope_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    scope_paths: list[str] = field(default_factory=list)    # allowed file paths
    budget: Budget = field(default_factory=Budget)           # change budget ceiling
    wall_time_seconds: int = 1800                            # max experiment duration
    attempts_max: int = 4                                     # max modify attempts
    allowed_activities: list[str] = field(default_factory=lambda: [
        "create_candidate_branch", "modify_candidate",
        "run_tests", "benchmark",
    ])
    forbidden_activities: list[str] = field(default_factory=lambda: [
        "modify_oracles", "modify_governance", "promote_to_stable",
    ])
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    consumed: bool = False

    def contains(self, resource_path: str) -> bool:
        """Check if a resource path is within this envelope's scope."""
        if not self.scope_paths:
            return True  # empty scope = allow all (dangerous — should be explicit)
        import os
        normalized = os.path.normpath(resource_path)
        for scope in self.scope_paths:
            norm_scope = os.path.normpath(scope)
            if normalized == norm_scope or normalized.startswith(norm_scope + os.sep):
                return True
        return False

    def within_budget(self, current_usage: Budget) -> bool:
        """Check if current usage is within envelope budget."""
        return (
            current_usage.maximum_created <= self.budget.maximum_created
            and current_usage.maximum_modified <= self.budget.maximum_modified
            and current_usage.maximum_deleted <= self.budget.maximum_deleted
        )

    def is_valid(self) -> bool:
        return not self.consumed


@dataclass
class Environment:
    """§5 Execution environment constraints."""
    platform: Optional[str] = None
    shell: Optional[str] = None
    canonical_working_directory: Optional[str] = None
    required_privilege: str = "none"
    network_policy: str = "deny"
    approved_destinations: list[str] = field(default_factory=list)
    sanitized_environment: bool = True
    timeout_seconds: int = 600
    maximum_output_bytes: int = 10_000_000


@dataclass
class Execution:
    """§5 Execution method specification."""
    method: str = "none"
    tool: Optional[str] = None
    tool_version: Optional[str] = None
    operation: Optional[str] = None
    argv: list[str] = field(default_factory=list)
    atomic_groups: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class RollbackArtifact:
    """§12 Pre-state capture for rollback."""
    resource_id: str = ""
    before_content_hash: Optional[str] = None
    before_bytes: Optional[str] = None
    before_metadata: dict[str, Any] = field(default_factory=dict)
    identity: ResourceIdentity = field(default_factory=ResourceIdentity)


@dataclass
class RollbackPlan:
    """§12 Rollback specification."""
    mode: str = "NONE"
    artifacts: list[Any] = field(default_factory=list)
    trigger_conditions: list[str] = field(default_factory=list)
    operations: list[str] = field(default_factory=list)
    concurrency_guard: str = ""
    verification: list[str] = field(default_factory=list)


@dataclass
class VerificationPlan:
    """§13 Verification specification with primary + secondary oracles."""
    monitored_domains: list[str] = field(default_factory=list)
    observation_window: str = ""
    primary_oracle: str = ""
    secondary_oracle: str = ""
    postconditions: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)


@dataclass
class ApprovalState:
    """§9 Approval binding with SHA-256 triple digest."""
    required: bool = False
    status: ApprovalStatus = ApprovalStatus.NOT_REQUIRED
    contract_digest: str = ""
    precondition_digest: str = ""
    approval_binding: str = ""
    approval_context_id: str = ""
    approved_by_user_turn: Optional[str] = None
    approved_at: Optional[str] = None
    expires_at: Optional[str] = None


def _omit_none_empty(d: dict[str, Any]) -> dict[str, Any]:
    """Filter None/empty from dict for serialization."""
    return {k: v for k, v in d.items() if v is not None and v != "" and v != [] and v != {}}


def _dict(obj: Any) -> dict[str, Any]:
    """Convert dataclass to dict, omitting None/empty/zero."""
    return {k: v for k, v in asdict(obj).items() if v is not None and v != "" and v != [] and v != 0}


@dataclass
class DiscoveryContract:
    """§4.1 OBSERVE-only contract — zero write budgets, narrow read boundary."""
    schema_version: str = "3"
    contract_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    revision: int = 1
    phase: str = "discovery"
    state: str = "ACTIVE"
    goal_requested_text: str = ""
    goal_objective: str = ""
    goal_exclusions: list[str] = field(default_factory=list)
    classification: Classification = field(default_factory=Classification)
    environment: Environment = field(default_factory=Environment)
    read_boundaries: list[str] = field(default_factory=list)
    resources: list[Resource] = field(default_factory=list)
    allowed_operations: list[str] = field(default_factory=lambda: ["read", "list", "stat"])
    forbidden_effects: list[str] = field(default_factory=lambda: [
        "persistent_write", "privilege_elevation", "undeclared_network_egress",
    ])
    change_budget: Budget = field(default_factory=Budget)
    uncertainties: list[str] = field(default_factory=list)
    verification_oracles: list[str] = field(default_factory=list)
    information_mark: Optional[EpistemicStatus] = None
    semantic_vector: Optional[SemanticVector] = None

    def to_json(self, indent: int = 2) -> str:
        d: dict[str, Any] = {
            "schema_version": self.schema_version,
            "contract_id": self.contract_id,
            "revision": self.revision,
            "phase": self.phase,
            "state": self.state,
            "goal": _omit_none_empty({
                "requested_text": self.goal_requested_text,
                "objective": self.goal_objective,
                "exclusions": self.goal_exclusions or None,
            }),
            "classification": _dict(self.classification),
            "environment": _dict(self.environment),
            "read_boundaries": self.read_boundaries or None,
            "allowed_operations": self.allowed_operations,
            "forbidden_effects": self.forbidden_effects,
            "change_budget": _dict(self.change_budget),
            "uncertainties": self.uncertainties or None,
            "verification": self.verification_oracles or None,
        }
        return json.dumps(_omit_none_empty(d), indent=indent, ensure_ascii=False)


@dataclass
class ExecutionContract:
    """§5 Formal execution contract — frozen revisions are immutable."""
    schema_version: str = "3"
    contract_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    revision: int = 1
    phase: str = "execution"
    state: str = "DRAFT"
    goal_requested_text: str = ""
    goal_objective: str = ""
    goal_exclusions: list[str] = field(default_factory=list)
    completion_criteria: list[str] = field(default_factory=list)
    classification: Classification = field(default_factory=Classification)
    environment: Environment = field(default_factory=Environment)
    resources: list[Resource] = field(default_factory=list)
    execution: Execution = field(default_factory=Execution)
    allowed_effects: list[AllowedEffect] = field(default_factory=list)
    forbidden_effects: list[str] = field(default_factory=list)
    change_budget: Budget = field(default_factory=Budget)
    rollback: RollbackPlan = field(default_factory=RollbackPlan)
    verification: VerificationPlan = field(default_factory=VerificationPlan)
    approval: ApprovalState = field(default_factory=ApprovalState)
    information_mark: Optional[EpistemicStatus] = None
    semantic_vector: Optional[SemanticVector] = None
    md5_msg_tag: str = ""
    md5_sv_tag: str = ""

    def to_json(self, indent: int = 2) -> str:
        goal: dict[str, Any] = {"requested_text": self.goal_requested_text, "objective": self.goal_objective}
        if self.goal_exclusions: goal["exclusions"] = self.goal_exclusions
        if self.completion_criteria: goal["completion_criteria"] = self.completion_criteria
        d: dict[str, Any] = {
            "schema_version": self.schema_version,
            "contract_id": self.contract_id,
            "revision": self.revision,
            "phase": self.phase,
            "state": self.state,
            "goal": goal,
            "classification": _dict(self.classification),
            "resources": [_dict(r) for r in self.resources] if self.resources else None,
            "execution": _dict(self.execution) if self.execution.method != "none" else None,
        }
        if self.allowed_effects: d["allowed_effects"] = [_dict(ae) for ae in self.allowed_effects]
        if self.forbidden_effects: d["forbidden_effects"] = self.forbidden_effects
        if self.change_budget and _dict(self.change_budget): d["change_budget"] = _dict(self.change_budget)
        if self.rollback.mode != "NONE": d["rollback"] = _dict(self.rollback)
        if self.verification.primary_oracle: d["verification"] = _dict(self.verification)
        if self.approval.required: d["approval"] = _dict(self.approval)
        return json.dumps(_omit_none_empty(d), indent=indent, ensure_ascii=False)


