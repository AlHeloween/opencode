"""t135 addendum 2 — the plan↔master-goal LINK check (candidate mechanism), proven on a fixture.

THE DEFECT IT CATCHES: a plan outside the master plan is a bug and a hallucination
(owner, 2026-10-22: «У нас есть мастерплан — план вне мастерплана — это баг и
галлюцинация»). Every plan in `plans/` names the master-plan goal it serves: its
own SV carries that goal's md5 as `parent-goal-md5`. A plan whose SV carries
32 zeros names no goal — it is unlinked, and executing it is executing blind.

THE GATE (one predicate per plan file):
  1. Read the plan's OWN SV — the first `@SV_FORMAT`-shaped block carrying an
     `md5:` line (the same block `svm render` reads for the map).
  2. Its `parent-goal-md5:` must be 32 hex and NOT all zeros.
  3. A plan with no SV block, no `parent-goal-md5:` line, a non-32-hex value or
     32 zeros is UNLINKED and is NAMED in the refusal.

WHY IT IS A MECHANISM AND NOT A RULE: it is executable, it REFUSES (non-zero
exit, the unlinked plans named), and it has exactly one place to live — beside
`plan_admission.py` in the same commit route (`scripts/commit_own.py`), which is
already the only way a plan enters the tree. The rule would be «link your plan»;
this is a check that can fail.

THE OPEN QUESTION (asked, not assumed): the level-0 goal in `plans/MASTER_PLAN.md`
(dates from 2026-09-30) carries keywords + a dominant but NO md5 — so today there
is no goal md5 for a plan to carry. The owner says this was discussed before
(«мы уже это обсуждали»). Searched: `messagesearch` for goal/md5/master (no
settling discussion found — only the 2026-09-30 note itself asking «почему у goal
нету семантического вектора», which gave the goal its keywords/dominant but no
md5), `grep` over `plans/` + `docs/` (only `docs/ADID_Framework_15_4.md:100,353`
defining parent-goal-md5 as «the md5 of the goal vector», no master-goal md5
value). NOTHING SETTLES IT — so the goal md5 itself is an owner decision, named
below, and this gate reports UNLINKED until the owner mints it.

Usage:
    python plan_link.py <plans-dir>
Exit: 0 = every plan linked; 1 = at least one plan unlinked (named); 2 = usage/IO.
"""

import re
import sys
from pathlib import Path

MD5_RE = re.compile(r"\bmd5:\s*([0-9a-fA-F]{32})\b")
PARENT_RE = re.compile(r"\bparent-goal-md5:\s*([0-9a-fA-FxX]{32}|0{32})\b", re.I)
ZERO = "0" * 32


def plan_link(path: Path) -> tuple[str | None, str]:
    """Return (parent_md5 or None, reason). None = unlinked."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return None, f"unreadable ({exc})"
    if not MD5_RE.search(text):
        return None, "no SV block (no md5: line)"
    m = PARENT_RE.search(text)
    if not m:
        return None, "no parent-goal-md5: line"
    value = m.group(1).lower()
    if value == ZERO:
        return None, "parent-goal-md5 is 32 zeros (names no goal)"
    return value, "linked"


def main(argv: list[str]) -> int:
    if not argv:
        sys.stderr.write(__doc__ or "")
        return 2
    plans_dir = Path(argv[0])
    if not plans_dir.is_dir():
        sys.stderr.write(f"plan_link: no such directory {plans_dir}\n")
        return 2
    plans = sorted(p for p in plans_dir.glob("*.md") if p.name.lower() not in {"readme.md", "master_plan.md"})
    bad: list[tuple[str, str]] = []
    for p in plans:
        link, why = plan_link(p)
        if link is None:
            bad.append((p.name, why))
    for name, why in bad:
        print(f"UNLINKED {name}: {why}")
    print(f"\n{len(plans)} plan(s) · {len(bad)} unlinked")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
