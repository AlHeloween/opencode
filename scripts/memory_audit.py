"""The oracle for the delegator's memory folder (t127).

`python scripts/memory_audit.py <folder> [--baseline <manifest.json>]`

It checks acceptance 1-5 of the t127 order and prints a verdict per file
(OK / FAIL with the reason). Exit code 0 = the folder is in our style, 1 = at
least one FAIL. The script is read-only: it never writes to the folder.

  1  every topic file carries its OWN @SV_FORMAT block (form, unique label,
     chain, parent) and the block is computed from that file alone
  2  every [[link]] resolves to an existing file's name:, under one naming
     convention; the index names every file exactly once, STEP 0 first, and is
     byte-identical to a regeneration inside the app's own load limits
  3  one fact in one place: the STALE / CONTRADICTED verdicts of the t124 audit
     are resolved in the file's own text, and the orphan files carry their mark
  4  MEMORY.md is mechanical (checked by regenerating it and comparing bytes)
  5  no evidence is lost: every owner quote, receipt and measured number of the
     baseline manifest is still present

  6  the MEANING checks of the owner's review 1 (t127, 2026-10-21) — each of
     them is a FORM check, because the meaning itself is authored by reading
     the file (scripts/memory_authoring.py) and a script cannot invent it:
     a  the top keyword is not a type word, a date or a version;
     b  the keyword weights are highest first;
     c  no keyword and no title word is what the file marks as NOT;
     d  STEP 0 is the index's line 1, verbatim;
     e  no index line ends inside an abbreviation;
     f  a title keeps the file's own casing (plain case, identifiers excepted);
     g  no CURRENT description contradicts a HISTORICAL mark in its own body.

The expectation table below is the t124 verdict (REPORT.md §4) carried forward:
it says WHICH files were stale, which contradicted, and which lost their
transcript — and what each of them must now say.
"""

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

# A keyword that is a date or a version is a LABEL, not an axis (owner, review 1).
DATE_RE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
VERSION_RE = re.compile(r"^\d+(\.\d+)+$")


def current_contradicts_history(desc, body):
    """-> the reason, when a CURRENT description repeats a state that the file's
    own body marks HISTORICAL (the owner's check 7: «no CURRENT description
    contradicts a HISTORICAL mark in its own body»)."""
    if "CURRENT" not in desc.upper():
        return None
    words = {w.lower().strip(".,;:!?()[]«»\"'") for w in desc.split()}
    words = {w for w in words if len(w) > 3 and w.isalpha()}
    for para in re.split(r"\n\s*\n", body):
        upper = para.upper()
        if "HISTORICAL" not in upper and "HISTORY" not in upper:
            continue
        claim = para.split(":")[0].lower()
        hit = {w for w in words if re.search(r"\b" + re.escape(w) + r"\b", claim)}
        if len(hit) >= 2:
            return f"the description repeats the state the body marks historical ({', '.join(sorted(hit))})"
    return None

_spec = importlib.util.spec_from_file_location("memory_lib", Path(__file__).resolve().parent / "memory_lib.py")
ml = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ml)

# The t127 goal: every file's vector names the goal that organised it.
PARENT_GOAL_MD5 = "c7218c11076948a099404504393f1f50"

# The index's first entry — the file the delegator must read first.
STEP0 = "project_after_rebuild_2026_10_21.md"

# The app's own load limits for the index (code.claude.com/docs/en/memory).
INDEX_MAX_LINES = 200
INDEX_MAX_BYTES = 25_600

# t124 REPORT.md §4.1 — the 15 STALE files: the stale pointer must be gone and
# the current one present, or the file must carry a HISTORICAL marker of its own.
STALE = {
    "feedback_code_review_order.md": (
        "plans/2026-09-07_cache-markers-anthropic-only.md",
        "plans_completed/2026-09-07_cache-markers-anthropic-only.md",
    ),
    "feedback_no_wire_work.md": (
        "plans/2026-09-24_gateway-three-point-capture.md",
        "plans_completed/2026-09-24_gateway-three-point-capture.md",
    ),
    "feedback_drive_opencode_via_server_api.md": (".claude/skills/opencode-bridge/SKILL.md", None),
    "feedback_outside_falsifier_on_the_kernel_diff.md": ("tools/aicall.py", None),
    "project_after_rebuild_2026_10_21.md": (
        "plans/2026-10-21_robot-pending-stop-hook_1.md",
        "plans/2026-10-21_robot-pending-stop-hook.md",
    ),
    "project_clientsoft_viewer_module_2026_10_03.md": ("plans/2026-10-03_rsdisplay_boxes.md", None),
    "project_deepseek_cot_context_ratchet.md": (
        "plans/2026-10-02_announce-then-stop.md",
        "plans_completed/2026-10-02_announce-then-stop.md",
    ),
    "project_framework_lineage_adid_bge_kernel.md": ("docs/ADID_Framework_15_3.md", None),
    "project_local_development_hard_fork.md": ("external/opencode-1.18.29", None),
    "project_upstream_carries_prompt_injection.md": ("external/opencode-1.18.29", None),
    "project_robot_loop_state_2026_10_02.md": ("plans/2026-10-02_one-server-per-worktree.md", None),
    "project_state_2026_10_17_cross_lane.md": ("plans/2026-10-03_rsdisplay_boxes.md", None),
    "project_sv_md5_generative_closed.md": (
        "plans/2026-10-17_sv-legend-generative.md",
        "plans_completed/2026-10-17_sv-legend-generative.md",
    ),
    "sv_journal_session_c12b531d.md": (
        "plans/futures/2026-10-15_dais-peer-trust-reward.md",
        "plans/2026-10-15_dais-peer-trust-reward.md",
    ),
    "project_opencode_tui_triage_handoff.md": ("stash@{0}", None),
}

# t124 REPORT.md §4.2 — the one CONTRADICTED file: the current fact lives in the
# file, the index carries only a pointer.
CONTRADICTED = {
    "project_state_2026_10_18_legislator.md": {
        "description_must_not_contain": ["10.0.1435", "t84 live everywhere"],
        "description_must_contain": ["10.0.1482"],
    },
}

# t124 REPORT.md §4.4 / §7 — the 28 files whose origin transcript the app
# deleted. They are MARKED, never silently retired (retiring needs the owner).
ORPHANS = [
    "feedback_adm_rag_then_codegraph_recall.md",
    "feedback_architect_frames_delegates_debugging.md",
    "feedback_code_review_order.md",
    "feedback_drive_opencode_via_server_api.md",
    "feedback_ground_config_in_verified_tool_state.md",
    "feedback_kernel_cuts_need_explicit_approval.md",
    "feedback_label_omissions_no_boilerplate.md",
    "feedback_no_inline_js_oneliners_in_shell.md",
    "feedback_no_wire_work.md",
    "feedback_outside_falsifier_on_the_kernel_diff.md",
    "feedback_say_when_a_step_is_impossible.md",
    "feedback_smoke_artifacts_and_mark_claims.md",
    "feedback_tui_tail_is_history_not_screen.md",
    "feedback_write_the_edge_at_the_fork.md",
    "feedback_your_choice_is_not_consent_to_pay.md",
    "project_antigravity_playwright_driver_404.md",
    "project_claude_host_has_no_window_oracle.md",
    "project_code_test_two_files_trap.md",
    "project_coderenderable_no_filetype_repaints_plain.md",
    "project_framework_lineage_adid_bge_kernel.md",
    "project_kernel_runtime_consumers.md",
    "project_prompt_kernel_claude_variant.md",
    "project_universal_search_chromium_9222.md",
    "project_upstream_carries_prompt_injection.md",
    "reference_kernel_build_and_install.md",
    "reference_minified_binary_verify_by_shape.md",
    "reference_streamlake_vanchin_gateway.md",
    "user_prefers_dense_concrete_instructions.md",
]

ORPHAN_MARK = "origin transcript deleted by the app"
ORPHAN_RECHECK = "re-checked against"

# A kernel rule must be pointed to by tag, never restated. The check is scoped to
# the file's DESCRIPTION — the one line that enters the index and the delegator's
# context: a paraphrase there is a stale copy of the rule. A mention in the body
# is the delegator's dated testimony (with the owner's words), and it stays.
KERNEL_RULE_TAGS = {
    "@THREE_ORACLES": ("three oracles", "three required oracles", "3x3", "3×3", "three-by-three"),
    "@REWARD_FUNCTION": ("reward function",),
    "@SMOKE_BEFORE": ("smoke before",),
    "@DIVERGENCE_PROTOCOL": ("divergence protocol",),
    "@TEST_INVARIANT": ("test invariant",),
    "@INFOMARK": ("infomark",),
    "@STATUS_CLAIM": ("status claim",),
    "@KAIZEN": ("kaizen",),
}


class Report:
    def __init__(self):
        self.files = {}
        self.checks = {}

    def fail(self, fname, reason):
        self.files.setdefault(fname, []).append(reason)
        return False

    def ok(self, fname):
        self.files.setdefault(fname, [])
        return True

    def count(self, kind, n=1):
        self.checks[kind] = self.checks.get(kind, 0) + n


def load_folder(folder):
    topic_files = sorted(p for p in folder.glob("*.md") if p.name != ml.INDEX_NAME)
    texts = {p.name: ml.read_text(p) for p in topic_files}
    index_path = folder / ml.INDEX_NAME
    index_text = ml.read_text(index_path) if index_path.exists() else ""
    return topic_files, texts, index_text


def check_file(rep, name, text, names, used_labels, labels):
    fm = ml.parse_frontmatter(text)
    stem = Path(name).stem

    # --- frontmatter ------------------------------------------------------
    if not fm:
        return rep.fail(name, "no frontmatter")
    if fm.get("metadata.node_type") != "memory":
        rep.fail(name, f"metadata.node_type != memory ({fm.get('metadata.node_type')!r})")
    mtype = fm.get("metadata.type", "")
    if mtype not in ml.TYPES:
        rep.fail(name, f"metadata.type {mtype!r} is not one of {ml.TYPES}")
    want_name = ml.canonical_name(stem)
    if fm.get("name") != want_name:
        rep.fail(name, f"name: {fm.get('name')!r} != the convention {want_name!r}")
    origin = fm.get("metadata.originSessionId", "")
    if not origin:
        if "the origin session id was never written" not in text:
            rep.fail(name, "metadata.originSessionId is empty and the file does not say why")
    elif not (ml.HEX32_RE.match(origin.replace("-", "")) or origin.startswith("robot-")):
        rep.fail(name, f"metadata.originSessionId {origin!r} is neither a uuid nor a robot-… marker")

    # --- the vector -------------------------------------------------------
    sv = ml.read_sv(text)
    if not sv:
        return rep.fail(name, "no @SV_FORMAT block")
    kws = ml.sv_keywords(sv.get("Keywords", ""))
    if not 3 <= len(kws) <= 9:
        rep.fail(name, f"Keywords: {len(kws)} terms (3..9)")
    if len({t for t, _ in kws}) != len(kws):
        rep.fail(name, "Keywords: repeated term")
    total = round(sum(w for _, w in kws), 2)
    if abs(total - 1.0) > 0.005:
        rep.fail(name, f"Keywords: weights sum to {total}, not 1.0")
    weights = [w for _, w in kws]
    if weights != sorted(weights, reverse=True):
        rep.fail(name, f"Keywords: the weights are not highest first ({weights})")
    if kws:
        top = kws[0][0]
        if top.lower() in ml.TYPES:
            rep.fail(name, f"the top keyword {top!r} is the type word, not an axis")
        if DATE_RE.match(top):
            rep.fail(name, f"the top keyword {top!r} is a date, not an axis")
        if VERSION_RE.match(top):
            rep.fail(name, f"the top keyword {top!r} is a version, not an axis")
    dominant = sv.get("Semantic dominant", "")
    if dominant == ml.dominant_of(fm.get("description", "")):
        rep.fail(name, "the dominant is a copy of the description — it carries no meaning of its own")
    if ";" not in dominant:
        rep.fail(name, "the dominant carries no rule and why (a ';' between them)")
    forbidden = ml.forbidden_terms(ml.meaning_text(text))
    for term, _w in kws:
        parts = {term.lower()} | {p for p in term.lower().split("-") if len(p) > 2}
        bad = parts & forbidden
        if bad:
            rep.fail(name, f"the keyword {term!r} asserts {sorted(bad)[0]!r}, which the file marks as NOT")
    title = ml.title_for(name, text)
    for reason in ml.title_findings(title, ml.meaning_text(text)):
        rep.fail(name, f"the title {title!r}: {reason}")
    for word in re.findall(r"[A-Za-z][A-Za-z0-9']*", title):
        if word.lower() in forbidden:
            rep.fail(name, f"the title {title!r} asserts {word!r}, which the file marks as NOT")
    contradiction = current_contradicts_history(fm.get("description", ""), ml.body_of(text))
    if contradiction:
        rep.fail(name, contradiction)
    if not ml.HEX32_RE.match(sv.get("md5", "")):
        rep.fail(name, f"md5 {sv.get('md5')!r} is not 32 hex")
    elif sv["md5"] in used_labels:
        rep.fail(name, f"md5 {sv['md5']} is used by more than one file")
    else:
        used_labels[sv["md5"]] = name
    if not ml.HEX32_RE.match(sv.get("prev-md5", "")):
        rep.fail(name, f"prev-md5 {sv.get('prev-md5')!r} is not 32 hex")
    parent = sv.get("parent-goal-md5", "")
    if parent != PARENT_GOAL_MD5 and parent not in labels:
        rep.fail(name, f"parent-goal-md5 {parent!r} is neither the t127 goal nor a file's own label")
    if ml.LEGEND not in sv.get("_block", ""):
        rep.fail(name, "the legend line is missing from the SV block")

    # --- links ------------------------------------------------------------
    for target, line in ml.scan_links(ml.meaning_text(text)):
        if target not in names:
            rep.fail(name, f"line {line}: [[{target}]] resolves to no file")

    # --- the t124 verdicts ------------------------------------------------
    if name in STALE:
        stale, fixed = STALE[name]
        if stale in text and "HISTORICAL" not in text:
            if not fixed:
                rep.fail(name, f"STALE pointer {stale!r} is still in the file and no HISTORICAL marker names it")
            elif fixed not in text:
                rep.fail(name, f"STALE pointer {stale!r} was not repointed to {fixed!r}")
    if name in CONTRADICTED:
        rules = CONTRADICTED[name]
        desc = fm.get("description", "")
        for bad in rules.get("description_must_not_contain", []):
            if bad in desc:
                rep.fail(name, f"the description still carries the stale fact {bad!r}")
        for good in rules.get("description_must_contain", []):
            if good not in desc:
                rep.fail(name, f"the description does not carry the current fact {good!r}")
    if name in ORPHANS:
        if ORPHAN_MARK not in text:
            rep.fail(name, "orphan: the deleted origin transcript is not marked in the file")
        elif ORPHAN_RECHECK not in text and "NOT re-checkable from the robot" not in text:
            rep.fail(name, "orphan: the mark does not name the artefact the claim was re-checked against")

    # --- kernel rules are pointed to by tag, never restated ---------------
    desc_low = fm.get("description", "").lower()
    for tag, triggers in KERNEL_RULE_TAGS.items():
        if any(t in desc_low for t in triggers) and tag not in text:
            rep.fail(name, f"its description restates the {tag} rule without pointing to {tag}")

    rep.ok(name)


def main():
    ap = argparse.ArgumentParser(description="audit the delegator's memory folder")
    ap.add_argument("folder")
    ap.add_argument("--baseline", help="a manifest written by memory_index.py baseline")
    ap.add_argument("--quiet", action="store_true", help="print only the summary")
    args = ap.parse_args()

    folder = Path(args.folder)
    if not folder.is_dir():
        print(f"FAIL: {folder} is not a directory")
        return 2

    topic_files, texts, index_text = load_folder(folder)
    rep = Report()

    names = {}
    for name, text in texts.items():
        fm = ml.parse_frontmatter(text)
        n = fm.get("name", "")
        if n in names:
            rep.fail(name, f"name: {n!r} is already used by {names[n]}")
        names[n] = name

    used_labels = {}
    labels = {}
    for name, text in texts.items():
        sv = ml.read_sv(text)
        if sv and ml.HEX32_RE.match(sv.get("md5", "")):
            labels[sv["md5"]] = name
    for name, text in texts.items():
        check_file(rep, name, text, names, used_labels, labels)

    # --- the index --------------------------------------------------------
    index_path = folder / ml.INDEX_NAME
    entries = ml.index_entries(index_text)
    if not index_path.exists():
        rep.fail(ml.INDEX_NAME, "the index does not exist")
    else:
        raw = index_path.read_bytes()
        if len(raw) > INDEX_MAX_BYTES:
            rep.fail(ml.INDEX_NAME, f"{len(raw)} bytes > the app's {INDEX_MAX_BYTES}-byte load limit")
        lines = index_text.splitlines()
        if len(lines) > INDEX_MAX_LINES:
            rep.fail(ml.INDEX_NAME, f"{len(lines)} lines > the app's {INDEX_MAX_LINES}-line load limit")
        targets = [t for _, t, _ in entries]
        if len(targets) != len(set(targets)):
            rep.fail(ml.INDEX_NAME, "the index names a file twice")
        missing = sorted(set(texts) - set(targets))
        if missing:
            rep.fail(ml.INDEX_NAME, f"the index does not name {len(missing)} file(s): {missing[:5]}")
        extra = sorted(set(targets) - set(texts))
        if extra:
            rep.fail(ml.INDEX_NAME, f"the index names {len(extra)} file(s) that do not exist: {extra[:5]}")
        if targets and targets[0] != STEP0:
            rep.fail(ml.INDEX_NAME, f"the first entry is {targets[0]!r}, not the STEP 0 file {STEP0!r}")
        # --- the ORDER is the index's line 1, verbatim -------------------------
        first_line = lines[0] if lines else ""
        if first_line != ml.STEP0_TEXT:
            rep.fail(ml.INDEX_NAME, f"the index's line 1 is {first_line[:70]!r}, not the STEP 0 order verbatim")
        # the generated index vs the file on disk
        generated = ml.render_index(
            [
                (
                    ml.title_for(t, texts[t]),
                    t,
                    ml.summary_of((ml.read_sv(texts[t]) or {}).get("Semantic dominant", "")),
                )
                for t in targets
                if t in texts
            ]
        )
        if generated.replace("\n", "\r\n") != index_text and generated != index_text:
            want = generated.replace("\n", "\r\n")
            for i, (a, b) in enumerate(zip(want.splitlines(), index_text.splitlines())):
                if a != b:
                    rep.fail(ml.INDEX_NAME, f"the index differs from the generator at line {i + 1}: {b[:90]!r} != {a[:90]!r}")
                    break
            else:
                rep.fail(ml.INDEX_NAME, "the index is not what the generator produces (hand-edited or stale)")
        for title, target, summary in entries:
            if target not in texts:
                continue
            want_title = ml.title_for(target, texts[target])
            want_summary = ml.summary_of((ml.read_sv(texts[target]) or {}).get("Semantic dominant", ""))
            if title != want_title:
                rep.fail(ml.INDEX_NAME, f"the line for {target} has the title {title!r}, not {want_title!r}")
            if summary != want_summary:
                rep.fail(ml.INDEX_NAME, f"the line for {target} has a summary that is not the file's own rule clause")
            frag = ml.ends_inside_abbreviation(summary)
            if frag:
                rep.fail(ml.INDEX_NAME, f"the line for {target} ends inside an abbreviation: {frag!r}")

    # --- evidence ---------------------------------------------------------
    if args.baseline:
        base = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
        now = set()
        for text in texts.values():
            now |= ml.body_tokens(text)
        lost = sorted(set(base["tokens"]) - now)
        if lost:
            rep.fail("MEMORY.md", f"{len(lost)} evidence token(s) of the baseline are gone: {lost[:5]}")

    # --- report -----------------------------------------------------------
    failures = {k: v for k, v in rep.files.items() if v}
    if not args.quiet:
        for name in sorted(texts):
            reasons = rep.files.get(name, [])
            print(f"{'OK  ' if not reasons else 'FAIL'} {name}" + ("" if not reasons else "  <- " + "; ".join(reasons)))
        for name in sorted(set(rep.files) - set(texts)):
            print(f"FAIL {name}  <- " + "; ".join(rep.files[name]))
    print()
    print(f"files: {len(texts)} | links: {sum(len(ml.scan_links(t)) for t in texts.values())} | "
          f"index lines: {len(entries)} | index bytes: {len(index_path.read_bytes()) if index_path.exists() else 0}")
    if failures:
        print(f"FAIL: {len(failures)} file(s) with findings")
        return 1
    print("PASS: the folder is in our style")
    return 0


if __name__ == "__main__":
    sys.exit(main())
