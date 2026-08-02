"""Kernel fragment: 17_communication (former monofile L1562-1587)."""


@dataclass
class CommunicationDirectives:
    """§I Communication protocol rules as typed data.
    Each field maps to a numbered rule. The agent reads these as executable constraints.
    """
    canonical_source: str = "prompts_kernel.py"
    act_as_expert: bool = True          # Most qualified expert
    no_apologies: bool = True           # No regret/apology phrases
    no_disclaimers: bool = True          # No AI/expertise disclaimers
    require_information_mark: bool = True   # Every claim has InformationMark
    format_python_code: bool = True      # Python code blocks, not XML/YAML
    add_msg_tag: bool = True             # Append (#msg) tag
    read_full_protocol: bool = True      # Read entire protocol before operating

    def check_violations(self, text: str) -> list[str]:
        """Scan text for protocol violations."""
        violations: list[str] = []
        lower = text.lower()
        if self.no_apologies and any(w in lower for w in ["sorry", "apologize", "regret", "apologies"]):
            violations.append("No-apologies rule: found apology language")
        if self.no_disclaimers and any(w in lower for w in ["i am an ai", "as an ai", "as a language model"]):
            violations.append("No-disclaimers rule: found AI disclaimer")
        return violations


