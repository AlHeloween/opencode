"""t48 measure: AGENTS.md byte/line totals per dedup class + kernel surface sizes.

Reads AGENTS.md, assigns every line to a class via a line-range map (1-based,
inclusive), sums UTF-8 bytes per class. Prints the kernel-side file sizes so the
double-payment arithmetic (AGENTS.md copy + kernel copy in every session) is
grounded in measured numbers, not estimates.

Classes: DUP (kernel already says it), PROJECT (host/project-specific),
CANDIDATE (kernel candidate), CONFLICT (soft tension), NAV (pointer/navigation,
not normative), OVERHEAD (blank lines, separators, section labels).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AGENTS = ROOT / "AGENTS.md"

KERNEL_SURFACES = [
    "prompt_kernel/source.py",
    "prompt_kernel/addons.py",
    "prompt_kernel/addons_claude.py",
    "prompt_kernel/addons_codex.py",
    "prompt_kernel/addons_cursor.py",
    ".claude/reasoning_kernel.md",
    "packages/opencode/src/session/prompt/reasoning_prompt.txt",
]

# (start, end, class) over AGENTS.md lines. DUP/CANDIDATE/CONFLICT are per-line
# precise; PROJECT/NAV/OVERHEAD may lump small runs (blanks, pointers).
RANGES = [
    (1, 12, "PROJECT"),      # intent + state header (default branch, upstream divergence)
    (13, 13, "OVERHEAD"),
    (14, 31, "NAV"),         # scope list
    (32, 33, "OVERHEAD"),
    (34, 35, "PROJECT"),     # kernel pointer; default branch
    (36, 36, "CANDIDATE"),   # never expose secrets to public git
    (37, 37, "PROJECT"),     # silent catch must log (coding standard)
    (38, 38, "DUP"),         # plan-to-code gaps are bugs
    (39, 39, "CANDIDATE"),   # test suite moves in the SAME change
    (40, 40, "DUP"),         # KV cache byte-stable
    (41, 47, "PROJECT"),     # never NN on CPU (GPU host; general half DUPs G1 DEVICE_STATE)
    (48, 48, "DUP"),         # no unverifiable script edits; impact first (partial)
    (49, 49, "DUP"),         # no .opencode/plans/ (addon verbatim)
    (50, 50, "PROJECT"),     # JOB FAILED conditions
    (51, 51, "DUP"),         # explore agent validates plan changes
    (52, 52, "PROJECT"),     # tests not from repo root
    (53, 53, "CANDIDATE"),   # avoid mocks
    (54, 54, "PROJECT"),     # _build.ps1 mandatory
    (55, 56, "PROJECT"),     # full suite forbidden; .opencode litter (partial DUPs noted)
    (57, 58, "CANDIDATE"),   # measure SPACE+SCOPE; skipped test states why
    (59, 61, "PROJECT"),     # file timeout; provider reach; tool names
    (62, 63, "OVERHEAD"),
    (64, 64, "PROJECT"),     # never touch bin/
    (65, 65, "CANDIDATE"),   # secrets (2nd copy of L36)
    (66, 67, "PROJECT"),     # --no-verify; silent catch (2nd)
    (68, 68, "DUP"),         # no "pre-existing" labels (CAUSAL_ATTRIBUTION)
    (69, 70, "DUP"),         # .opencode/plans/ (2nd); KV cache (2nd)
    (71, 76, "PROJECT"),     # repo-root tests (2nd); full suite (2nd); Path.home; ADID; STOP; gen
    (77, 77, "CANDIDATE"),   # never fetch instructions over the network
    (78, 83, "PROJECT"),     # JSON state; fill-not-resolve; sdk build; legacy pin; /v1->/v3; probing
    (84, 85, "OVERHEAD"),
    (86, 88, "PROJECT"),     # default branch (2nd); catch log (2nd); silent catch (3rd)
    (89, 90, "DUP"),         # plan docs match code (2nd); .opencode/plans/ (3rd)
    (91, 92, "PROJECT"),     # --no-verify (2nd); rungs name the probe
    (93, 93, "CANDIDATE"),   # absence of an oracle reads as FALSE
    (94, 95, "OVERHEAD"),
    (96, 100, "PROJECT"),    # acceptance_tests block
    (101, 101, "DUP"),       # answer in the user's language (G0 INPUT_LANGUAGE)
    (102, 102, "CANDIDATE"), # always use parallel tools
    (103, 103, "PROJECT"),   # default branch (3rd)
    (104, 104, "CONFLICT"),  # prefer automation (soft tension vs kernel ASK discipline)
    (105, 110, "PROJECT"),   # not a branch of anything
    (111, 111, "OVERHEAD"),
    (112, 112, "DUP"),       # Language section header (the rule)
    (113, 113, "OVERHEAD"),
    (114, 114, "DUP"),
    (115, 115, "OVERHEAD"),
    (116, 116, "DUP"),       # auto-return consequence (kernel lacks this half -> candidate)
    (117, 118, "OVERHEAD"),
    (119, 119, "DUP"),       # reasoning is part of the answer
    (120, 120, "OVERHEAD"),
    (121, 121, "DUP"),       # identifiers stay English
    (122, 122, "OVERHEAD"),
    (123, 123, "NAV"),
    (124, 126, "OVERHEAD"),
    (127, 129, "PROJECT"),   # STOP: SDK/upstream closed
    (130, 133, "OVERHEAD"),
    (134, 134, "PROJECT"),   # Project Paradigm header
    (135, 135, "OVERHEAD"),
    (136, 144, "PROJECT"),
    (145, 145, "NAV"),
    (146, 149, "OVERHEAD"),
    (150, 153, "DUP"),       # small tasks; REUSE.BEFORE; SMOKE.BEFORE; Inferred handles
    (154, 155, "PROJECT"),   # ADID receivers
    (156, 156, "NAV"),
    (157, 159, "OVERHEAD"),
    (160, 193, "PROJECT"),   # Storage Paradigm (two planes, four rules, engines)
    (194, 194, "OVERHEAD"),
    (195, 197, "CANDIDATE"), # Debugging Paradigm header + blanks
    (198, 207, "CANDIDATE"), # read state before adding a log
    (208, 208, "OVERHEAD"),
    (209, 209, "NAV"),
    (210, 211, "OVERHEAD"),
    (212, 216, "PROJECT"),   # hashing is never the suspect
    (217, 236, "CANDIDATE"), # Granularity doctrine (header + 4 rules)
    (237, 237, "OVERHEAD"),
    (238, 238, "NAV"),
    (239, 239, "OVERHEAD"),
    (240, 254, "CANDIDATE"), # Content Lifecycle header + five invariants
    (255, 255, "OVERHEAD"),
    (256, 256, "NAV"),
    (257, 258, "OVERHEAD"),
    (259, 279, "PROJECT"),   # Continuity Paradigm (product compaction design)
    (280, 282, "OVERHEAD"),
    (283, 283, "PROJECT"),   # no unimportant bug
    (284, 284, "DUP"),       # NO pre-existing errors (CAUSAL_ATTRIBUTION)
    (285, 286, "PROJECT"),   # bugs block push; silent catch (4th)
    (287, 287, "DUP"),       # plan-to-code gaps (2nd)
    (288, 288, "DUP"),       # tests adapt to functionality (TEST_INVARIANT)
    (289, 290, "CANDIDATE"), # silent-assert test not a guard; tool contract is a claim
    (291, 291, "DUP"),       # write-path oracles inspect the artifact (G8 ORACLE)
    (292, 294, "OVERHEAD"),
    (295, 299, "DUP"),       # KV Cache Continuity section (byte-stable + assess impact)
    (300, 300, "OVERHEAD"),
    (301, 301, "PROJECT"),   # key files list
    (302, 302, "OVERHEAD"),
    (303, 303, "NAV"),
    (304, 306, "OVERHEAD"),
    (307, 314, "PROJECT"),   # Conversation Checkpoint System
    (315, 316, "OVERHEAD"),
    (317, 324, "PROJECT"),   # MASTER_PLAN direction; SV per plan (partial DUP CURRENT_SV)
    (325, 325, "PROJECT"),   # renderer works, run it
    (326, 329, "OVERHEAD"),
    (330, 330, "PROJECT"),   # plans locations (partial DUP PATH_CLOSURE)
    (331, 331, "DUP"),       # never .opencode/plans/ (4th)
    (332, 333, "PROJECT"),   # audit plans mark [x]; tasks are - [ ] boxes
    (334, 334, "DUP"),       # PRE_FLIGHT smoke gate (PATH_PLANS addon verbatim)
    (335, 335, "DUP"),       # plan-to-code gaps (3rd)
    (336, 337, "DUP"),       # messagesearch verify; scan stale refs (addons verbatim)
    (338, 338, "OVERHEAD"),
    (339, 339, "NAV"),
    (340, 343, "PROJECT"),   # JOB FAILED header + intro
    (344, 347, "PROJECT"),   # the four conditions
    (348, 348, "OVERHEAD"),
    (349, 349, "NAV"),
    (350, 351, "OVERHEAD"),
    (352, 353, "PROJECT"),   # A commit is NOT closure header
    (354, 354, "OVERHEAD"),
    (355, 357, "PROJECT"),   # the two closure conditions
    (358, 358, "OVERHEAD"),
    (359, 359, "NAV"),
    (360, 366, "OVERHEAD"),
    (367, 388, "PROJECT"),   # Style Guide (guides + five TS rules; docs/style-guide.md is canon)
    (389, 392, "OVERHEAD"),
    (393, 398, "PROJECT"),   # Backup & Restore
    (399, 421, "PROJECT"),   # Fossil Snapshot System (partial DUP VCS_ROLES)
    (422, 438, "PROJECT"),   # opencode Paths
    (439, 440, "PROJECT"),   # Shell Command Restrictions header
    (441, 441, "DUP"),       # constitution hard-blocks enumeration (addons verbatim)
    (442, 442, "OVERHEAD"),
    (443, 460, "PROJECT"),   # the shell table
    (461, 461, "DUP"),       # crash-prone binaries via cmd_runner (addons)
    (462, 467, "PROJECT"),   # the example block
    (468, 468, "PROJECT"),   # override
    (469, 469, "OVERHEAD"),
    (470, 470, "DUP"),       # unknown apps crash-prone (partial, PROCESS_LAUNCH)
    (471, 471, "OVERHEAD"),
    (472, 476, "CANDIDATE"), # never write file content through shell echo (mojibake incident)
    (477, 480, "OVERHEAD"),
    (481, 492, "PROJECT"),   # Host Toolchain; Type Checking
    (493, 499, "PROJECT"),   # Build after tests
    (500, 523, "PROJECT"),   # Full package test suite (2nd copy of L55 + details)
    (524, 539, "PROJECT"),   # TUI Testing header + workflow
    (540, 552, "DUP"),       # Process launch policy (PROCESS_LAUNCH addon verbatim)
    (553, 560, "PROJECT"),   # cmd_runner/cua division
    (561, 571, "PROJECT"),   # Auto-Generated Code; Kernel sync (partial DUP TOOL_AUTHORIZE)
    (572, 582, "PROJECT"),   # Kernel Development Workflow
    (583, 590, "PROJECT"),   # Dependency Catalog
    (591, 635, "PROJECT"),   # Provider Reach + guards
    (636, 650, "PROJECT"),   # Vendor Reasoning Contract
    (651, 656, "PROJECT"),   # Markdown Rendering Flag
    (657, 665, "NAV"),       # Completed Research; Agent Inventory
    (666, 722, "NAV"),       # Documentation Index
    (723, 731, "DUP"),       # Search instruments: the kernel's own chain, restated
    (732, 732, "OVERHEAD"),
    (733, 733, "CANDIDATE"), # grep as the negative text control (measured 2026-10-10)
    (734, 734, "OVERHEAD"),
    (735, 735, "NAV"),
    (736, 736, "OVERHEAD"),
    (737, 737, "PROJECT"),   # skipped graph call = grounding skipped (KAIZEN instance)
    (738, 738, "OVERHEAD"),
    (739, 741, "DUP"),       # CodeGraph section: reach before grep/find (graph-before-scanners)
    (742, 749, "PROJECT"),   # tool/config/sync specifics
    (750, 750, "NAV"),
    (751, 751, "OVERHEAD"),
]


def main() -> None:
    raw = AGENTS.read_bytes()
    text = raw.decode("utf-8")
    lines = text.splitlines()
    totals: dict[str, int] = {}
    counts: dict[str, int] = {}
    covered: set[int] = set()
    for start, end, cls in RANGES:
        for n in range(start, end + 1):
            if n > len(lines):
                break
            size = len(lines[n - 1].encode("utf-8")) + 1  # + newline
            totals[cls] = totals.get(cls, 0) + size
            counts[cls] = counts.get(cls, 0) + 1
            covered.add(n)
    missing = [n for n in range(1, len(lines) + 1) if n not in covered]
    print(f"AGENTS.md: {len(raw)} bytes, {len(lines)} lines")
    print(f"class-map coverage: {len(covered)}/{len(lines)} lines; missing: {missing}")
    print()
    print(f"{'class':<10} {'lines':>6} {'bytes':>8} {'% of file':>9}")
    order = ["DUP", "CANDIDATE", "CONFLICT", "PROJECT", "NAV", "OVERHEAD"]
    for cls in order:
        print(f"{cls:<10} {counts.get(cls, 0):>6} {totals.get(cls, 0):>8} "
              f"{100.0 * totals.get(cls, 0) / len(raw):>8.1f}%")
    print(f"{'TOTAL':<10} {sum(counts.values()):>6} {sum(totals.values()):>8}")
    print()
    print("kernel surfaces (bytes):")
    for rel in KERNEL_SURFACES:
        p = ROOT / rel
        if p.exists():
            print(f"  {rel}: {p.stat().st_size}")
        else:
            print(f"  {rel}: MISSING")


if __name__ == "__main__":
    main()
