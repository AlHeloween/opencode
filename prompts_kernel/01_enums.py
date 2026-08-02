"""Kernel fragment: 01_enums (former monofile L47-177)."""


class Activity(str, Enum):
    """§3.1 Activity class — every operation is exactly one activity."""
    CONVERSATION = "CONVERSATION"
    OBSERVE = "OBSERVE"
    EXECUTE_TEST = "EXECUTE_TEST"
    MODIFY = "MODIFY"


class Effect(str, Enum):
    """§3.2 Effect class — classifies write impact."""
    NO_WRITE = "NO_WRITE"
    DECLARED_TEMP_WRITE = "DECLARED_TEMP_WRITE"
    PERSISTENT_WRITE = "PERSISTENT_WRITE"


class Risk(str, Enum):
    """§3.3 Risk level — bounded, verifiable danger classification."""
    LOW = "LOW"
    ELEVATED = "ELEVATED"
    DESTRUCTIVE = "DESTRUCTIVE"


class Reversibility(str, Enum):
    """§3.4 Reversibility — ability to restore exact pre-state."""
    REVERSIBLE = "REVERSIBLE"
    COMPENSATABLE = "COMPENSATABLE"
    IRREVERSIBLE = "IRREVERSIBLE"


class DataSensitivity(str, Enum):
    """§3.5 Data sensitivity — independent from write risk."""
    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"
    CONFIDENTIAL = "CONFIDENTIAL"
    SECRET = "SECRET"
    RESTRICTED = "RESTRICTED"




class ContractState(str, Enum):
    """§4.2 Contract lifecycle states — monotonic forward progression."""
    DRAFT = "DRAFT"
    FROZEN = "FROZEN"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    STALE = "STALE"
    EXECUTING = "EXECUTING"
    VERIFYING = "VERIFYING"
    COMPLETED = "COMPLETED"
    BLOCKED = "BLOCKED"
    PARTIAL = "PARTIAL"
    ROLLED_BACK = "ROLLED_BACK"


class DeltaClass(str, Enum):
    """§15.2 Semantic vector delta classification."""
    STABLE = "STABLE"
    SHIFT = "SHIFT"
    DIVERGENCE = "DIVERGENCE"


class ApprovalStatus(str, Enum):
    """§9 Approval lifecycle."""
    NOT_REQUIRED = "NOT_REQUIRED"
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    STALE = "STALE"


class ExecutionMode(str, Enum):
    """§XIII Execution mode switching."""
    SEQUENTIAL_APPROVE = "SEQUENTIAL_APPROVE"
    BATCH_EXECUTE = "BATCH_EXECUTE"


class Role(str, Enum):
    """§XII Role definitions for Human↔Agent collaboration.

    Human roles: HUMAN_STRATEGIST (goals), HUMAN_APPROVER (approval), HUMAN_ORACLE (pass/fail)
    Agent roles: AGENT_SYNTHESIZER (contracts), AGENT_EXECUTOR (execution), AGENT_ORACLE (verification), AGENT_ANALYST (classification)
    """
    HUMAN_STRATEGIST = "HumanStrategist"
    HUMAN_APPROVER = "HumanApprover"
    HUMAN_ORACLE = "HumanOracle"
    AGENT_SYNTHESIZER = "AgentSynthesizer"
    AGENT_EXECUTOR = "AgentExecutor"
    AGENT_ORACLE = "AgentOracle"
    AGENT_ANALYST = "AgentAnalyst"

    @property
    def is_human(self) -> bool:
        return self in (Role.HUMAN_STRATEGIST, Role.HUMAN_APPROVER, Role.HUMAN_ORACLE)

    @property
    def is_agent(self) -> bool:
        return not self.is_human

    def responsibility(self) -> str:
        return _ROLE_RESPONSIBILITIES[self]


_ROLE_RESPONSIBILITIES: dict[Role, str] = {
    Role.HUMAN_STRATEGIST: "Defines high-level goals and approval policy",
    Role.HUMAN_APPROVER: "Reviews and approves ExecutionContracts",
    Role.HUMAN_ORACLE: "Provides pass/fail output from executed operations",
    Role.AGENT_SYNTHESIZER: "Translates goals into ExecutionContracts",
    Role.AGENT_EXECUTOR: "Validates and executes approved contracts",
    Role.AGENT_ORACLE: "Runs primary and secondary verification, reports results",
    Role.AGENT_ANALYST: "Classifies completion state (COMPLETED/PARTIAL/BLOCKED/ROLLED_BACK)",
}


