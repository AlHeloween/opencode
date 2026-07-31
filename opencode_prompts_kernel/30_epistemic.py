"""Kernel fragment: 30_epistemic (former monofile L3393-4156)."""


@dataclass
class ProjectionPack:
    """Language-aware projection of kernel concepts into a target syntax.

    Each pack is a complete "compilation target" — the AI reads the kernel
    spec and uses this pack to render it in the target language's idioms.
    """
    language: str
    grammar_version: str
    semantic_names: dict = None
    kernel_projection: dict = None
    node_templates: dict = None
    style_profiles: dict = None
    tree_sitter_queries: list = None

    def __post_init__(self):
        if self.semantic_names is None:
            self.semantic_names = {
                "module": "module", "function": "function",
                "type": "type", "error": "error", "test": "test",
            }
        if self.kernel_projection is None:
            self.kernel_projection = {
                "scope": [], "constraints": [], "invariants": [],
                "acceptance_tests": [], "forbidden_actions": [],
            }
        if self.node_templates is None:
            self.node_templates = {
                "function_definition": {}, "class_definition": {},
                "error_handling": {}, "test_definition": {},
            }
        if self.style_profiles is None:
            self.style_profiles = {
                "standard": {}, "framework_specific": {}, "project_specific": {},
            }
        if self.tree_sitter_queries is None:
            self.tree_sitter_queries = []

    def to_json(self, indent: int = 2) -> str:
        return json.dumps({
            "language": self.language,
            "grammar_version": self.grammar_version,
            "semantic_names": self.semantic_names,
            "kernel_projection": {k: v for k, v in (self.kernel_projection or {}).items() if v},
            "style_profiles": {k: v for k, v in (self.style_profiles or {}).items() if v},
            "tree_sitter_queries": self.tree_sitter_queries or [],
        }, indent=indent, ensure_ascii=False)


# Built-in projection packs for key project languages
PROJECTION_PACKS: dict[str, ProjectionPack] = {
    "python": ProjectionPack(
        language="python",
        grammar_version="tree-sitter-python@0.21",
        semantic_names={
            "module": "module (file)",
            "function": "def",
            "type": "class | dataclass",
            "error": "Exception | raise",
            "test": "def test_* | pytest",
        },
        kernel_projection={
            "scope": ['# === SCOPE ===\\nfor k, v in SPEC["scope"].items():\\n    # {k}: {v}'],
            "constraints": ['# === CONSTRAINTS ===\\nfor k, v in SPEC["constraints"].items():\\n    # {k}: {v}  # bool values'],
            "invariants": ['# === INVARIANTS ===\\nfor inv in SPEC["invariants"]:\\n    # invariant: {inv}'],
            "acceptance_tests": ['# === ACCEPTANCE TESTS ===\\nfor t in SPEC["acceptance_tests"]:\\n    # test: {t}'],
            "forbidden_actions": ['# === FORBIDDEN ===\\nfor f in SPEC["forbidden_actions"]:\\n    # DO NOT: {f}'],
        },
        node_templates={
            "function_definition": {"prefix": "def ", "body_indent": 4, "decorator_prefix": "@"},
            "class_definition": {"prefix": "class ", "body_indent": 4, "decorator_prefix": "@"},
            "error_handling": {"try_prefix": "try:", "except_prefix": "except ", "finally_prefix": "finally:"},
            "test_definition": {"prefix": "def test_", "assert_prefix": "assert ", "fixture_prefix": "@pytest.fixture"},
        },
        style_profiles={
            "standard": {"line_length": 88, "quoting": "double", "import_style": "explicit"},
        },
    ),
    "typescript": ProjectionPack(
        language="typescript",
        grammar_version="tree-sitter-typescript@0.22",
        semantic_names={
            "module": "module | file",
            "function": "function | arrow fn",
            "type": "interface | type",
            "error": "Error class | throw",
            "test": "it / describe | vitest",
        },
        kernel_projection={
            "scope": ["// === SCOPE ===", "// {key}: {value}"],
            "constraints": ["// === CONSTRAINTS ===", "// {key}: {value}"],
            "invariants": ["// === INVARIANTS ===", "// invariant: {text}"],
            "acceptance_tests": ["// === ACCEPTANCE TESTS ===", "// test: {text}"],
            "forbidden_actions": ["// === FORBIDDEN ===", "// DO NOT: {text}"],
        },
        node_templates={
            "function_definition": {"prefix": "function ", "arrow_prefix": "const ", "body_indent": 2},
            "class_definition": {"prefix": "class ", "body_indent": 2, "implements_keyword": "implements"},
            "error_handling": {"try_prefix": "try {", "catch_prefix": "catch (", "finally_prefix": "finally {"},
            "test_definition": {"prefix": "it(", "describe_prefix": "describe(", "assert_prefix": "expect("},
        },
        style_profiles={
            "standard": {"line_length": 100, "quoting": "single", "semicolons": True},
        },
    ),
    "markdown": ProjectionPack(
        language="markdown",
        grammar_version="tree-sitter-markdown@0.2",
        semantic_names={
            "module": "section (##)",
            "function": "code block",
            "type": "table | definition list",
            "error": "blockquote | warning",
            "test": "example | checklist",
        },
        kernel_projection={
            "constraints": ["constraints:", "- {text}  # dash-prefixed"],
            "invariants": ["invariants:", "- {text}  # dash-prefixed"],
            "forbidden_actions": ["forbidden_actions:", "- {text}  # dash-prefixed"],
            "acceptance_tests": ["acceptance_tests:", "- {text}  # dash-prefixed"],
        },
        style_profiles={
            "standard": {"heading_levels": "## for sections, ### for subsections", "list_style": "dash"},
        },
    ),
    "yaml": ProjectionPack(
        language="yaml",
        grammar_version="tree-sitter-yaml@0.3",
        semantic_names={
            "module": "top-level key",
            "function": "nested mapping",
            "type": "sequence | mapping",
            "error": "comment | anchor",
            "test": "fixture | example block",
        },
        kernel_projection={
            "constraints": ["constraints:", "- {text}"],
            "invariants": ["invariants:", "- {text}"],
            "forbidden_actions": ["forbidden_actions:", "- {text}"],
            "acceptance_tests": ["acceptance_tests:", "- {text}"],
        },
        style_profiles={
            "standard": {"indentation": 2, "quoting": "double", "line_length": 120},
        },
    ),
}


# ======================================================================
# EPISTEMIC PROJECTION SYSTEM — universal kernel → any discipline
# ======================================================================
#
# Every field of knowledge has an epistemic grammar — what counts as an
# entity, claim, measurement, evidence, causal mechanism, and proof.
# These projections map the universal kernel onto each discipline's
# native reasoning structure, just as ProjectionPack maps kernel fields
# onto programming language syntax.
#
# The hierarchy:
#   Universal Reasoning Kernel
#     → Universal Research Kernel (question_type, ontology, evidence)
#       → Discipline projection (Natural/Social/Formal science)
#         → Sub-discipline projection (Physics, Economics, etc.)
#           → Method projection (Panel data, Spectroscopy, etc.)
#             → Task-specific execution
# ======================================================================

# ------------------------------------------------------------------
# 1. Universal Research Kernel — extends reasoning kernel for research
# ------------------------------------------------------------------

@dataclass
class ResearchKernel:
    """Universal research kernel — adds epistemic fields beyond coding.

    The coding kernel handles: intent, state, scope, constraints, steps,
    invariants, acceptance_tests, forbidden_actions.

    The research kernel additionally handles: question_type, ontology,
    evidence, assumptions, uncertainty, method, falsifiers.
    """
    objective: str = ""
    question_type: str = "descriptive"  # descriptive | comparative | causal | predictive | mechanistic | normative | interpretive
    scope: dict = None
    ontology: dict = None
    assumptions: list = None
    evidence: dict = None
    method: dict = None
    uncertainty: dict = None
    invariants: list = None
    falsifiers: list = None
    acceptance_tests: list = None
    forbidden_actions: list = None

    def __post_init__(self):
        if self.scope is None:
            self.scope = {"population": "", "system": "", "time_range": "", "spatial_range": "", "resolution": ""}
        if self.ontology is None:
            self.ontology = {"entities": [], "variables": [], "relations": [], "definitions": {}}
        if self.assumptions is None:
            self.assumptions = []
        if self.evidence is None:
            self.evidence = {"observations": [], "measurements": [], "sources": [], "evidence_hierarchy": []}
        if self.method is None:
            self.method = {"design": "", "analysis": [], "controls": [], "verification": []}
        if self.uncertainty is None:
            self.uncertainty = {"measurement": {}, "model": {}, "sampling": {}, "unknowns": []}
        if self.invariants is None:
            self.invariants = []
        if self.falsifiers is None:
            self.falsifiers = []
        if self.acceptance_tests is None:
            self.acceptance_tests = []
        if self.forbidden_actions is None:
            self.forbidden_actions = []


# ------------------------------------------------------------------
# 2. Epistemic node types — tree-sitter equivalent for claims
# ------------------------------------------------------------------

@dataclass
class ResearchClaimNode:
    """A claim node in an epistemic parse tree.

    Analogous to a syntax node in tree-sitter: this is the atomic unit
    of reasoning that a discipline projection knows how to validate.

    Renamed from ClaimNode to avoid collision with 02_info_mark.ClaimNode.
    """
    claim_type: str = ""       # definition | observation | measurement | hypothesis | assumption
                               # | causal_claim | mechanistic_claim | comparison | prediction
                               # | normative_claim | citation | counterevidence | uncertainty_statement
    subject: str = ""
    relation: str = ""
    object: str = ""
    population: str = ""
    evidence: str = ""
    identification: str = ""
    uncertainty: str = ""
    source: str = ""


EPISTEMIC_NODE_TYPES: list[str] = [
    "definition", "observation", "measurement", "hypothesis", "assumption",
    "causal_claim", "mechanistic_claim", "comparison", "prediction",
    "normative_claim", "citation", "counterevidence", "uncertainty_statement",
]

QUESTION_TYPES: list[str] = [
    "descriptive", "comparative", "causal", "predictive",
    "mechanistic", "normative", "interpretive",
]

# ------------------------------------------------------------------
# 3. DisciplineProjection dataclass — epistemic grammar per domain
# ------------------------------------------------------------------

@dataclass
class DisciplineProjection:
    """Epistemic projection for a discipline, sub-discipline, or method.

    Each projection defines: what vocabulary activates the discipline's
    reasoning, what invariants are non-negotiable, what counts as evidence,
    what errors are characteristic, and how to verify conclusions.
    """
    name: str
    version: str = "1.0"
    parent: str = ""                            # Parent discipline for inheritance
    native_vocabulary: dict = None              # {entity_names, relation_names, method_names, evidence_names}
    question_types: list = None                 # Which question types are valid
    claim_types: list = None                    # Which claim nodes are valid
    evidence_hierarchy: list = None             # Ordered list of evidence strength
    kernel_projection: dict = None              # Maps kernel fields to discipline-specific guidance
    method_templates: dict = None               # Templates for common methods
    claim_templates: dict = None                # Templates for claim types
    uncertainty_templates: dict = None          # How uncertainty is expressed
    retrieval_terms: list = None                # Search terms for literature
    parser_queries: list = None                 # Epistemic parse queries (future tree-sitter for claims)

    def __post_init__(self):
        if self.native_vocabulary is None:
            self.native_vocabulary = {"entity_names": [], "relation_names": [], "method_names": [], "evidence_names": []}
        if self.question_types is None:
            self.question_types = QUESTION_TYPES[:]
        if self.claim_types is None:
            self.claim_types = EPISTEMIC_NODE_TYPES[:]
        if self.evidence_hierarchy is None:
            self.evidence_hierarchy = []
        if self.kernel_projection is None:
            self.kernel_projection = {}
        if self.method_templates is None:
            self.method_templates = {}
        if self.claim_templates is None:
            self.claim_templates = {}
        if self.uncertainty_templates is None:
            self.uncertainty_templates = {}
        if self.retrieval_terms is None:
            self.retrieval_terms = []
        if self.parser_queries is None:
            self.parser_queries = []

    def to_json(self, indent: int = 2) -> str:
        def _clean(d):
            return {k: v for k, v in d.items() if v is not None and v != [] and v != {} and v != ""}
        return json.dumps(_clean({
            "name": self.name, "version": self.version, "parent": self.parent or None,
            "native_vocabulary": self.native_vocabulary,
            "question_types": self.question_types,
            "claim_types": self.claim_types,
            "evidence_hierarchy": self.evidence_hierarchy,
            "kernel_projection": self.kernel_projection,
            "retrieval_terms": self.retrieval_terms,
        }), indent=indent, ensure_ascii=False)


# ------------------------------------------------------------------
# 4. Precedence rules — which projection wins when they conflict
# ------------------------------------------------------------------

PRECEDENCE: dict[str, str] = {
    "safety": "universal_wins",
    "ethics": "universal_or_governing_standard_wins",
    "local_style": "local_source_wins",
    "measurement_definition": "study_protocol_wins",
    "factual_claim": "best_evidence_wins",
    "method_validity": "method_invariants_win",
}

PRECEDENCE_ORDER: list[str] = [
    "universal_epistemic_invariants",
    "discipline_projection",
    "method_projection",
    "institutional_protocol",
    "dataset_evidence",
    "task_specific",
]


def resolve_precedence(rule_type: str, universal_rule: str, local_rule: str) -> str:
    """Resolve which rule takes precedence based on rule type.

    Args:
        rule_type: Type of rule (safety, ethics, local_style, etc.)
        universal_rule: The rule from universal invariants
        local_rule: The rule from local/discipline projection

    Returns:
        The winning rule.
    """
    mode = PRECEDENCE.get(rule_type, "local_source_wins")
    if mode == "universal_wins":
        return universal_rule
    elif mode == "local_source_wins":
        return local_rule
    elif mode == "best_evidence_wins":
        # Both apply — caller must evaluate evidence strength
        return f"{universal_rule} | {local_rule}"
    elif mode == "universal_or_governing_standard_wins":
        return universal_rule
    elif mode == "method_invariants_win":
        return local_rule
    elif mode == "study_protocol_wins":
        return local_rule
    return local_rule


# ------------------------------------------------------------------
# 5. Discipline projections
# ------------------------------------------------------------------

# Natural Science — overarching epistemic constraints
NATURAL_SCIENCE = DisciplineProjection(
    name="natural_science",
    version="1.0",
    native_vocabulary={
        "entity_names": ["system", "state", "variable", "parameter", "boundary", "mechanism"],
        "relation_names": ["causes", "correlates", "depends_on", "transforms", "conserves"],
        "method_names": ["experiment", "observation", "simulation", "analytical_model"],
        "evidence_names": ["measurement", "observation", "simulation_output", "analytic_proof"],
    },
    question_types=["descriptive", "causal", "mechanistic", "predictive"],
    evidence_hierarchy=[
        "controlled_experiment",
        "replicated_observation",
        "consistent_simulation",
        "analytic_model",
        "expert_consensus",
    ],
    kernel_projection={
        "constraints": [
            "Units required for all numerical quantities",
            "Dimensional consistency required for equations",
            "Boundary conditions must be explicit",
            "Measurement uncertainty must be reported",
            "Distinguish model output from observation",
            "Physical plausibility check required",
        ],
        "invariants": [
            "Numerical quantities must carry units",
            "Equations must be dimensionally consistent",
            "Initial and boundary conditions must be explicit",
            "Observation must not be presented as mechanism",
            "Simulation output must not be presented as experimental evidence",
        ],
        "acceptance_tests": [
            "Units balance",
            "Inputs and outputs are traceable",
            "Uncertainty is propagated",
            "Result agrees with known limiting cases",
            "Prediction is experimentally testable",
        ],
        "forbidden_actions": [
            "Reporting excessive numerical precision",
            "Ignoring incompatible measurement conditions",
            "Inferring causation from correlation alone",
            "Hiding failed or contradictory measurements",
        ],
    },
    retrieval_terms=["peer_reviewed", "replicated", "meta_analysis", "systematic_review"],
)

# Physics
PHYSICS = DisciplineProjection(
    name="physics",
    parent="natural_science",
    version="1.0",
    native_vocabulary={
        "entity_names": ["state_variable", "field", "particle", "wave", "symmetry", "conservation_law"],
        "relation_names": ["conserves", "transforms", "propagates", "couples", "quantizes"],
        "method_names": ["dimensional_analysis", "perturbation_theory", "numerical_simulation", "asymptotic_analysis"],
        "evidence_names": ["measurement", "analytic_result", "numerical_result", "limiting_case"],
    },
    kernel_projection={
        "constraints": ["Check dimensions", "Check conservation laws", "Check asymptotic limits", "Compare analytic and numerical result"],
        "invariants": ["All equations dimensionally consistent", "Energy/momentum/charge conserved", "Boundary conditions explicit", "Limiting cases reproduce known results"],
        "acceptance_tests": ["Dimensions balance", "Conservation laws satisfied", "Asymptotic limits match known theory"],
        "forbidden_actions": ["Extrapolating beyond domain of validity", "Ignoring non-perturbative effects"],
    },
    retrieval_terms=["arxiv", "physical_review", "standard_model", "effective_field_theory"],
)

# Chemistry
CHEMISTRY = DisciplineProjection(
    name="chemistry",
    parent="natural_science",
    version="1.0",
    native_vocabulary={
        "entity_names": ["stoichiometry", "phase", "temperature", "pressure", "concentration", "equilibrium", "kinetics", "purity"],
        "relation_names": ["reacts_with", "catalyzes", "equilibrates", "precipitates", "dissolves"],
        "method_names": ["titration", "spectroscopy", "chromatography", "calorimetry", "synthesis"],
        "evidence_names": ["yield", "spectrum", "chromatogram", "melting_point", "elemental_analysis"],
    },
    kernel_projection={
        "invariants": [
            "Mass and charge must balance",
            "Chemical form and phase must be explicit",
            "Reaction conditions must accompany the reaction",
            "Yield must distinguish theoretical and isolated yield",
        ],
        "acceptance_tests": ["Mass balance", "Charge balance", "Purity confirmed", "Yield reproducible"],
        "forbidden_actions": ["Reporting yield without purity assessment", "Omitting reaction conditions"],
    },
    retrieval_terms=["beilstein", "chemical_abstracts", "iupac", "organic_synthesis"],
)

# Biology
BIOLOGY = DisciplineProjection(
    name="biology",
    parent="natural_science",
    version="1.0",
    native_vocabulary={
        "entity_names": ["organism", "strain", "cell_line", "tissue", "population", "environment", "gene", "protein"],
        "relation_names": ["regulates", "expresses", "metabolizes", "signals", "differentiates"],
        "method_names": ["pcr", "sequencing", "microscopy", "flow_cytometry", "rna_seq", "western_blot"],
        "evidence_names": ["replicate", "control", "fold_change", "p_value", "cell_count"],
    },
    kernel_projection={
        "invariants": [
            "Biological and technical replicates are distinct",
            "Population claims require representative sampling",
            "In-vitro evidence does not automatically generalize in vivo",
            "Species-level generalization must be justified",
        ],
        "acceptance_tests": ["Controls included", "Replicates reported", "Batch effects assessed", "Statistical test appropriate"],
        "forbidden_actions": ["Pooling biological and technical replicates", "Generalizing across species without justification"],
    },
    retrieval_terms=["pubmed", "ncbi", "uniprot", "ensembl"],
)

# ------------------------------------------------------------------
# 6. Social science projections
# ------------------------------------------------------------------

SOCIAL_SCIENCE = DisciplineProjection(
    name="social_science",
    version="1.0",
    native_vocabulary={
        "entity_names": ["agent", "institution", "norm", "network", "market", "society", "culture", "group"],
        "relation_names": ["incentivizes", "constrains", "influences", "selects", "coordinates", "stratifies"],
        "method_names": ["survey", "experiment", "quasi_experiment", "ethnography", "case_study", "regression"],
        "evidence_names": ["observation", "measurement", "proxy", "index", "qualitative_account"],
    },
    question_types=["descriptive", "comparative", "causal", "normative", "interpretive"],
    evidence_hierarchy=[
        "randomized_experiment",
        "quasi_experiment_with_identification",
        "longitudinal_observational",
        "cross_sectional_observational",
        "qualitative_case_study",
        "expert_opinion",
    ],
    kernel_projection={
        "constraints": [
            "Define constructs explicitly",
            "Operationalization required for all variables",
            "Sampling frame must be specified",
            "Separate descriptive, causal, and normative claims",
            "Confounder analysis required",
            "Institutional context required",
            "Source bias analysis required",
            "Ethical review consideration required",
        ],
        "invariants": [
            "A measured proxy is not identical to the underlying construct",
            "Correlation does not establish causation",
            "Population claims must match the sampling frame",
            "Descriptive claims must remain separate from normative claims",
            "Individual-level results cannot automatically be inferred from aggregate data",
            "Historical and institutional context must not be discarded",
        ],
        "acceptance_tests": [
            "Constructs are explicitly defined",
            "Variables are operationalized",
            "Selection effects are considered",
            "Alternative explanations are listed",
            "Identification strategy supports the causal claim",
            "External validity limits are stated",
        ],
        "forbidden_actions": [
            "Treating proxies as direct measurements without qualification",
            "Generalizing beyond the sampled population",
            "Converting statistical significance into practical importance",
            "Presenting normative preferences as empirical conclusions",
            "Ignoring incentives, institutions, or cultural context",
        ],
    },
    retrieval_terms=["ssrn", "jstor", "google_scholar", "scopus", "web_of_science"],
)

# Economics
ECONOMICS = DisciplineProjection(
    name="economics",
    parent="social_science",
    version="1.0",
    native_vocabulary={
        "entity_names": ["agent", "market", "firm", "household", "good", "price", "incentive", "institution"],
        "relation_names": ["supplies", "demands", "equilibrates", "substitutes", "complements", "externalizes"],
        "method_names": ["regression", "iv", "diff_in_diff", "rdd", "panel_data", "structural_estimation"],
        "evidence_names": ["coefficient", "elasticity", "p_value", "confidence_interval", "r_squared"],
    },
    question_types=["causal", "predictive", "normative"],
    evidence_hierarchy=[
        "randomized_control_trial",
        "natural_experiment",
        "regression_discontinuity",
        "difference_in_differences",
        "instrumental_variables",
        "panel_fixed_effects",
        "cross_sectional_ols",
    ],
    kernel_projection={
        "constraints": [
            "Identify causal identification strategy",
            "Check for reverse causality",
            "Test for omitted variable bias",
            "Verify instrument validity",
            "Report standard errors and confidence intervals",
        ],
        "invariants": [
            "Correlation does not establish causation without identification strategy",
            "Instrument must satisfy exclusion restriction",
            "Parallel trends assumption must be justified for diff-in-diff",
            "Discontinuity design requires continuity of potential outcomes",
        ],
        "acceptance_tests": [
            "Identification strategy is explicit and justified",
            "Robustness checks performed",
            "Standard errors are clustered appropriately",
            "External validity limits are stated",
        ],
        "forbidden_actions": [
            "Observational association → universal causal law",
            "Statistical significance → economic significance",
            "Ignoring general equilibrium effects when relevant",
        ],
    },
    retrieval_terms=["nber", "ssrn_economics", "aea_journals", "repec", "econometrica"],
)

# Psychology
PSYCHOLOGY = DisciplineProjection(
    name="psychology",
    parent="social_science",
    version="1.0",
    native_vocabulary={
        "entity_names": ["construct", "trait", "stimulus", "response", "participant", "condition"],
        "relation_names": ["predicts", "moderates", "mediates", "primes", "activates"],
        "method_names": ["experiment", "survey", "longitudinal", "meta_analysis", "factor_analysis"],
        "evidence_names": ["effect_size", "p_value", "confidence_interval", "reliability", "validity"],
    },
    evidence_hierarchy=[
        "registered_replication",
        "pre_registered_study",
        "exploratory_study",
        "case_report",
    ],
    kernel_projection={
        "constraints": [
            "Validate measurement instrument",
            "Check statistical power",
            "Separate confirmatory and exploratory analysis",
            "Check replication status",
        ],
        "invariants": [
            "Construct validity must be established",
            "Measurement reliability must be reported",
            "Statistical power must be adequate for effect size",
            "Multiple comparisons must be corrected for",
        ],
        "acceptance_tests": ["Instrument validated", "Power adequate", "Confirmatory/exploratory distinguished", "Replication attempted"],
        "forbidden_actions": ["p-hacking", "HARKing", "Optional stopping without correction"],
    },
    retrieval_terms=["psycinfo", "pubmed_psychology", "osf", "psychological_science"],
)

# Sociology
SOCIOLOGY = DisciplineProjection(
    name="sociology",
    parent="social_science",
    version="1.0",
    native_vocabulary={
        "entity_names": ["institution", "social_structure", "network", "class", "norm", "power", "collective"],
        "relation_names": ["stratifies", "socializes", "networks", "mobilizes", "institutionalizes"],
        "method_names": ["survey", "ethnography", "network_analysis", "comparative_history", "interviews"],
        "evidence_names": ["demographic", "network_metric", "narrative", "institutional_record"],
    },
    kernel_projection={
        "invariants": [
            "Individual behavior and structural effects must remain distinguishable",
            "Institutional context must accompany cross-group comparison",
            "Category definitions must be historically and geographically bounded",
        ],
        "forbidden_actions": [
            "Ecological fallacy (aggregate → individual inference)",
            "Presenting historically-specific categories as universal",
        ],
    },
    retrieval_terms=["sociological_abstracts", "jstor_sociology", "asanet"],
)

# History — special epistemic projection (no repeatable experiments)
HISTORY = DisciplineProjection(
    name="history",
    parent="social_science",
    version="1.0",
    native_vocabulary={
        "entity_names": ["period", "event", "actor", "source", "document", "archive", "institution"],
        "relation_names": ["precedes", "causes", "influences", "documents", "contradicts"],
        "method_names": ["source_criticism", "archival_research", "comparative_history", "oral_history"],
        "evidence_names": ["primary_source", "secondary_source", "contemporaneous_account", "artifact"],
    },
    evidence_hierarchy=[
        "authenticated_primary_evidence",
        "independent_contemporaneous_accounts",
        "specialist_secondary_analysis",
        "later_recollections",
        "unsupported_narrative",
    ],
    kernel_projection={
        "invariants": [
            "Later knowledge must not be projected backward",
            "Absence of evidence is not automatically evidence of absence",
            "Source proximity does not eliminate source bias",
            "Chronological consistency must be maintained",
        ],
        "acceptance_tests": [
            "Sources are cited and their provenance documented",
            "Contradictory evidence is addressed",
            "Chronology is consistent",
            "Anachronism is avoided",
        ],
        "forbidden_actions": [
            "Presenting later knowledge as contemporaneous understanding",
            "Treating silence in the record as evidence of absence",
            "Using sources without provenance verification",
        ],
    },
    retrieval_terms=["jstor_history", "proquest_history", "archive_org", "worldcat"],
)

# ------------------------------------------------------------------
# 7. Projection Library — complete registry
# ------------------------------------------------------------------

PROJECTION_LIBRARY: dict[str, DisciplineProjection] = {
    "natural_science": NATURAL_SCIENCE,
    "physics": PHYSICS,
    "chemistry": CHEMISTRY,
    "biology": BIOLOGY,
    "social_science": SOCIAL_SCIENCE,
    "economics": ECONOMICS,
    "psychology": PSYCHOLOGY,
    "sociology": SOCIOLOGY,
    "history": HISTORY,
}


def select_projection(discipline: str, method: str = "", claim_type: str = "",
                      source_type: str = "") -> list[DisciplineProjection]:
    """Select the appropriate projection(s) for a research context.

    Uses the hierarchy: parent projection → discipline → method → claim.
    Returns a list from most general to most specific.

    Args:
        discipline: Discipline name (e.g. 'economics', 'physics')
        method: Method name (e.g. 'panel_data', 'spectroscopy')
        claim_type: Type of claim (e.g. 'causal_claim', 'measurement')
        source_type: Source type (e.g. 'journal_article', 'dataset')

    Returns:
        Ordered list of projections from general to specific.
    """
    selected: list[DisciplineProjection] = []

    # Add discipline projection
    proj = PROJECTION_LIBRARY.get(discipline)
    if proj:
        # Add parent first if it exists
        if proj.parent and proj.parent in PROJECTION_LIBRARY:
            parent = PROJECTION_LIBRARY[proj.parent]
            if parent not in selected:
                selected.append(parent)
        selected.append(proj)

    # If no direct match, try to infer from parent
    if not selected:
        for proj in PROJECTION_LIBRARY.values():
            if proj.parent == discipline:
                selected.append(proj)

    return selected


def get_projection_names() -> list[str]:
    """Return all available projection names."""
    return sorted(PROJECTION_LIBRARY.keys())


def get_projection_by_name(name: str) -> DisciplineProjection | None:
    """Get a projection by name."""
    return PROJECTION_LIBRARY.get(name)


