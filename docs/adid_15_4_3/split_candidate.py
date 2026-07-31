"""Split reasoning_candidate.txt into topic fragments (same style as prompt/reasoning/)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "reasoning_candidate.txt"
OUT = Path(__file__).resolve().parent / "fragments"

# 1-based inclusive line ranges from structure analysis
FRAGMENTS: list[tuple[str, int, int, str]] = [
    ("00_front_meta", 1, 17, "Title, version, RFC 2119"),
    ("01_quick_reference", 18, 61, "Top rules, SVM-6, InfoMark table, fractal when"),
    ("02_flowcharts", 62, 108, "InfoMark / SVM / fractal-trigger mermaid"),
    ("03_checklists", 109, 145, "Pre-task / pre-exec / post-exec"),
    ("04_anti_patterns_mistakes", 146, 181, "Anti-patterns + common mistakes"),
    ("05_communication_epistemics", 182, 421, "§I communication, InfoMark, SV, Δ, reverse search"),
    ("06_agi_kernel_fractal", 422, 537, "§15 AGI kernel fractal + k-medoids + execution modes"),
    ("07_safety_fsm", 538, 718, "§16 Certified External Safety FSM + rules 17–19"),
    ("08_framework_principles_workflow", 719, 725, "§II ADID principles header (short bridge)"),
    ("09_roles_governance", 726, 1157, "§IV roles + evolution + SVM + ADID workflow + manager contract"),
    ("10_development_guidelines", 1158, 1195, "§III development guidelines"),
    ("11_operating_protocol", 1196, 1215, "§V AGI operating protocol"),
    ("12_web_search", 1216, 1237, "§VI web search specs"),
    ("13_setup_appendices", 1238, 99999, "First-time setup + appendices"),
]


def main() -> None:
    lines = SRC.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    n = len(lines)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.txt"):
        old.unlink()

    written: list[str] = []
    for name, start, end, topic in FRAGMENTS:
        end = min(end, n)
        chunk = "".join(lines[start - 1 : end])
        if not chunk.endswith("\n"):
            chunk += "\n"
        header = (
            f"# fragment: {name}\n"
            f"# source: reasoning_candidate.txt L{start}-{end}\n"
            f"# topic: {topic}\n"
            f"# status: candidate ADID 15.4.3 — NOT runtime system prompt\n\n"
        )
        path = OUT / f"{name}.txt"
        path.write_text(header + chunk, encoding="utf-8", newline="\n")
        written.append(name)
        print(f"  {name}.txt  {path.stat().st_size:6d} B  L{start}-{end}")

    # Assemble full doc for convenience (optional)
    body = "\n".join(
        (OUT / f"{n}.txt").read_text(encoding="utf-8").rstrip("\n") for n in written
    )
    (OUT.parent / "ASSEMBLED.md").write_text(body + "\n", encoding="utf-8", newline="\n")
    print(f"assembled ASSEMBLED.md ({len(body)} chars)")


if __name__ == "__main__":
    main()
