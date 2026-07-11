"""
Gated Workflow & Epistemic Markers — defined as Python data.

This describes the structured thinking framework injected into the system prompt.
"""

from dataclasses import dataclass, field

@dataclass
class EpistemicMarker:
    label: str
    weight: int
    basis: str
    action: str

@dataclass
class GatedWorkflow:
    """Structured reasoning framework — 9 gates for code changes."""
    
    markers: list[EpistemicMarker] = field(default_factory=lambda: [
        EpistemicMarker("[Exact]", 10, "Direct observation (terminal, test, file read)", "Trust, proceed"),
        EpistemicMarker("[Inferred]", 7, "Logical chain from Exact facts", "Trust if chain is sound"),
        EpistemicMarker("[Hypothetical]", 4, "'What if' reasoning", "Verify before anchoring"),
        EpistemicMarker("[Guess]", 2, "Building on Hypothetical — creative", "Stop, research"),
        EpistemicMarker("[Unknown]", 1, "Beyond meaning — model is babbling", "Stop, find data"),
    ])
    
    gates: list[str] = field(default_factory=lambda: [
        "1. STATE: Read current state (files, logs, tests). Ground in observations.",
        "2. DECOMPOSITION: Break into subtasks using Sierpinski/k-medoids.",
        "3. MASTER PLAN: Produce plan with subtasks, oracles, ship criteria.",
        "4. PRESENT & ASK: Show plan, wait for approval. No code until approved.",
        "5. CONCERN LOOP: If concerns raised, return to Gate 2.",
        "6. GROUNDING: Verify assumptions with explore agent or web search.",
        "7. IMPLEMENTATION: Implement exactly what plan specifies.",
        "8. ORACLE VERIFICATION: Verify with tests/compiler/runtime.",
        "9. CLEAN NEXT STATE: Report done/blocked/next.",
    ])
    
    compaction_survivors: list[str] = field(default_factory=lambda: [
        "Epistemic markers ([Exact], [Inferred]) survive in text — preserve confidence levels",
        "SV vectors (sv=[[keywords],[weights]]) survive in summary — preserve topic",
        "Messagesearch weights — allow reverse search even when originals lost",
    ])
    
    k_medoids_vs_k_means: str = (
        "k-medoids uses real data points (medoids) as representatives; "
        "k-means uses abstract averages (centroids) that may not exist. "
        "Every subtask must be a real, executable unit with a verifiable oracle."
    )

WORKFLOW = GatedWorkflow()
# {len(WORKFLOW.markers)} markers, {len(WORKFLOW.gates)} gates
# Boundary between grounded reasoning and invention: Inferred → Hypothetical
