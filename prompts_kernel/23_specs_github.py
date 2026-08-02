"""Kernel fragment: 23_specs_github (former monofile L2236-2260)."""


DUPLICATE_PR = _spec(
    intent="Detect and handle duplicate pull requests.",
    state={}, scope="",
    constraints={}, invariants=[], acceptance_tests=[], forbidden_actions=[],
)

TRIAGE = _spec(
    intent="""Triage GitHub issues by applying labels and assigning owners.
Teams: desktop, zen, tui, core, docs, windows. Pick the most fitting labels and one owner.""",

    state={"teams": {
        "desktop": ["adamdotdevin", "iamdavidhill", "Brendonovich", "nexxeln"],
        "zen": ["fwang", "MrMushrooooom"],
        "tui": ["kommander", "rekram1-node", "simonklee"],
        "core": ["kitlangton", "rekram1-node", "jlongster"],
        "docs": ["R44VC0RP"],
        "windows": ["Hona"],
    }},

    scope="GitHub issue triage",
    constraints={}, invariants=[], acceptance_tests=[], forbidden_actions=[],
)


