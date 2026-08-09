"""Kernel fragment: @GATE_1_GROUND grounding reference — full routing in reasoning_prompt.mdc <gates>."""
GROUNDING_RULES = _spec(
    intent="Evidence grounding and intent-based tool routing. See: @GATE_1_GROUND for complete search_intent routing table.",
    scope="all agent operations — grounding before judgment",
    constraints={
        "see": "@GATE_1_GROUND.search_intent",
        "see_also": "@SEARCH_ORDER, @EVIDENCE_ORDER, @REUSE_BEFORE, @WHERE_WHICH, @NO_HARDCODE",
    },
    invariants=[
        "Before claiming 'not found', check intent-appropriate tool per @GATE_1_GROUND.search_intent",
        "Internal knowledge alone insufficient for Inferred confidence",
    ],
    forbidden_actions=[
        "Applying single linear tool order without intent routing",
        "Claiming 'not found' without checking intent-appropriate tool",
    ],
    acceptance_tests=[
        "Agent routes by intent per @GATE_1_GROUND.search_intent",
    ],
    state={"source": "@GATE_1_GROUND in reasoning_prompt.mdc gates"},
)
