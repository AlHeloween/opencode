from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from prompt_kernel import KERNEL, kernel_digest, render_kernel, render_review, write_artifacts
from prompt_kernel.render import _named_rule_ids


def test_runtime_is_map_first_and_progressively_refined() -> None:
    text = render_kernel(KERNEL)
    sections = (
        "## 0. WORKFLOW",
        "## 1. ABI_AND_VOCABULARY",
        "## 2. SHARED_RULES",
        "## 3. GATE_REFINEMENT",
        "## 4. CROSS_CUTTING_PROTOCOLS",
        "## 5. IDENTITY_CONTRACTS",
    )
    offsets = tuple(text.index(section) for section in sections)
    assert offsets == tuple(sorted(offsets))
    assert text[: offsets[0]].strip() == ""


def test_identity_headings_are_entity_names_not_host_slugs() -> None:
    text = render_kernel(KERNEL)
    block = text[text.index("## 5. IDENTITY_CONTRACTS") :]
    assert "### BUILD_MODE\nkind: primary\n" in block
    assert "### PLAN_MODE\nkind: primary\n" in block
    assert "### REASONING_MODE\nkind: primary\n" in block
    assert "### build_mode\n" not in block
    assert "runtime: " not in block
    assert "Uncertain identity or permission → inspect the host runtime's authorization surface." in block


def test_kernel_does_not_restate_entities_under_three_spellings() -> None:
    text = render_kernel(KERNEL)
    for banned in (
        "sv_state",
        "sv_target:",
        "sv_contract",
        "information_status:",
        "source_routing @",
        "#### @SV_STATE",
        "#### @SV_OUTPUT",
        "#### @SV_EVERY_TURN",
        "Emit @SV_FORMAT",
        "emit: after every response",
        "GATE_1_GROUND / GROUND",
        "GATE_1_GROUND — GROUND",
        "### G1 GATE_1_GROUND",
        "Manhattan_L1",
        "#### @CACHE_STABILITY",
        "#### @SUCCESS_COMPLETED",
    ):
        assert banned not in text, banned
    assert "1.2 @SV_FORMAT:" in text
    assert "```yaml\nKeywords: topic1 0.35" in text
    assert "parent-goal-md5:" in text
    assert "### G1 GROUND" in text
    assert "### G4 AUTHORIZE" in text
    assert "#### @CURRENT_SV" in text
    assert "#### @SV_TARGET" in text
    assert "- Measure only:" in text
    assert "#### @SEMANTIC_CONTROL" in text
    assert "Steering assignment" in text
    assert "Measure only:" in text
    assert "regenerated" in text
    assert "coefficients" in text
    attention = text[text.index("<SEMANTIC_ATTENTION_RULES>") : text.index("</SEMANTIC_ATTENTION_RULES>")]
    # anchor moved 2026-09-12: MULTI_AGENT_SV lost its hand-over clause to G7
    # DELEGATION_BINDING, so the rule now opens "A sub-agent returns...".
    trajectory = attention[attention.index("- Measure only:") : attention.index("- A sub-agent returns")]
    assert "regenerat" not in trajectory
    assert "coefficients" not in trajectory
    target = attention[attention.index("#### @SV_TARGET") : attention.index("- Measure only:")]
    assert "current observed" not in target
    assert "complex action" not in target
    assert "1.3 @SOURCE_ROUTING:" in text
    assert "1.1 @INFOMARK" in text
    assert "promotion: @INFORMATION_STATUS" in text
    assert "simulation never equals reality" in text
    assert "failed proof -> Unknown" in text
    assert "statuses: @INFORMATION_STATUS" in text
    assert "Generic web never becomes Inferred" in text
    # Re-pinned 2026-10-02 (ORACLE_ROLE fix, owner): the phrase now names the user as one of the simulations; the
    # pin grows with it rather than loosening to a fragment both spellings would satisfy.
    assert "Neither simulation, the user's included, is the oracle" in text
    assert "the user's word is testimony, not proof" in text
    assert "Hallucination-cure priors" in text
    assert "Do not treat simulation error" in text
    assert "#### @SIMULATION_ERROR" in text
    assert "distort the simulation silently, then it collapses" in text
    assert "still a result" in text
    assert "Pass pins Exact medoids" in text
    assert "enough Exact medoids" in text
    assert "renormalize on Exact basis" in text
    assert "non-Exact medoid axes" in text
    assert "don't keep turning" in text
    # Divergence protocol (2026-09-02, Alexander): runtime evidence owns
    # reversible stamps; contradiction demotes, while affect only opens a gap.
    assert "#### @DIVERGENCE_PROTOCOL" in text
    assert "Only eligible runtime evidence" in text
    assert "revoke stamp" in text
    assert "set Unknown" in text
    # 2026-09-24: the PULL half. Divergence only ever arrived as new evidence, so a stamp
    # read back after a fold was trusted however far its artifact had moved — the one
    # "recorded, never re-read" the outside review found. The digest is compared, unlike
    # @SV_FORMAT.md5, which the same kernel forbids computing.
    assert "re-digest before relying on ledger/plan/memory" in text
    assert "unobtainable content_hash" in text
    assert "Digest computed+compared (≠ @SV_FORMAT.md5)" in text
    assert "evidence_ref" in text
    assert "claim digest" in text
    # K-3 (2026-09-12): a negative oracle result had nowhere to live, which made
    # mutation and differential oracles inexpressible — killed mutant is an
    # EXPECTED_FAIL, not a divergence.
    # 2026-09-24: `content_hash?` added. The pin is the three RESULTS, not a frozen field
    # list — a stamp with no digest cannot be revalidated later, so @DIVERGENCE_PROTOCOL's
    # read-back check had nothing to compare against. Optional because evidence that is not
    # an artifact (a live probe) has no stable digest to record.
    assert "ORACLE_STAMP: {claim_id, evidence_ref, layer, result: PASS | FAIL | EXPECTED_FAIL, content_hash?}" in text
    assert "DIVERGENCE_EVENT: {claim_id, evidence_ref}" in text
    assert "Locate Exact medoids" in text
    assert "Affect opens oracle gap" in text
    assert "never reward" in text


def test_gate_details_follow_numeric_order() -> None:
    text = render_kernel(KERNEL)
    offsets = tuple(text.index(f"### G{i} ") for i in range(0, 10))
    assert offsets == tuple(sorted(offsets))
    # G0 UNDERSTAND: language + intention discipline precede all project gates.
    assert "### G0 UNDERSTAND" in text
    assert text.index("### G0 UNDERSTAND") < text.index("### G1 GROUND")
    assert "reasoning included" in text
    assert "Digital Intention" in text


def test_dictionary_precedes_first_detailed_rule_use() -> None:
    text = render_kernel(KERNEL)
    assert "at-prefixed uppercase identifier" in text
    assert "@NAME" not in text
    assert text.index("## 1. ABI_AND_VOCABULARY") < text.index("1.2 @SV_FORMAT")
    assert text.index("1.2 @SV_FORMAT") < text.index("#### @EVIDENCE_ORDER")
    assert text.index("#### @EVIDENCE_ORDER") < text.index("## 3. GATE_REFINEMENT")


def test_rule_definitions_follow_reference_naming() -> None:
    text = render_kernel(KERNEL)
    named = _named_rule_ids(KERNEL)
    rule_ids = [rule.id for rule in KERNEL.shared_rules]
    rule_ids.extend(rule.id for gate in KERNEL.gates for rule in gate.local_rules)
    rule_ids.extend(rule.id for protocol in KERNEL.protocols for rule in protocol.local_rules)
    for rule_id in rule_ids:
        expected_headers = 1 if rule_id in named else 0
        assert text.count(f"#### @{rule_id}\n") == expected_headers, rule_id


def test_runtime_is_followable_without_opening_the_adid_document() -> None:
    """Owner decision 2026-09-28 03:08: ADID citations are provenance, never required reading.

    A role the runtime never defines is not a shortcut, it is a hole — `Analyst2` and `Oracle2`
    name entities with no contract in this kernel, so a rule phrased through them tells the
    reader to go and look them up instead of telling it what to do. The four stop cases and
    both self-trigger conditions must therefore survive as kernel vocabulary, or the cleanup
    would have deleted a decision to buy a shorter line.
    """
    text = render_kernel(KERNEL)
    for undefined in ("Analyst1", "Analyst2", "Oracle2", "Mode 2 Fractal Generation", "Mode 2 for"):
        assert undefined not in text, undefined
    stop = next(rule.text for gate in KERNEL.gates for rule in gate.local_rules if rule.id == "BOUNDED_STOP_CONDITIONS")
    for case in (
        "passes every test case",
        "3 failed corrective attempts",
        "immutable external dependency",
        "structurally futile",
    ):
        assert case in stop, case
    assert "NOT SUCCESS" in stop, "a bounded stop must not read as closure"
    # The classification is a GATE between clustering and selection, and an absent classification
    # reads as REJECTED — the project's own rule that a missing indicator means "not working", not
    # "probably fine". The second clause exists because tier 1 says "fully verified", which reads
    # like a finished task; only @ORACLE verifies a task, and no tier may stand in for it.
    lean = next(rule.text for gate in KERNEL.gates for rule in gate.local_rules if rule.id == "LEAN_RANKING")
    assert "AFTER clustering and BEFORE selection" in lean
    assert "an unclassified candidate is not selectable" in lean
    assert "reads as rejected and never as acceptable" in lean
    assert "ranks the candidate's INFORMATION QUALITY, never the task's completion" in lean
    for tier in ("(1) Fully Verified", "(2) Minor Inaccuracy", "(3) Major Contradiction", "(4) Unusable"):
        assert tier in lean, tier

    # The L1 reasons are the POINT of choosing an additive metric over a medoid one, and they
    # were the part the kernel never said. Pinned with the domain clause, because «cluster
    # candidate vectors» named an object the ABI does not define — the rule was unexecutable
    # prose until the vector was declared to BE its @SV_FORMAT weight list.
    manhattan = next(rule.text for gate in KERNEL.gates for rule in gate.local_rules if rule.id == "MANHATTAN_L1")
    assert "a candidate vector IS its @SV_FORMAT weight list" in manhattan
    assert "sum of absolute weight differences" in manhattan
    # One property, three consequences: the test names the FORM so the reasons cannot be re-scattered
    # into a paragraph that answers nothing, and so a reason that loses its decision beside it fails.
    assert "Nothing here averages" in manhattan
    assert "one spike cannot drag a cluster" in manhattan
    assert "a real object, not a midpoint that may not exist" in manhattan
    assert "keep each zone small" in manhattan, "the medoid pass is quadratic inside it"

    # A self-consistent chain on a false premise walks the whole ladder (owner, 2026-09-28: found
    # nonsense on the web, confirmed it in sources, ran a smoke — still nonsense). Every rung
    # measures how the claim was obtained, so tier 1 is only reachable with a reference outside
    # the candidate's own evidence chain.
    assert "factual accuracy checked against a reference OUTSIDE the candidate's own evidence chain" in lean
    assert "a flawless method on a false premise is not verification" in lean

    # Independence is per nesting level. Under fractal nesting a parent and its child can share
    # one source, which would satisfy "≥3 medoids with independent sources" with three names for
    # one explanation — the exact degeneracy the rule exists to reject, reachable one level down.
    simplex = next(rule.text for gate in KERNEL.gates for rule in gate.local_rules if rule.id == "MEDOID_SIMPLEX")
    assert "independence is measured WITHIN one nesting level" in simplex
    assert "a parent and its child never count as two sources" in simplex

    triggers = {rule.id: rule.text for protocol in KERNEL.protocols if protocol.id == "EVOLUTION_LOOP" for rule in protocol.local_rules}
    assert "closed or stalled" in triggers["SELF_TRIGGER_A"]
    assert "≥10 message history" in triggers["SELF_TRIGGER_B"]
    # The mechanism is named once. G2's fractal decomposition is the only generator, so a
    # trigger that also says «propose … candidates» is a third statement of it — and that is
    # what made the ADID «Mode 2» layer read as a second, competing mode. Pinned so the
    # duplication cannot grow back with a well-meaning edit.
    candidates = triggers["EVOLUTION_CANDIDATES"]
    assert "cluster @L1_DISTANCE" in candidates
    for rule_id in ("SELF_TRIGGER_A", "SELF_TRIGGER_B", "SELF_TRIGGER"):
        assert "propose" not in triggers[rule_id].lower(), rule_id


def test_procedure_layer_keeps_its_decisions() -> None:
    """F6, 2026-09-29: the procedure layer ported from reasoning_prompt.final.txt, compressed ~6x.

    Compression is exactly where a decision dies unseen, so each rule pins the clause that IS its
    decision — the one whose loss would turn the rule into advice. The F3 phrases landed earlier
    with no pin at all; they are pinned here with the layer that supersedes or relies on them.
    """
    shared = {rule.id: rule.text for rule in KERNEL.shared_rules}
    test = shared["TEST_INVARIANT"]
    assert "fallible ENCODING of the predicate" in test
    assert "ground both against the requirement, never each other" in test
    assert "IMPLEMENTATION | TEST | SPEC_GAP | HARNESS" in test
    assert "No weakening, deletion or skip to get green" in test
    assert "never by age or pass history" in test
    # Owner, 2026-09-29: «мы исправляем код, тест падает, мы начинаем подгонять код под тест, а тест устарел — все
    # остальное тоже падает». Measured here before: test/snapshot/snapshot.test.ts sat red 2.5 months as a stale
    # spec of the git backend (AGENTS.md § Fossil).
    assert "A red after an edit is first a question about the TEST — is it current against the requirement?" in test
    assert "Code fitted to a stale test breaks what the requirement protects" in test
    surface = shared["SURFACE_PREPARATION"]
    assert "CHANGE starts from READY" in surface
    assert "not a stub or stale artifact" in surface
    assert "A red baseline is STABILIZE" in surface
    assert "never a stabilize-the-stabilizer tree" in surface
    causal = shared["CAUSAL_ATTRIBUTION"]
    assert "is a claim, not an exemption" in causal
    assert "no comparable run → INDETERMINATE" in causal
    # Sonnet + space-bunny, independently: «before PASS / after FAIL» parsed as an OR tagged an unchanged
    # failure as «this change»; and INDETERMINATE had no action, so it could close as inherited.
    assert "before PASS and after FAIL → this change" in causal
    assert "never closed as inherited" in causal
    assert "mismatch → stop and re-ground, never overwrite" in surface
    assert "A new surface is READY from its enclosing surface's baseline PASS" in surface
    assert "STABILIZE repairs a classified defect" in dict(KERNEL.terms)["WORK_KIND"]
    kaizen = shared["KAIZEN"]
    assert "A tool defect stops the line; it is never weather" in kaizen
    assert "Its second occurrence forbids another workaround" in kaizen
    assert "updated in the same change" in kaizen
    assert "cheapest primitive check" in kaizen
    tools = shared["TOOLCHAIN_QUALIFICATION"]
    assert "A general test is never the first experiment on its instruments" in tools
    assert "verify the fixture's state, not the tool's return" in tools
    assert "not an owner question" in tools
    assert "the tool under test is never its own oracle" in tools
    # Owner, 2026-09-29: never accept a half-working drill that drilled half the holes, or a half-working
    # microscope that inspected half the board. Partial coverage by a degraded tool reads as complete.
    assert "a tool that works on part of it is BROKEN, not scoped" in tools
    assert "nothing is delivered on its covered half" in tools
    # Owner, 2026-09-29 (a Codex run): the app launched for debugging, the mouse could not click, and the
    # agent fitted first the tools and then the results. Readiness is checked BEFORE testing (G3), and a
    # mid-test tool failure voids the run instead of being repaired inside it.
    assert "A tool failing mid-test voids the run" in tools
    assert "never patch the tool in flight or fit results to it" in tools
    g3 = next(gate for gate in KERNEL.gates if gate.id == "G3")
    assert "TOOLCHAIN_QUALIFICATION" in g3.shared_rules, "readiness is planned before testing"
    assert "Calibration examples ≠ held-out cases" in tools
    churn = shared["ANTI_CHURN"]
    assert "Memory is not a vote" in churn
    # Owner, 2026-09-29: memory rebuilt from artifacts still self-winds — our own artifacts carry
    # a false alarm into the next cycle and sooner or later provoke a wrong assessment.
    assert "our own artifact adds no provenance root" in churn
    assert "act only after its reproducer fails NOW" in churn
    assert "retired, not inherited" in churn
    assert "copies of one source count once" in churn
    assert "counters survive retitling, reclassification, restarts and A→B→A revisits" in churn
    # space-bunny (outside falsifier): a self-assigned failure_class in the key let a relabel reset the
    # counter — anti-churn defeated by the very self-winding it exists to stop.
    assert "ISSUE_KEY = (acceptance, surface, reproducer)" in churn
    assert "a passing regression test stays protected" in churn
    assert "reopens only on its stored reopen_when" in churn
    assert "without them the store grows and nothing retires" in churn
    # BGE dedup D2: one validation procedure, two layers, every decision of both halves kept.
    validate = shared["VALIDATE_BEFORE"]
    for clause in ("YAML/JSON lint, Markdown structure, schema", "syntax, types, schema", "emit only the corrected artifact", "No malformed plan enters G4", "no unverified mutation enters the project"):
        assert clause in validate, clause
    # BGE dedup D1: SUCCESS is defined once; the stop rule points to it instead of restating it.
    stop = next(rule.text for gate in KERNEL.gates for rule in gate.local_rules if rule.id == "BOUNDED_STOP_CONDITIONS")
    assert "SUCCESS still needs @CLOSURE_PROOF" in stop
    # Owner, 2026-09-29: «Особенно lean… без этой проверки начинается ковыряние и доказательство ерунды».
    # LEAN reaches the oracle and the bug report, not only G2 selection — and earns its rendered name.
    g8 = {rule.id: rule.text for gate in KERNEL.gates if gate.id == "G8" for rule in gate.local_rules}
    # Sonnet on the LEAN/SVM delta: «premise» was undefined, G8 re-opened a gate placed before selection,
    # and a single bug report could not be classified without spending the reproducer it gates.
    lean_g8 = g8["LEAN_BEFORE_PROOF"]
    # Sonnet, final rounds: «stays admitted» had no divergence carve-out, and «premise» was defined only at G8,
    # ~250 lines after @DIVERGENCE_PROTOCOL used it.
    assert "A premise admitted at G2 stays admitted unless @DIVERGENCE_PROTOCOL re-opened it" in lean_g8
    assert "diverged premise (any claim a verdict rests on)" in shared["DIVERGENCE_PROTOCOL"]
    assert "classified alone, by reading, before an oracle is spent on it" in lean_g8
    assert "tiers 1-2 → the oracle may run" in lean_g8
    assert "neither ever proven" in lean_g8
    assert "reported failure → @LEAN_RANKING of its expected behavior against the requirement (tiers 1-2 admit it to reproduction; 3-4 close it as Unknown with the reason) → reproducer" in shared["BUG_FIX_PROCEDURE"]
    assert "tier 4 → Unknown + @RISK_LEDGER" in lean_g8
    assert "#### @LEAN_RANKING" in render_kernel(KERNEL)
    # SVM is a briefing: read as evidence it is the self-winding channel the owner named.
    svm = dict(KERNEL.state_fields)["SVM"]
    assert "BRIEFING that points to evidence, never evidence itself" in svm
    # Owner: «SVM задается перед входом в задачу и фракталами расширяется, он задает направление».
    assert "Seeded at G0 as the digital form of @DIGITAL_INTENTION" in svm
    assert "null at the root" in svm
    flow = {gate.id: (gate.requires, gate.outputs) for gate in KERNEL.gates}
    assert "SVM" in flow["G0"][1]
    for gate_id in ("G2", "G3"):
        assert "SVM" in flow[gate_id][0] and "SVM" in flow[gate_id][1], gate_id
    assert "SVM" in flow["G7"][0]
    # Owner: «SVM = STATE VECTOR MANIFEST» — expanded, so it cannot be read as the @SV_FORMAT semantic vector;
    # ADID 12.2 §I.3: one atomic task, a known verifiable starting state, a turn chain, a goal hierarchy.
    assert svm.startswith("State Vector Manifest — the complete context of ONE atomic task")
    assert "every turn starts from a known, verifiable state" in svm
    for field in ("turn_id", "parent_turn_id", "goal_hierarchy", "goal_vector", "task_vector", "evidence_vector", "oracle_vector"):
        assert field in svm, field
    # Owner: «SV — SEMANTIC VECTOR — он есть у любого документа, сообщения, плана или таска». The candidate's
    # «never inside artifacts» meant the CHAT vector; read bare, it denied artifacts their own vector.
    current_sv = shared["CURRENT_SV"]
    assert "The turn's chat vector is never pasted into a generated artifact" in current_sv
    assert "carries its OWN @SV_FORMAT vector computed from that artifact alone" in current_sv
    assert "however many one turn produces" in current_sv
    # Owner: «мы правим код — есть ли у этой правки семантический вектор — если мы его знаем то править будем
    # правильно». The vector is named before the edit and the diff is read back against it.
    g7 = {rule.id: rule.text for gate in KERNEL.gates if gate.id == "G7" for rule in gate.local_rules}
    # Sonnet: the edit's sv is set at G6 (PLAN_BINDING carries it) and is a direction — @CURRENT_SV's
    # «Observation, not steering» is about the turn's vector only.
    assert "name the binding's sv (@SV_FORMAT, set at G6; a direction, unlike the turn's observed vector) BEFORE editing" in g7["EDIT_SV"]
    assert "a hunk no keyword covers is off-direction; justify it or revert it" in g7["EDIT_SV"]
    # Owner: «если вектора нету… нету направления — то будет разброд… я не люблю случайный выигрыш, все должно
    # быть системно».
    assert "no hunk of the task starts, and a PASS reached without them is a random win, not evidence" in g7["EDIT_SV"]
    # Round 6: the loops and dead ends a literal reader could fall into (the flaky pin sits beside `smoke` below).
    assert "is it current against the requirement?" in test
    assert "3-4 close it as Unknown with the reason" in shared["BUG_FIX_PROCEDURE"]
    assert "a central one routes G8 → G2" in lean_g8
    assert "re-opened it (contradicting evidence or changed content)" in lean_g8
    assert "expected_diff, sv, oracle" in dict(KERNEL.state_fields)["PLAN_BINDING"]
    # Owner: «тут я выиграю, тут я проиграю, тут при своих, но если эти условия не сбываются значит ошибка в
    # прогнозе». The prediction is written per case BEFORE the run; a surprise in either direction is a model error.
    smoke = next(rule.text for gate in KERNEL.gates for rule in gate.local_rules if rule.id == "SMOKE_BEFORE")
    assert "Predict each case before the run — PASS, FAIL or unchanged (expected_delta)" in smoke
    assert "an unexpected PASS included, is a forecast error" in smoke
    assert "logged as a divergence, never counted as a pass" in smoke
    assert "A case with no prediction runs as diagnostic only, never as evidence" in smoke
    assert "a flaky outcome is a HARNESS finding under a replication criterion, not a re-grounding" in smoke
    # Owner: «тогда выигрышные позиции тоже под вопросом» — a wrong model re-opens the wins it produced.
    assert "Divergence is transitive: every stamp resting on the diverged premise (any claim a verdict rests on) — past PASSes included — returns to Unknown" in shared["DIVERGENCE_PROTOCOL"]
    # Owner: «Не только — могли измениться условия. Короче — нужен regrounding».
    # Owner: «если человек — руки от клавиатуры, спать, потом перечитать доки, код, тесты, сделать смоки и только
    # потом продолжать — полный реграундинг». For a model the sleep is dropping the window's picture.
    divergence = shared["DIVERGENCE_PROTOCOL"]
    # Owner: «у модели — собрать новые факты, записать в память, сделать компакт и дальше работать по обновленной
    # системе». Dropping the picture without persisting it would be a loss, not a sleep.
    assert "FULL re-grounding at G1: pause the edit; the model's sleep — persist the new facts to memory, then compact" in divergence
    assert "re-read docs, code and tests from disk, re-baseline with isolated smokes — only then continue" in divergence
    assert "never a re-run on the old picture" in divergence
    assert "the premise is wrong or the conditions changed" in smoke
    # F3 phrases, landed in F2 without a pin.
    assert "a redundant intermediate search may be skipped" in shared["EVIDENCE_ORDER"]
    assert "No reproducer = unconfirmed, not hallucination" in shared["BUG_FIX_PROCEDURE"]
    assert "Verified source wording is not a verified proposition" in shared["INFORMATION_STATUS"]
    # The hooks that make the layer bind: a rule no gate cites and no edge names is advice.
    cites = {rule_id for gate in KERNEL.gates for rule_id in gate.shared_rules}
    for rule_id in ("TEST_INVARIANT", "SURFACE_PREPARATION", "CAUSAL_ATTRIBUTION", "TOOLCHAIN_QUALIFICATION", "ANTI_CHURN"):
        assert rule_id in cites, rule_id
    edges = {(edge.source, edge.target, edge.condition) for edge in KERNEL.edges}
    assert any(s == "G6" and t == "G7" and "@SURFACE_PREPARATION READY" in c for s, t, c in edges)
    assert any(s == "G8" and t == "G2" and "@TOOLCHAIN_QUALIFICATION" in c for s, t, c in edges)
    assert any(s == "G6" and t == "G2" and "@TOOLCHAIN_QUALIFICATION" in c for s, t, c in edges), "F10: G6 sees the tool gap first"


def test_structured_predicates_do_not_shorten_rendered_rule_meaning() -> None:
    """A machine-readable predicate is not a replacement for the owner's rule text."""
    text = render_kernel(KERNEL)
    for gate in KERNEL.gates:
        for rule in gate.local_rules:
            if rule.predicate is not None:
                assert rule.text in text, f"{gate.id}.{rule.id} lost its source clause"


def test_runtime_is_deterministic_lf_and_within_utf8_budget() -> None:
    first = render_kernel(KERNEL)
    second = render_kernel(KERNEL)
    assert first == second
    assert "\r" not in first
    assert first.endswith("\n")
    assert len(first.encode("utf-8")) <= KERNEL.utf8_budget
    assert kernel_digest(KERNEL) == hashlib.sha256(first.encode("utf-8")).hexdigest()


def test_review_wraps_exact_runtime_body() -> None:
    runtime = render_kernel(KERNEL)
    review = render_review(KERNEL)
    assert review.endswith(runtime)
    assert review.count(runtime) == 1


def test_writer_only_publishes_stamped_dist_artifacts(tmp_path: Path) -> None:
    stamp = "2026-09-01_19-27-54"
    paths = write_artifacts(dist=tmp_path, stamp=stamp)
    assert paths == (
        tmp_path / f"{stamp}_reasoning_prompt.mdc",
        tmp_path / f"{stamp}_reasoning_prompt.txt",
    )
    assert paths[0].read_text(encoding="utf-8") == render_review(KERNEL)
    assert paths[1].read_text(encoding="utf-8") == render_kernel(KERNEL)
    assert (tmp_path / f"{stamp}_manifest.json").is_file()
    assert (tmp_path / f"{stamp}_migration_report.json").is_file()
    assert not (tmp_path / "reasoning_prompt.txt").exists()
    package = Path(__file__).resolve().parents[1]
    with pytest.raises(TypeError):
        write_artifacts(package.parent)  # type: ignore[call-arg]


def test_writer_rejects_unreadable_stamp(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="build stamp"):
        write_artifacts(dist=tmp_path, stamp="latest")


def test_next_package_has_no_runtime_import_from_legacy_precompiled_kernel() -> None:
    package = Path(__file__).resolve().parents[1]
    sources = "\n".join(path.read_text(encoding="utf-8") for path in sorted(package.glob("*.py")))
    assert "prompts_kernel._kernel_precompiled" not in sources
    assert "prompt_research_candidate" not in sources


def test_pre_action_section_stays_small() -> None:
    """G0+G1 is what an agent must read and SATISFY before its first instrument call.

    2026-09-24: it had grown 2_840 -> 7_309 B (x2.6) against the battle-tested 09-17 build, and a
    third of G1 was catalogues that help build a surface but never help find one. An imperative
    that is not a call can only be satisfied by PROSE, so mass moved forward in the pass buys
    narration instead of grounding — and one flat total ceiling cannot see that, because the total
    barely moved. This cap is the axis that can.

    Measured after the eviction: 5_365 B. The band is the next one above it.

    5_600 -> 6_100 (2026-10-03, owner's choice): the G1 PROJECT_LAYOUT binding is a FINDING aid — where to read
    before the first call, and «open scripts/ before inventing a build» (a robot invented one that day) — the kind
    of line this cap admits, unlike the catalogues it evicted. Measured 6_073 B with it and VCS_ROLES.
    """
    from prompt_kernel.addons import GATE_ADDONS

    text = render_kernel(KERNEL, GATE_ADDONS)
    section = 0
    for gate in ("G0", "G1"):
        block = text[text.index(f"<{gate}_RULES>") : text.index(f"</{gate}_RULES>")]
        section += len(block.encode("utf-8"))
    assert section <= 6_100, section
