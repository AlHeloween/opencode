"""t100 — the first 3x3 criterion on our own project, with MEASURED independence.

Criterion K1: the three-oracle acceptance rule (@THREE_ORACLES) is DECLARED in the
kernel, WIRED to G3/G8/G9, DOCUMENTED in the project glossary, and EXERCISED by the
kernel suite.

Nine legs, three per aspect. A leg counts only when it carries a UNIQUE-DETECTION
receipt: an injected defect that THIS leg catches and the OTHER legs of the SAME
aspect miss ("Missed means the other legs RAN against the injected defect and let it
through" — @THREE_ORACLES). This probe injects every defect into a COPY of the bundle
and reports which leg flipped. A leg that no defect makes unique is SUBSUMED and does
not count as a leg.

Read-only against the project. Nothing outside this folder is written.
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from prompt_kernel import KERNEL, render_kernel  # noqa: E402
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS  # noqa: E402
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS  # noqa: E402
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS  # noqa: E402

GLOSSARY = ROOT / "docs" / "glossary.md"
def _plan_path() -> Path:
    """The t96 plan moves between plans/ and plans_completed/ as it closes.

    A one-line path constant broke the whole probe on 2026-10-20 (the plan moved,
    the D legs read a missing file, the run died instead of reporting). The input
    domain here is the plan's LOCATION, so the probe must qualify over both.
    """
    for base in ("plans", "plans_completed"):
        candidate = ROOT / base / "2026-10-19_kernel-three-oracles.md"
        if candidate.is_file():
            return candidate
    return ROOT / "plans" / "2026-10-19_kernel-three-oracles.md"


PLAN = _plan_path()
SRC = ROOT / "prompt_kernel" / "source.py"
TESTS = ROOT / "prompt_kernel" / "tests" / "test_three_oracles.py"
INSTALLED = ROOT / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.txt"
DIST = ROOT / "prompt_kernel" / "dist"

# The plan pins this prefix for the rule text ("rule sha a94b79f98c5b0725 x4").
PIN = "a94b79f98c5b0725"

RULE_HEADER = "#### @THREE_ORACLES"


# ---------------------------------------------------------------- bundle


def newest_artifact() -> tuple[str, Path]:
    files = sorted(DIST.glob("*_reasoning_prompt.txt"))
    if not files:
        raise SystemExit("no product artifact under prompt_kernel/dist")
    path = files[-1]
    return path.read_text(encoding="utf-8"), path


def rule_text_from_source(src: str) -> str:
    """The rule text exactly as declared in source.py (ast, not a regex guess)."""
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Name) or node.func.id != "_rule":
            continue
        if len(node.args) < 3:
            continue
        name = node.args[1]
        if isinstance(name, ast.Constant) and name.value == "THREE_ORACLES":
            text = node.args[2]
            if isinstance(text, ast.Constant) and isinstance(text.value, str):
                return text.value
    raise SystemExit("THREE_ORACLES rule text not found in source.py")


def rule_block(text: str) -> str:
    """The rendered rule block (header + text) out of a rendered kernel."""
    i = text.find(RULE_HEADER)
    if i < 0:
        return ""
    j = len(text)
    for marker in ("\n#### ", "\n## "):
        k = text.find(marker, i + 1)
        if k > 0:
            j = min(j, k)
    return text[i:j]


def measure_suite() -> dict:
    """The measured kernel suite result: counts and the failed test ids."""
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "prompt_kernel/tests/", "-q", "--tb=no"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = proc.stdout
    passed = failed = 0
    m = re.search(r"(\d+) failed", out)
    if m:
        failed = int(m.group(1))
    m = re.search(r"(\d+) passed", out)
    if m:
        passed = int(m.group(1))
    ids = re.findall(r"^FAILED (\S+)", out, re.M)
    return {"passed": passed, "failed": failed, "failed_ids": ids, "exit": proc.returncode}


def build_bundle() -> dict:
    artifact, artifact_path = newest_artifact()
    src = SRC.read_text(encoding="utf-8")
    renders = {
        "product": render_kernel(KERNEL),
        "claude": render_kernel(KERNEL, CLAUDE_GATE_ADDONS, ()),
        "codex": render_kernel(KERNEL, CODEX_GATE_ADDONS, ()),
        "cursor": render_kernel(KERNEL, CURSOR_GATE_ADDONS, ()),
    }
    return {
        "src": src,
        "tests": TESTS.read_text(encoding="utf-8"),
        "glossary": GLOSSARY.read_text(encoding="utf-8"),
        "plan": PLAN.read_text(encoding="utf-8"),
        "artifact": artifact,
        "artifact_path": str(artifact_path.relative_to(ROOT)),
        "renders": renders,
        "rule_text": rule_text_from_source(src),
        "suite": measure_suite(),
    }


# ---------------------------------------------------------------- legs
# Each leg: (bundle) -> (ok: bool, detail: str). A leg PASSES when ok is True.


def leg_d1_traceability(b: dict) -> tuple[bool, str]:
    """Every path:line pin the glossary carries resolves to a real line."""
    pins = re.findall(r"`([A-Za-z0-9_./-]+\.(?:py|md|txt|ts)):(\d+)`", b["glossary"])
    broken = []
    for rel, line in pins:
        path = ROOT / rel
        if not path.is_file():
            broken.append(f"{rel}:{line} (file missing)")
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        n = int(line)
        if n < 1 or n > len(lines):
            broken.append(f"{rel}:{line} (line out of range, file has {len(lines)})")
    return (not broken, f"{len(pins)} pin(s); broken: {broken or 'none'}")


def leg_d3_examples(b: dict) -> tuple[bool, str]:
    """Every test the plan cites as its smoke test exists as a real test function."""
    section = b["plan"].split("## 5. Smoke Tests", 1)[-1].split("## 6.", 1)[0]
    cited = sorted(set(re.findall(r"::(test_[a-z0-9_]+)", section)))
    defined = set(re.findall(r"^def (test_[a-z0-9_]+)", b["tests"], re.M))
    missing = [t for t in cited if t not in defined]
    return (not missing, f"{len(cited)} cited, {len(missing)} missing: {missing or 'none'}")


def leg_d5_contract_diff(b: dict) -> tuple[bool, str]:
    """The catalogue in the rule text and the catalogue page in the glossary agree."""
    rule_ids = set(re.findall(r"\b([DCE][1-5])\b", b["rule_text"]))
    page = b["glossary"].split("## Oracle family catalogue", 1)[-1].split("\n## ", 1)[0]
    # The DECLARED catalogue is the three family segments, not the heading (the
    # heading carries «D1–5, C1–5, E1–E5» and would keep an id alive after it
    # was dropped from the list).
    markers = ["Documentation (meaning):", "Code (mechanism):", "Execution (reality):"]
    page_ids: set[str] = set()
    for index, marker in enumerate(markers):
        start = page.find(marker)
        if start < 0:
            continue
        stop = page.find(markers[index + 1], start) if index + 1 < len(markers) else len(page)
        page_ids |= set(re.findall(r"\b([DCE][1-5])\b", page[start:stop]))
    only_rule = sorted(rule_ids - page_ids)
    only_page = sorted(page_ids - rule_ids)
    return (
        not only_rule and not only_page,
        f"rule {len(rule_ids)} ids, glossary {len(page_ids)} ids; only in rule: {only_rule or 'none'}; only in glossary: {only_page or 'none'}",
    )


def gate_shared_rules_span(src: str, gid: str) -> tuple[int, int] | None:
    """Char span of a gate's shared_rules tuple, found through the parsed Gate call."""
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name) or node.func.id != "Gate":
            continue
        if not any(
            kw.arg == "id" and isinstance(kw.value, ast.Constant) and kw.value.value == gid
            for kw in node.keywords
        ):
            continue
        lines = src.splitlines(keepends=True)
        offset = sum(len(line) for line in lines[: node.lineno - 1])
        j = src.find("shared_rules=(", offset)
        if j < 0:
            return None
        k = src.find(")", j)
        return (j, k)
    return None


def leg_c1_static_wiring(b: dict) -> tuple[bool, str]:
    """@THREE_ORACLES is in the shared_rules of G3, G8 and G9 (parsed, not grepped)."""
    missing = []
    for gid in ("G3", "G8", "G9"):
        span = gate_shared_rules_span(b["src"], gid)
        if span is None:
            missing.append(f"{gid} (no shared_rules)")
            continue
        if "THREE_ORACLES" not in b["src"][span[0]:span[1]]:
            missing.append(gid)
    return (not missing, f"gates without the rule: {missing or 'none'}")


def leg_c3_mutation_control(b: dict) -> tuple[bool, str]:
    """The mutation controls exist: the guard rejects a dropped doc leg and a relaxed count."""
    required = [
        "test_guard_rejects_missing_documentation_leg",
        "test_guard_rejects_relaxed_per_aspect_count",
    ]
    defined = set(re.findall(r"^def (test_[a-z0-9_]+)", b["tests"], re.M))
    missing = [t for t in required if t not in defined]
    return (not missing, f"{len(required)} control(s); missing: {missing or 'none'}")


def leg_c4_invariant(b: dict) -> tuple[bool, str]:
    """The triad-slot invariant is asserted for every variant."""
    defined = set(re.findall(r"^def (test_[a-z0-9_]+)", b["tests"], re.M))
    ok = "test_triad_slot_in_all_variants" in defined
    return (ok, "triad-slot invariant asserted" if ok else "no triad-slot invariant test")


def leg_e1_artifact_readback(b: dict) -> tuple[bool, str]:
    """The built product artifact on disk carries the rule block."""
    has_header = RULE_HEADER in b["artifact"]
    has_slot = "legs" in b["artifact"] and "unique_detection" in b["artifact"]
    return (has_header and has_slot, f"header={has_header}, triad slot={has_slot}, artifact={b['artifact_path']}")


def leg_e2_observed_vs_prediction(b: dict) -> tuple[bool, str]:
    """All four rendered variants carry a byte-identical rule block, and it is the
    text declared in source.py."""
    blocks = {name: rule_block(text) for name, text in b["renders"].items()}
    empty = [name for name, block in blocks.items() if not block]
    identical = len({block for block in blocks.values() if block}) == 1 and not empty
    carries = all(b["rule_text"] in block for block in blocks.values() if block) and not empty
    detail = f"variants={len(blocks)}, empty={empty or 'none'}, identical={identical}, carries source text={carries}"
    return (identical and carries, detail)


def leg_e3_e2e(b: dict) -> tuple[bool, str]:
    """The measured suite is GREEN and the INSTALLED receiver matches the pinned baseline.

    A closed plan's recorded suite result is a frozen history, not a live expectation —
    the suite grows every time a plan lands, so the live check is: no failures at all,
    and the production prompt on disk equals the sha the baseline pins.
    """
    s = b["suite"]
    installed_sha = hashlib.sha256(INSTALLED.read_bytes()).hexdigest()
    pinned = json.loads((ROOT / "prompt_kernel" / "baseline.json").read_text(encoding="utf-8"))["production"]["sha256"]
    detail = (
        f"measured {s['passed']} passed / {s['failed']} failed; "
        f"installed sha {installed_sha[:16]} vs pinned {pinned[:16]}"
    )
    ok = s["failed"] == 0 and installed_sha.lower() == pinned.lower()
    return (ok, detail)


LEGS = {
    "D": [("D1", "traceability", leg_d1_traceability), ("D3", "executable examples", leg_d3_examples), ("D5", "doc<->contract diff", leg_d5_contract_diff)],
    "C": [("C1", "static wiring", leg_c1_static_wiring), ("C3", "mutation control", leg_c3_mutation_control), ("C4", "invariant", leg_c4_invariant)],
    "E": [("E1", "built-artifact read-back", leg_e1_artifact_readback), ("E2", "observed vs prediction", leg_e2_observed_vs_prediction), ("E3", "end-to-end suite", leg_e3_e2e)],
}


# ---------------------------------------------------------------- defects


def defect_d1_pin(b: dict) -> dict:
    """The glossary points at a line that does not exist."""
    m = dict(b)
    # The pin moves as the kernel grows (1065 -> 1063 on 2026-10-20), so the defect
    # takes whatever pin is there now instead of a hardcoded line number.
    m["glossary"] = re.sub(r"(prompt_kernel/source\.py:)\d+", r"\g<1>9999", b["glossary"], count=1)
    return m


def defect_d5_family(b: dict) -> dict:
    """The glossary catalogue drops a family the rule declares."""
    m = dict(b)
    m["glossary"] = re.sub(r"E5 differential\s*/\s*back-to-back", "(removed by the probe)", b["glossary"])
    return m


def defect_d3_test(b: dict) -> dict:
    """The plan cites a smoke test that does not exist."""
    m = dict(b)
    m["plan"] = b["plan"].replace("test_triad_slot_in_all_variants", "test_triad_slot_in_all_variants_renamed")
    return m


def defect_c1_wiring(b: dict) -> dict:
    """G3 loses the rule in its shared_rules."""
    m = dict(b)
    span = gate_shared_rules_span(b["src"], "G3")
    if span is None:
        raise SystemExit("probe defect: G3 shared_rules span not found")
    j, k = span
    m["src"] = b["src"][:j] + b["src"][j:k].replace(', "THREE_ORACLES"', "") + b["src"][k:]
    return m


def defect_c3_guard(b: dict) -> dict:
    """The mutation-control test is renamed away."""
    m = dict(b)
    m["tests"] = b["tests"].replace("def test_guard_rejects_missing_documentation_leg", "def _probe_mutation_control")
    return m


def defect_c4_invariant(b: dict) -> dict:
    """The triad-slot invariant test is renamed away."""
    m = dict(b)
    m["tests"] = b["tests"].replace("def test_triad_slot_in_all_variants", "def _probe_invariant")
    return m


def defect_e1_artifact(b: dict) -> dict:
    """The built artifact on disk no longer carries the rule block."""
    m = dict(b)
    m["artifact"] = b["artifact"].replace(RULE_HEADER, "#### (removed by the probe)")
    return m


def defect_e2_source(b: dict) -> dict:
    """The declared rule text changes while the renders still carry the old one."""
    m = dict(b)
    mutated = b["src"].replace(
        "An aspect with fewer is a degenerate simplex:",
        "An aspect with fewer is a degenerate simplex (probe):",
        1,
    )
    m["src"] = mutated
    m["rule_text"] = rule_text_from_source(mutated)
    return m


def defect_e3_record(b: dict) -> dict:
    """A failure appears in the measured suite."""
    m = dict(b)
    s = dict(b["suite"])
    s["failed"] = s["failed"] + 1
    s["passed"] = s["passed"] - 1
    m["suite"] = s
    return m


DEFECTS = {
    "D": [("M-D1", "glossary pin points at a line that does not exist", defect_d1_pin),
           ("M-D3", "plan cites a smoke test that does not exist", defect_d3_test),
           ("M-D5", "glossary catalogue drops a family the rule declares", defect_d5_family)],
    "C": [("M-C1", "G3 loses the rule in shared_rules", defect_c1_wiring),
           ("M-C3", "mutation-control test renamed away", defect_c3_guard),
           ("M-C4", "triad-slot invariant test renamed away", defect_c4_invariant)],
    "E": [("M-E1", "built artifact no longer carries the rule block", defect_e1_artifact),
           ("M-E2", "declared rule text drifts from the rendered block", defect_e2_source),
           ("M-E3", "measured suite result drifts from the plan's record", defect_e3_record)],
}


# ---------------------------------------------------------------- run


def main() -> int:
    bundle = build_bundle()
    lines: list[str] = []
    add = lines.append

    add("# Receipts — criterion K1 (the first 3x3 criterion on our own project)")
    add("")
    add("Criterion: **@THREE_ORACLES is declared in the kernel, wired to G3/G8/G9,")
    add("documented in the project glossary, and exercised by the kernel suite.**")
    add("")
    add(f"- bundle: source `{SRC.relative_to(ROOT)}`, tests `{TESTS.relative_to(ROOT)}`, "
        f"glossary `{GLOSSARY.relative_to(ROOT)}`, plan `{PLAN.relative_to(ROOT)}`")
    add(f"- built artifact read back: `{bundle['artifact_path']}`")
    add(f"- measured suite: {bundle['suite']['passed']} passed / {bundle['suite']['failed']} failed "
        f"(exit {bundle['suite']['exit']})")
    add(f"- installed product prompt carries the rule: "
        f"{'yes' if RULE_HEADER in INSTALLED.read_text(encoding='utf-8') else 'NO — not installed'}")
    add("")
    add("## Baseline")
    add("")
    add("| aspect | leg | family | verdict | detail |")
    add("|---|---|---|---|---|")
    baseline = {}
    for aspect, legs in LEGS.items():
        for lid, name, fn in legs:
            ok, detail = fn(bundle)
            baseline[lid] = ok
            add(f"| {aspect} | {lid} | {name} | {'PASS' if ok else 'FAIL'} | {detail} |")
    add("")

    add("## Injected defects — who catches, who misses")
    add("")
    add("| defect | injected | leg that caught it | legs that MISSED it | receipt |")
    add("|---|---|---|---|---|")
    receipts = []
    for aspect, defects in DEFECTS.items():
        legs = LEGS[aspect]
        for did, what, mutate in defects:
            mutated = mutate(bundle)
            caught, missed = [], []
            for lid, _name, fn in legs:
                ok, _detail = fn(mutated)
                if ok == baseline[lid]:
                    missed.append(lid)
                else:
                    caught.append(lid)
            holds = len(caught) == 1
            receipts.append((aspect, did, what, caught, missed, holds))
            add(f"| {did} | {what} | {', '.join(caught) or '—'} | {', '.join(missed) or '—'} | "
                f"{'HOLDS' if holds else 'FAILS (not unique)'} |")
    add("")

    add("## Verdict per aspect")
    add("")
    subsumed = []
    for aspect, legs in LEGS.items():
        uniq = []
        for lid, name, _fn in legs:
            holders = [r for r in receipts if r[0] == aspect and lid in r[3]]
            if len(holders) == 1 and holders[0][5]:
                uniq.append(lid)
            else:
                subsumed.append(lid)
        add(f"- **{aspect}**: {len(uniq)} leg(s) with a unique-detection receipt "
            f"({', '.join(uniq) or 'none'}) — "
            f"{'COVERED (>=3)' if len(uniq) >= 3 else 'DEGENERATE SIMPLEX (<3)'}")
    add("")
    if subsumed:
        add(f"Legs without a unique receipt (subsumed, do not count): {', '.join(subsumed)}")
    else:
        add("Every leg carries a unique-detection receipt.")

    out = Path(__file__).resolve().parent / "RECEIPTS.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
