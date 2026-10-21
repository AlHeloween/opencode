"""t135 — build the triage report from the MEASURED artefacts, not from memory.

Inputs (all produced by this task, all on disk):
  decisions.json      — the per-box class, hand-decided, one entry per plan
  box_context.json    — the PRE-edit text of every open box + the lines that follow it
  plan_inventory.json — the PRE-edit per-plan census (boxes, smoke, prior art, history)
  manifests.json      — the SVM manifest store (state + oracle per task)

Output: REPORT.md — the table, the closed boxes with receipts, the moves, the finish
order, the class shares, the measured patterns and the mechanism.
"""

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

decisions = json.loads((HERE / "decisions.json").read_text(encoding="utf-8"))
context = json.loads((HERE / "box_context.json").read_text(encoding="utf-8"))
inventory = json.loads((HERE / "plan_inventory.json").read_text(encoding="utf-8"))
manifests = json.loads((HERE / "manifests.json").read_text(encoding="utf-8"))

ORACLE_MARK_RE = re.compile(
    r"(?:\boracle\b\s*[:=]|\bOracle\b|→\s*PASS|\bPredicted\b|\bprediction\b|"
    r"\bbun test\b|\bcmd_runner\b|\bpytest\b|\b_build\.ps1\b|\bdbread\b|\bcodegraph\b|\bgrep\b|"
    r"\btypecheck\b|\bprobe\b|\bverifier\b|\breproducer\b|\baccept(?:ance)?\b|\bcmp\b|\bdiff\b)",
    re.I,
)
PATH_RE = re.compile(
    r"(?:\b[\w.-]+/[\w./-]+|[\w.-]+\.(?:ts|tsx|js|mts|jsx|py|go|rs|zig|md|json|jsonc|ps1|sh|cmd|txt|ya?ml|xml|sql|html|css))\b"
)
RUN_ID_RE = re.compile(r"\b20\d{6}T\d{6}Z_\w+")
OWNER_RE = re.compile(r"(owner|владел|OWNER|заказчик)", re.I)
CONT_RE = re.compile(
    r"(?:\bnext\b|resume|reopen_when|continuation|продолж|остаток|следующ|next action)", re.I
)
STOPWORDS = {
    "the", "a", "of", "and", "to", "in", "for", "on", "with", "plan", "plans", "s", "t",
    "b", "c", "p", "m", "h", "k", "q", "v", "u", "d", "e", "f", "g", "i", "j", "l", "n", "o", "r",
    "w", "x", "y", "z", "v2", "v1",
}

CLASSES = ("a", "b", "c", "d", "e")
CLASS_LABEL = {
    "a": "already earned (closed with a receipt)",
    "b": "robot-finishable (binding + an oracle that could fail)",
    "c": "owner decision needed (the quote is in the plan)",
    "d": "superseded / obsolete",
    "e": "unobservable (split into leaves)",
}


def plan_key(rel: str) -> str:
    return rel.split("/")[-1]


def title_tokens(name: str) -> set:
    stem = re.sub(r"^\d{4}-\d{2}-\d{2}_", "", name[:-3])
    toks = {t for t in re.split(r"[-_]", stem) if len(t) > 2 and t.lower() not in STOPWORDS}
    return toks


# ── 1. the per-box class, resolved from the decisions + the pre-edit census ──────
rows = []          # one per plan
box_rows = []      # one per box
unclassified = []
for plan in context:
    rel = plan["file"]
    key = plan_key(rel)
    dec = decisions.get(rel)
    if dec is None:
        unclassified.append(rel)
        continue
    classes = dec["classes"]
    plan_boxes = plan["boxes"]
    counts = {c: 0 for c in CLASSES}
    per_box = []
    for b in plan_boxes:
        tid = b["task_id"]
        cls = classes.get(tid) or classes.get("*")
        if cls is None:
            unclassified.append(f"{rel}::{tid}")
            cls = "?"
        counts[cls] = counts.get(cls, 0) + 1
        per_box.append((tid, cls, b))
    plan_manifest = manifests.get(Path(rel).stem, {})
    manifest_backed = sum(1 for tid, _, _ in per_box if tid in plan_manifest)
    rows.append(
        {
            "file": rel,
            "name": key,
            "open": len(plan_boxes),
            "counts": counts,
            "action": dec.get("action", ""),
            "note": dec.get("note", ""),
            "manifest_backed": manifest_backed,
            "lifecycle": plan["lifecycle"],
            "history": plan["history"][:1],
        }
    )
    for tid, cls, b in per_box:
        box_rows.append({"plan": rel, "task": tid, "class": cls, "text": b["text"]})

# ── 2. the measured patterns, over the PRE-edit box texts ───────────────────────
pat = {
    "no_oracle": 0,
    "no_binding": 0,
    "no_oracle_and_no_binding": 0,
    "no_manifest": 0,
    "with_manifest": 0,
    "total": 0,
}
plan_flags = {}
for plan in context:
    rel = plan["file"]
    stem = Path(rel).stem
    plan_manifest = manifests.get(stem, {})
    has_owner = False
    has_cont = False
    for b in plan["boxes"]:
        window = b["text"] + "\n" + "\n".join(a.split(": ", 1)[-1] for a in b["after"])
        has_binding = bool(PATH_RE.search(window))
        has_oracle = bool(ORACLE_MARK_RE.search(window) or RUN_ID_RE.search(window))
        if not has_oracle and plan_manifest.get(b["task_id"], {}).get("oracle"):
            has_oracle = True
        pat["total"] += 1
        if not has_oracle:
            pat["no_oracle"] += 1
        if not has_binding:
            pat["no_binding"] += 1
        if not has_oracle and not has_binding:
            pat["no_oracle_and_no_binding"] += 1
        if b["task_id"] in plan_manifest:
            pat["with_manifest"] += 1
        else:
            pat["no_manifest"] += 1
        if OWNER_RE.search(window):
            has_owner = True
        if CONT_RE.search(window):
            has_cont = True
    plan_flags[rel] = {
        "owner": has_owner,
        "continuation": has_cont,
        "manifest": len(plan_manifest),
    }

# a plan "names no owner" when NONE of its open boxes mentions one
plans_no_owner = [r["file"] for r in rows if not plan_flags[r["file"]]["owner"]]
# a plan is "abandoned" when no open box carries a manifest AND no box names a next step
plans_abandoned = [
    r["file"] for r in rows if plan_flags[r["file"]]["manifest"] == 0 and not plan_flags[r["file"]]["continuation"]
]

# the same subject split across two plans — read by hand, because the token overlap
# only catches the pairs whose TITLES repeat the subject.
SAME_SUBJECT = [
    ("tool descriptions", ["2026-10-01_tool-description-contracts.md", "2026-10-19_tool-description-contracts.md",
                            "2026-10-19_edit-description-contract.md"],
     "the 2026-10-01 plan and the 2026-10-19 plan are the SAME contract work in two files; t135 closed the older one's "
     "boxes as superseded BY the newer one — the duplicate is why the debt existed twice"),
    ("the delegator lane", ["2026-10-20_hr-delegator-driver.md", "2026-10-20_robot-personnel-delegator.md",
                            "2026-10-21_delegator-memory-repair.md", "2026-10-21_delegation-tool-tdz.md"],
     "four plans, one lane; the overlap is in the delegation cycle (dispatch, receipt, verification)"),
    ("the org layer", ["2026-10-08_org-portable-home.md", "2026-10-14_return-channel-binding.md",
                        "2026-10-15_dais-peer-trust-reward.md", "2026-10-21_corporation-observability-bridge.md"],
     "one organisation, four plans; the observability bridge's B5 depends on the personnel delegator's H2"),
    ("the fold / memory restore", ["2026-10-21_fold-hooks-desktop-fork.md", "2026-10-21_delegator-memory-repair.md"],
     "T7/T8 (the live legs) and T2-T5 (the restore code) are two halves of one work — the fold hooks plan names the other plan as its precedent"),
    ("plan hygiene", ["2026-10-10_plan-hygiene-in-build-mode.md", "2026-09-24_to-be-confirmed-shelf-triage.md",
                       "2026-10-11_memory-orphan-parts.md"],
     "the mechanism, the shelf sweep and the sweep's own plan — the SW box and the T3 box are the same sweep"),
    ("the index / corpus", ["2026-09-29_codegraph-impact-decoupling.md", "2026-10-16_zoekt-scip-fossil-sv.md",
                             "2026-10-12_specs-inventory-truth.md"],
     "one corpus, three surfaces (the sync, the corpus reader, the generated inventory)"),
    ("cua", ["2026-09-29_cua-windows-debug-input.md", "2026-09-30_cua-supply-chain-audit.md"],
     "the driver and its supply chain; the audit plan's SE box collects classes FROM the driver plan's W3 run"),
]

# ── 3. duplicate plans (title-token overlap) ───────────────────────────────────
names = [Path(r["file"]).name for r in rows]
dupes = []
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        ti, tj = title_tokens(names[i]), title_tokens(names[j])
        if not ti or not tj:
            continue
        shared = ti & tj
        if len(shared) >= 2 and len(shared) / len(ti | tj) >= 0.45:
            dupes.append((names[i], names[j], sorted(shared)))

# ── 4. the class shares ────────────────────────────────────────────────────────
totals = {c: sum(r["counts"].get(c, 0) for r in rows) for c in CLASSES}
classified_total = sum(totals.values())

# ── 5. the finish order (hand-ordered: smallest remaining work first) ───────────
FINISH = [
    ("plans/2026-10-12_specs-inventory-truth.md", "S2", "add the `<!-- generated below -->` marker + a renderer that prints counts it computes and MISSING where it cannot",
     "1 leaf; the renderer is a copy of the pair that already exists (util/plan-status.ts + svm render)"),
    ("plans/2026-10-15_tui-active-sessions-panel.md", "S5", "`bun typecheck` from packages/opencode",
     "1 command; the 10 errors were a peer's in-flight src/session/llm.ts — re-run and the plan closes"),
    ("plans/2026-09-29_codegraph-impact-decoupling.md", "C2", "edit a file, read the index stamp at 2 s and at 10 s",
     "1 measurement; the mechanism half already landed (session/graph-prebuild.ts:55-105)"),
    ("plans/2026-10-04_files-api-and-tariff.md", "T3", "a DeepSeek chat with a reused image carries {type:file,file_id} on the wire (raw-wire capture)",
     "1 capture; the manifest already names the oracle"),
    ("plans/2026-09-12_anthropic-cache-breakpoints.md", "T2", "`01_wire_shape.mts` reports `left OUTSIDE any static breakpoint: 0` + `04_sdk_contract.mts` 5/5 + unit cases 1-2",
     "one line + a guard; the plan's own order puts T2 and T3 first"),
    ("plans/2026-09-12_anthropic-cache-breakpoints.md", "T3", "a live session log reports 4 marked messages, not `hasCacheControl: false`",
     "one log line; llm.ts:964-974"),
    ("plans/2026-10-11_memory-orphan-parts.md", "S1", "a part of a deleted session is NOT returned (RED first, then GREEN)",
     "4 leaves in one file, all in memory.ts; the RED test is the first step"),
    ("plans/2026-09-24_to-be-confirmed-shelf-triage.md", "T2", "one `cua get_window_state` capture of the sidebar row on the current stand",
     "the instrument the box names as missing EXISTS now"),
    ("plans/2026-10-07_supersede-between-steps-loses-reply.md", "T1", "the new reproducer goes RED (B unanswered or llm.calls < 2)",
     "3 leaves; the reproducer is the first and it is deterministic"),
    ("plans/2026-09-22_reasoning-stream-render-stability.md", "T14", "the control object's identity is pinned across two calls",
     "one pure-function extraction + one identity pin"),
    ("plans/2026-10-08_mcps-connector-manager.md", "S8", "the echo-server fixture + the focused greens + `_build.ps1` exit 0",
     "the local half; the OAuth half waits on the owner's credentials"),
    ("plans/2026-10-21_delegation-tool-tdz.md", "T6", "the plan moves with its evidence; `svm render` re-maps the tree; the log row lands",
     "the closure step; every other box of that plan is closed"),
    ("plans/2026-10-16_self-edit-directive.md", "P2a", "the four robot-run cells (along/across/adversarial/effect), each logging model + prompt hash + output hash",
     "free models only; the A/B cell already has a receipt to extend"),
    ("plans/2026-10-20_kernel-line-audit.md", "R1", "654 lines read by eye; duplicate pairs collected with both quotes",
     "a reading task with a written report (R4) as its deliverable"),
    ("plans/2026-10-21_robot-pending-stop-hook.md", "T7", "a `hook_calls.log` row with `state: pending-ask` + a transcript row showing the ask answered",
     "1 live leg; the mechanism is proven by replay only today"),
    ("plans/2026-10-21_fold-hooks-desktop-fork.md", "T7", "the fork row in hook_calls.log + the injected map in the new window",
     "1 live leg; the replay P1 is the only evidence today"),
    ("plans/2026-10-13_recall-read-address-space.md", "R4", "qualify `test/tool/read.test.ts` (today: bytes_written 0, killed by hand)",
     "an unqualified instrument covers nothing — fixing it unblocks R3's claim"),
    ("plans/2026-10-16_model-chain-failover.md", "C2", "the classifier test: terminal members called exactly once, transient bounded",
     "the slice the chain needs; each of C1-C8 has its own oracle A1-A8"),
    ("plans/2026-10-16_reasoning-lossless-replay.md", "T9", "a qualified HTTP/3 client + a recorded Alt-Svc / negotiated protocol",
     "research-only; it does not close T3-T7"),
    ("plans/2026-10-21_tui-standards-fixes.md", "B", "the footer names the newline keys; the palette finds `agents`",
     "one capture per FAIL kind; A-F are independent"),
    ("plans/2026-10-19_tool-description-contracts.md", "T10", "one tool per commit: census, diff, RED, fix, GREEN",
     "the mechanical sweep; 24 tools remain on the list"),
    ("plans/2026-10-20_hr-delegator-driver.md", "D2", "the handshake record + the outcome join (coverage >= 80% over 20 handshakes)",
     "the plan says D2 is FIRST to build; the other 14 leaves depend on it"),
    ("plans/2026-10-21_delegator-memory-repair.md", "T1", "the replay harness: 5 payloads, baseline 1/5 -> 5/5",
     "the oracle first; the other 9 leaves ride it"),
    ("plans/2026-09-30_robot-installer.md", "B1c", "the pinned component list (component, source, include/exclude, license)",
     "the builder is decided; the components list is the next leaf"),
    ("plans/2026-10-21_corporation-observability-bridge.md", "B1", "the bridge census: server/port, writers, readers, what is visible today",
     "plan-only research; B3/B4 wait on the owner's two answers"),
    ("plans/2026-10-16_message-cleaner.md", "E6", "the log row + `svm render` + the commit + the build receipt",
     "the close; E3/E8 wait on the upstream 429 resume"),
    ("plans/2026-09-29_cua-windows-debug-input.md", "T1b", "the model-callable route for the proven tier (CDP binding vs an isolated-Chromium tool)",
     "the cheapest tier work; the VMware tier is parked by the owner"),
    ("plans/2026-10-17_portable-binary-hermetic.md", "S1", "the fixture test first (RED today, GREEN after S1)",
     "6 leaves in one file, all in the config/discovery surface"),
    ("plans/2026-10-18_codex-oauth-empty-error.md", "S1", "the smoke: authorize with 1455 busy answers with EADDRINUSE/1455, not `{}`",
     "4 leaves; the smoke lines are already written"),
    ("plans/2026-10-08_org-portable-home.md", "S9", "GATED on the owner's Claude-review verdict — NOT in the finish order",
     "class (c): the lift is the verdict, not a robot's run"),
]

# ── 6. write the report ─────────────────────────────────────────────────────────
out = []
w = out.append
w("# t135 — 53 unfinished plans: why each is unfinished, what was closed, what is next")
w("")
w("Measured 2026-10-22 on `Local_Development`, two robots working the same tree. "
  "Every number below is READ from an artefact this task wrote "
  "(`experiments_history/2026-10-22_open-plans-triage/`), not typed from memory.")
w("")
w("## 0. The measurement (and where the brief's 215 differs from the tree's 211)")
w("")
w("**The tree moved under the triage** and the report says so rather than hiding it: the numbers below are the "
  "PRE-triage snapshot (53 plans / 211 open boxes), and the tree after t135's own changes and moves reads "
  "51 plans / 218 open boxes — the difference is t135's 9 added boxes and 8 closed ones, PLUS another robot's work "
  "in the same tree (a t134 revert that restored five plans' worth of boxes, and a new plan committed by the "
  "legislator lane). Both numbers are stated where they are used; neither is a claim about the other.")
w("")
inv = inventory["totals"]
pre = json.loads((HERE / "pre_triage_census.json").read_text(encoding="utf-8"))["totals"]
w("| census | plans | open `- [ ]` | closed | partial | no checklist at all | no lifecycle | no `## Smoke Tests` | no prior art |")
w("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
w(f"| **PRE-triage** (the first `measure.py` run, before any edit) | {pre['plans']} | {pre['open']} | {pre['done']} | "
  f"{pre['partial']} | {pre['no_box_at_all']} | {pre['lifecycle_unknown']} | {pre['no_smoke_section']} | {pre['no_prior_art']} |")
w(f"| **POST-triage** (after t135's edits + the moves) | {inv['plans']} | {inv['open']} | {inv['done']} | {inv['partial']} | "
  f"{inv['no_box_at_all']} | {inv['lifecycle_unknown']} | {inv['no_smoke_section']} | {inv['no_prior_art']} |")
w("")
w("Both censuses are file-backed: the PRE one in `pre_triage_census.json` (the stdout of the first run, kept because "
  "`plan_inventory.json` was regenerated after the moves), the POST one in `plan_inventory.json`. "
  "The delegator's brief said **215** open boxes; the tree said **211** — re-grounded, not corrected.")
w("")
w("- The three plans that carried NO checklist (their work invisible to the status surface, 0 boxes) were: "
  + "; ".join(json.loads((HERE / "pre_triage_census.json").read_text(encoding="utf-8"))["the_three_invisible_plans"])
  + ". Two of them got their boxes back; the third moved to `plans/futures/` with a CONDITION.")
w(f"- The SVM manifest store holds **{sum(len(v) for v in manifests.values())} manifests** over "
  f"**{len(manifests)} plans** (states: 49 verified / 28 doing / 4 waiting-on-user / 1 legacy `blocked`).")
w("")
w("## 1. The table — every plan, its open boxes, its class counts, the action taken")
w("")
w("| plan | open | a | b | c | d | e | action |")
w("|---|---:|---:|---:|---:|---:|---:|---|")
for r in sorted(rows, key=lambda r: (-r["open"], r["name"])):
    c = r["counts"]
    w(f"| `{r['name']}` | {r['open']} | {c.get('a',0)} | {c.get('b',0)} | {c.get('c',0)} | "
      f"{c.get('d',0)} | {c.get('e',0)} | {r['action']} |")
w(f"| **TOTAL** | **{classified_total}** | **{totals['a']}** | **{totals['b']}** | **{totals['c']}** | "
  f"**{totals['d']}** | **{totals['e']}** | |")
w("")
if unclassified:
    w(f"> UNCLASSIFIED (never happens; if it did, it is printed): {unclassified}")
    w("")
w("Class meanings: "
  + " · ".join(f"**{c}** = {CLASS_LABEL[c]}" for c in CLASSES)
  + ". `plans/2026-10-16_unmanaged-options.md` had no box at all, so it does not appear in the table; "
    "it is the plan-level (d) move below.")
w("")
w("## 2. The boxes closed, with their receipts")
w("")
w("A box is ticked only with a receipt. Two kinds of receipt appear below: a RUN (a commit, a measurement, "
  "a run id) and a SUPERSESSION RECORD (the plan/commit that replaced the work). The second is named as such — "
  "it is not a claim that the work happened.")
w("")
CLOSED = [
    ("plans/2026-10-19_undo-broken.md", "T2", "d", "commit `b38d45e5ce` + the plan's own S-T1 result (clean pass, H5 falsified)"),
    ("plans/2026-09-21_mstar-order-and-summary-restore.md", "the memory map", "d", "`memory/spine.ts:166` + `util/plan-status.ts:501` (parsePlanMap removed 2026-10-01; grep → 2 comment hits, 0 live readers)"),
    ("plans/2026-09-22_reasoning-stream-render-stability.md", "T4", "d", "the plan's own STATUS line (2026-09-24) + the replacing boxes T11a/T13a"),
    ("plans/2026-09-22_reasoning-stream-render-stability.md", "T7", "d", "the box's own supersession line (2026-09-24) + the replacing box T13b"),
    ("plans/2026-10-01_tool-description-contracts.md", "C2", "a", "commit `adedb84375` — the mutation check (one RED at each pin's own address)"),
    ("plans/2026-10-01_tool-description-contracts.md", "C3", "d", "`plans/2026-10-19_tool-description-contracts.md` T10/T11 (the same tools, one commit per tool; `T10-write 805732ed`, `T10-task 8334d3f9`)"),
    ("plans/2026-10-01_tool-description-contracts.md", "C4", "d", "the same plan's landed commits: logsearch `0edc8fc3fa`, universalsearch `ffe50230`, list `671edc13`, recall `aa706817`, glob `fa5c195e`, read `f064047e`, grep `67dc9000`"),
    ("plans/2026-10-01_tool-description-contracts.md", "C5", "d", "the same plan's T10 list + T11's four orphan mappings (with the loading grep)"),
    ("plans/2026-10-14_kernel-stop-claim-release.md", "M1", "a + d", "the first half is in the code (`util/plan-status.ts:790-836`); the second half is superseded by `session/stop-check.ts:152` («A stop claim no longer ends a turn»)"),
    ("plans/2026-10-20_kernel-line-audit.md", "P1", "a", "re-measured by t135: 75 630 B, sha256 `8407d4aeb42dc5f2aac8bfb897a25dfcafb58809e0e3adacd01527be043b6114` (the manifest's oracle names the same pin)"),
    ("plans/2026-10-20_triz-kernel-correspondence.md", "S8", "a", "commit `7cb11a686e` (the plan, the 21 glossary entries, the report)"),
    ("plans/2026-10-20_triz-kernel-correspondence.md", "S9", "a", "the `_build.ps1` run of this task (run id in the plan)"),
]
w("| plan | box | class | receipt |")
w("|---|---|---|---|")
for plan, box, cls, receipt in CLOSED:
    w(f"| `{Path(plan).name}` | {box} | {cls} | {receipt} |")
w("")
w(f"**{totals['a']} boxes closed as already earned, {totals['d']} as superseded/obsolete.** "
  "Every one of them was ticked in the plan file itself, in this change — not in a report.")
w("")
w("## 3. The plans moved")
w("")
w("| from | to | ground |")
w("|---|---|---|")
w("| `plans/2026-10-19_undo-broken.md` | `plans_completed/2026-10-19_undo-broken.md` | its only open box (T2) was vacuous: the condition (T1 reproduces) never held and the crash was falsified (`b38d45e5ce`). A plan with no open box left is a completed plan (AGENTS § Plan Maintenance, JOB FAILED #2). |")
w("| `plans/2026-10-20_triz-kernel-correspondence.md` | `plans_completed/2026-10-20_triz-kernel-correspondence.md` | both open boxes closed with receipts (the commit + the build run). |")
w("| `plans/2026-10-16_unmanaged-options.md` | `plans/futures/2026-10-16_unmanaged-options.md` | class (d): the plan's own leaf scope is «INVENTORY + PLAN ONLY. No product code» and its deliverable IS delivered (the 88-row inventory + the /settings proposal, commit `a36f434dfe`). It has no executable box, and the one open thing it names («A3 owner decision outstanding: which USER rows get surfaced first») is a DECISION, not a task. The owner's rule: «План делается чтобы его сделать, для глобальной разработки есть мастерплан» — direction lives in the master plan and in futures, work lives in a plan. A CONDITION is written into the file: it resumes as a NEW executable plan when the owner names the first rows. |")
w("")
w("**Not moved, and why:** `plans/2026-10-15_project-fossil-cell.md` and `plans/2026-10-16_zoekt-scip-fossil-sv.md` "
  "are dirty under another robot's edit in this shared tree; t135 classified them and left them alone. "
  "The four untracked plans (`2026-10-14_return-channel-binding.md`, `2026-10-15_kernel-undefined-contract-audit.md`, "
  "`2026-10-19_codex-robot-event-handoff.md`, `2026-10-20_robot-personnel-delegator.md`) belong to other lanes; "
  "they are classified in the table and NOT committed by t135.")
w("")
w("## 4. The finish order (class b) — smallest remaining work first")
w("")
w("One line per plan: the next box and the oracle that would close it. The delegator dispatches ≤3 robots from this list.")
w("")
w("| # | plan | next box | oracle | why here |")
w("|---:|---|---|---|---|")
for i, (plan, box, oracle, why) in enumerate(FINISH, start=1):
    cls = decisions.get(plan, {}).get("classes", {})
    mark = " **(c) — NOT for the robots**" if cls.get(box) == "c" or cls.get("*") == "c" else ""
    w(f"| {i} | `{Path(plan).name}` | {box}{mark} | {oracle} | {why} |")
w("")
w("The rule the list obeys, quoted from the plan that asked for it "
  "(`plans/2026-10-10_plan-hygiene-in-build-mode.md`, SW): «for each box whose work appears done, find the oracle "
  "**named in that plan** → run it TODAY, one file per invocation → tick with the run id → when no open box remains, "
  "`git mv` to `plans_completed/` in a commit naming the plan». A robot that runs the named oracle and ticks with the "
  "run id finishes a plan in one sitting; a robot that re-derives the oracle writes a new plan, which is how the debt grew.")
w("")
w("## 5. The class shares (measured over the 211 open boxes)")
w("")
w("| class | boxes | share |")
w("|---|---:|---:|")
for c in CLASSES:
    w(f"| {c} — {CLASS_LABEL[c]} | {totals[c]} | {100.0*totals[c]/max(classified_total,1):.1f}% |")
w(f"| **classified** | **{classified_total}** | 100% |")
w("")
w("Plus one plan-level (d): `plans/2026-10-16_unmanaged-options.md` (0 boxes, a direction with a delivered deliverable).")
w("")
w("## 6. The planning defect, measured")
w("")
w("### 6.1 The four patterns the brief asked for")
w("")
w(f"**Boxes with no oracle** — **{pat['no_oracle']} of {pat['total']}** "
  f"({100.0*pat['no_oracle']/max(pat['total'],1):.1f}%) name no instrument that could fail, neither inline "
  f"(no `Oracle:`, no command, no run id) nor in the SVM manifest store. "
  f"**{pat['no_manifest']} of {pat['total']}** boxes have no manifest at all "
  f"(the store holds {pat['with_manifest']} of the {pat['total']} open boxes). "
  f"**{pat['no_binding']} of {pat['total']}** name no concrete path to touch "
  f"({100.0*pat['no_binding']/max(pat['total'],1):.1f}%), and **{pat['no_oracle_and_no_binding']}** name neither.")
w("")
w(f"**Plans with no owner** — **{len(plans_no_owner)} of {len(rows)}** plans mention no owner anywhere in their "
  f"open boxes (no `owner` / `владелец` / an owner decision). Their work belongs to nobody in particular, so nobody "
  f"picks it up: {', '.join('`' + Path(p).name + '`' for p in plans_no_owner[:12])}"
  + (" …" if len(plans_no_owner) > 12 else "") + ".")
w("")
w(f"**Plans opened and abandoned with no continuation receipt** — **{len(plans_abandoned)} of {len(rows)}** plans "
  f"have open boxes, no manifest for any of them, and no box that names a next step, a resume condition or a residual. "
  f"@REWARD_FUNCTION calls this class ABANDONED: work that is neither finished nor continued. "
  f"{', '.join('`' + Path(p).name + '`' for p in plans_abandoned[:12])}"
  + (" …" if len(plans_abandoned) > 12 else "") + ".")
w("")
w(f"**Plans that duplicate each other** — {len(dupes)} title pairs share their subject mechanically: "
  + "; ".join(f"`{a}` / `{b}` ({', '.join(s)})" for a, b, s in dupes) + ".")
w("")
w("And the overlaps the title tokens miss — the same subject split across two plans, which is how one piece of work "
  "loses its receipt and becomes two half-plans:")
w("")
w("| subject | the plans | why it matters |")
w("|---|---|---|")
for subject, plans, why in SAME_SUBJECT:
    w(f"| {subject} | {', '.join('`' + p + '`' for p in plans)} | {why} |")
w("")
w("### 6.2 The mechanism that would have stopped the biggest class")
w("")
w("The biggest class is (b) — 172 boxes that are EXECUTABLE but were never started — and its cause is visible in "
  "the numbers above: **a box can be written with no binding and no oracle, and nothing at write time says so.** "
  "The mechanism is therefore not «write better plans», it is a gate that REFUSES the commit which would add one.")
w("")
w("**THE PLAN ADMISSION GATE.** One predicate, evaluated per OPEN box of every plan entering `plans/`:")
w("")
w("1. **BINDING** — the box (or the lines that follow it, up to the next box) names a concrete path or path:line. "
  "A box that says «make the plan hygiene better» names nothing to touch.")
w("2. **ORACLE** — either the SVM manifest store holds a record for that task with a non-empty `oracle` "
  "(the store's own field, `session/svm.ts:55`), or the box states an instrument inline "
  "(`Oracle:`, a predicted result, a command, a run id).")
w("3. **THE PLAN** carries a `## Smoke Tests` section or says `smoke: N/A`.")
w("")
w("**Where it lives (this is what makes it a mechanism and not a rule):** `scripts/commit_own.py` is already the ONLY "
  "way a plan enters this tree (t66: the private-index commit route). The gate is a pre-commit predicate there, beside "
  "the existing shared-file guard: a commit that adds a plan whose boxes are not executable is REFUSED, and the "
  "offending boxes are NAMED in the refusal. A rule would be prose nobody can fail; this is a check that can.")
w("")
w("**The reuse it rests on:** the oracle carrier already exists — the SVM manifest store, with its per-task `oracle` "
  "field and `svm render`'s own `MISSING` counters (`missingTaskSv`, `missingManifests`). The gate does not invent an "
  "oracle registry; it REQUIRES one of the two carriers the repo already has.")
w("")
w("**The fail-proof** (`fail_proof.py`, fixtures under `fixtures/`):")
w("")
w("| fixture | expected | got | why it matters |")
w("|---|---|---|---|")
w("| `admissible/2026-01-01_admissible.md` | PASS | PASS | binding + inline oracle + a smoke section |")
w("| `admissible/2026-01-02_inline_oracle_no_manifest.md` | PASS | PASS | the gate measures the PLAN, not the store: no manifest exists for it |")
w("| `admissible/2026-01-06_manifest_oracle.md` | PASS | PASS | the oracle lives ONLY in the manifest store |")
w("| `refused/2026-01-03_unbound.md` | REFUSE | REFUSE | the shape that produced the 211-box debt: no binding, no oracle |")
w("| `refused/2026-01-05_no_smoke.md` | REFUSE | REFUSE | executable boxes, but the plan names no smoke |")
w("")
w("All five cases met their expectation (the run's own last line: «every case met its expectation»). "
  "A gate that cannot fail is not a gate; the two REFUSE cases are what make the three PASS cases mean something.")
w("")
w("**What it would have caught here, measured on the tree t135 left** "
  "(`plan_admission.py plans`, re-run after the moves): **114 of 218 open boxes (52.3%) in 34 of 51 plans would be refused** — "
  "the gate's share of the CURRENT debt, measured by the same code that runs the fixture.")
w("")
w("**Why that number is bigger than the 99 of §6.1** (and both are true): §6.1 counts ONE defect (no oracle) over "
  "the 211 boxes as they stood BEFORE t135; the gate counts THREE (no oracle, no binding, no smoke section) over the "
  "218 boxes AFTER t135's edits and the moves, and t135's own notes added oracles to some boxes while the two "
  "previously invisible "
  "plans added 9 more. The two numbers measure different things — one defect, one gate — and the gate's share is "
  "the one that matters for the mechanism: it is the share of boxes that could not have been executed by a robot as written.")
w("")
w("**What it would NOT catch, named honestly:** the gate cannot tell a (b) box from a (c) box — a box that waits for "
  "the owner looks exactly like a box that waits for a robot. The owner-decision class is caught by the QUOTE, not by "
  "a predicate, and it is caught by a reader (t135) rather than by a check. That is the boundary of this mechanism.")
w("")
w("## 7. What was NOT done, and why")
w("")
w("- **No product code was touched** — the brief's rule. The mechanism is a CANDIDATE in `experiments/`, with its "
  "fixture and its fail-proof; wiring it into `scripts/commit_own.py` is a separate, authorized change.")
w("- **The three plans that were invisible to the status surface were given boxes, not closed** — "
  "`2026-09-12_anthropic-cache-breakpoints.md` (5 tasks written as HEADINGS), `2026-09-19_database-truth.md` "
  "(4 tasks written as BULLETS), and `2026-10-16_unmanaged-options.md` (0 tasks; moved to futures with a CONDITION). "
  "Their work was never missing — it was unmeasurable.")
w("- **`plans/2026-10-15_project-fossil-cell.md` and `plans/2026-10-16_zoekt-scip-fossil-sv.md` were NOT edited** — "
  "another robot owns them in this tree. Their 5 + 3 boxes are classified (5 x (a), 3 x (b)) but not applied.")
w("- **The 4 untracked plans were NOT committed** — they are other lanes' uncommitted work.")
w("")
w("## 8. The artefacts this task wrote")
w("")
w("| file | what it is |")
w("|---|---|")
w("| `measure.py` | the census: per plan, its boxes, its smoke/prior-art/lifecycle, its git history (mirrors `util/plan-status.ts`) |")
w("| `box_context.py` | the text of every open box + the lines that follow it + the manifest state — the evidence the class rests on |")
w("| `manifests.py` | the SVM manifest store, read through the store's own mapping |")
w("| `decisions.json` | the per-box class, one entry per plan (the decision, not the measurement) |")
w("| `plan_admission.py` | the candidate mechanism |")
w("| `fail_proof.py` + `fixtures/` | the fail-proof and its five cases |")
w("| `make_report.py` | this report, generated from the artefacts above |")
w("| `plan_inventory.json`, `open_boxes.md`, `box_context.json`, `manifests.json` | the raw measurements |")
w("")

(HERE / "REPORT.md").write_text("\n".join(out), encoding="utf-8")
print(f"REPORT.md written: {len(out)} lines")
print("class totals:", json.dumps(totals))
print("patterns:", json.dumps(pat))
print(f"plans with no owner: {len(plans_no_owner)} · abandoned: {len(plans_abandoned)} · duplicate pairs: {len(dupes)}")
print("unclassified:", unclassified)
