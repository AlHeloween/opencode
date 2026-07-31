"""Kernel fragment: 11_state_record (former monofile L959-1025)."""


@dataclass
class StateRecord:
    """§14.2 / §XV Fixed-format execution report."""
    msg_type: str = "execution_record"
    goal: str = ""
    goal_desc: str = ""
    content: str = ""
    information_mark: EpistemicStatus = field(default_factory=lambda: EpistemicStatus("Inferred"))
    contract_id: str = ""
    contract_revision: int = 0
    contract_state: str = ""
    primary_oracle_result: str = ""
    secondary_oracle_result: str = ""
    postconditions: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)
    sv_prev: Optional[SemanticVector] = None
    sv_curr: Optional[SemanticVector] = None
    delta_sv_l1: float = 0.0
    delta_status: str = ""
    rollback_mode: str = "NONE"
    rollback_required: bool = False
    rollback_executed: bool = False
    rollback_artifacts_available: bool = False
    actual_created: int = 0
    actual_modified: int = 0
    actual_deleted: int = 0
    actual_bytes_written: int = 0
    md5_msg_tag: str = ""
    md5_sv_tag: str = ""
    next_action: str = ""

    def to_json(self, indent: int = 2) -> str:
        d: dict[str, Any] = {
            "msg_type": self.msg_type,
            "goal": self.goal,
            "goal_desc": self.goal_desc,
            "content": self.content,
            "information_mark": str(self.information_mark),
            "contract": {"contract_id": self.contract_id, "revision": self.contract_revision, "state": self.contract_state},
            "verification": _omit_none_empty({
                "primary_oracle": self.primary_oracle_result or None,
                "secondary_oracle": self.secondary_oracle_result or None,
                "postconditions": self.postconditions or None,
                "limitations": self.limitations or None,
            }),
            "traceability": {
                "sv_prev": asdict(self.sv_prev) if self.sv_prev else {},
                "sv_curr": asdict(self.sv_curr) if self.sv_curr else {},
                "delta_sv_l1": self.delta_sv_l1,
                "status": self.delta_status,
            },
            "rollback_status": {
                "mode": self.rollback_mode, "required": self.rollback_required,
                "executed": self.rollback_executed, "artifacts_available": self.rollback_artifacts_available,
            },
            "effects": {
                "created": self.actual_created, "modified": self.actual_modified,
                "deleted": self.actual_deleted, "bytes_written": self.actual_bytes_written,
            },
            "md5_msg_tag": self.md5_msg_tag,
            "md5_sv_tag": self.md5_sv_tag,
            "next": self.next_action,
        }
        return json.dumps(d, indent=indent, ensure_ascii=False)


