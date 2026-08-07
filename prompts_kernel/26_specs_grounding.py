"""Kernel fragment: G1 grounding reference — full routing in reasoning.txt <gates>."""
GROUNDING_RULES = _spec(
    intent="Evidence grounding and intent-based tool routing. See: @G1 for complete search_intent routing table.",
    scope="all agent operations — grounding before judgment",
    constraints={
        "see": "G1.search_intent",
        "see_also": "SEARCH_ORDER, EVIDENCE_ORDER, REUSE_BEFORE, WHERE_WHICH, NO_HARDCODE",
    },
    invariants=[
        "Before claiming 'not found', check intent-appropriate tool per G1.search_intent",
        "Internal knowledge alone insufficient for Inferred confidence",
    ],
    forbidden_actions=[
        "Applying single linear tool order without intent routing",
        "Claiming 'not found' without checking intent-appropriate tool",
    ],
    acceptance_tests=[
        "Agent routes by intent per G1.search_intent",
    ],
    state={"source": "G1 in reasoning.txt gates"},
)
