"""Dictionary extractor — parse reasoning_prompt.txt into a flat symbol table.

Extracts every named entry: RULES (32), TERMS (12), Gates (9 + CC), Schemas,
Algorithms, Diagrams, Identities, and Epistemic blocks.

Usage:
  python -m prompts_kernel.tools.dictionary           # print summary
  python -m prompts_kernel.tools.dictionary --json    # dump as JSON
  python -m prompts_kernel.tools.dictionary --validate # check entry count
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

KERNEL = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "opencode"
    / "src"
    / "session"
    / "prompt"
    / "reasoning_prompt.txt"
)

# ── Patterns ──────────────────────────────────────────────────────────
REF_PAT = re.compile(r"@([A-Z][A-Z_0-9]*(?:\.[a-z_]+)?)")  # @REF_NAME or @REF.sub
HEADER_H1 = re.compile(r"^#\s+(.+)$")    # # Section Name (@TAG) or # Section Name
HEADER_H2 = re.compile(r"^##\s+(.+)$")   # ## SubSection (@TAG)
HEADER_H3 = re.compile(r"^###\s+(.+)$")  # ### SubSub
TAG_PAT = re.compile(r"\(@([A-Z][A-Z_0-9]*)\)")  # extract @TAG from header
YAML_KV = re.compile(r"^\s{2}([a-z_]+):\s*(.*)")  #    key: value (TERMS style)
RULE_KV = re.compile(r"^\s{2}([A-Z][A-Z_0-9]*):\s*(.*)")  #    RULE_NAME: body (RULES style)
COMMENT_SEP = re.compile(r"^\s{2}#\s+──\s+(\w+)")  #    # ── G1 ── (category marker)
FRONTMATTER_END = re.compile(r"^---\s*$")


@dataclass
class Entry:
    """One dictionary entry with its raw body and metadata."""

    id: str             # canonical name: EVIDENCE_ORDER, G1, FRACTAL_GEOMETRY
    type: str           # rule | term | gate | schema | algorithm | diagram | identity | epistemic
    body: str           # raw body text (as it appears in the kernel)
    refs: list[str] = field(default_factory=list)  # @REFs found in body
    line_start: int = 0
    line_end: int = 0
    category: str = ""  # parent gate for rules (G1, G2, ...) or owner for terms


# ── Section-level parser ──────────────────────────────────────────────


def _extract_tag(header: str) -> str | None:
    """Extract @TAG from a header like 'DOMAIN_SOURCES (@DOMAIN_SOURCES)'."""
    m = TAG_PAT.search(header)
    return m.group(1) if m else None


def _extract_refs(text: str) -> list[str]:
    """Extract all @REF targets from text, preserving order, deduplicated."""
    seen = set()
    refs = []
    for m in REF_PAT.finditer(text):
        ref = m.group(1)
        if ref not in seen:
            seen.add(ref)
            refs.append(ref)
    return refs


def _is_mermaid_block(lines: list[str], i: int) -> bool:
    """Check if line i starts a mermaid code block."""
    return lines[i].strip() == "```mermaid"


def _skip_code_block(lines: list[str], i: int) -> int:
    """Skip from ``` to closing ```. Returns index of closing ``` line."""
    j = i + 1
    while j < len(lines) and not lines[j].strip().startswith("```"):
        j += 1
    return j  # points to closing ```


def _body_lines_to_str(body_lines: list[str]) -> str:
    """Join body lines, strip leading/trailing blank lines."""
    text = "\n".join(body_lines).strip()
    return text


# ── Transitive @REF Resolution ───────────────────────────────────────

MAX_RESOLVED_BYTES = 50_000  # 50KB cap per resolved body


def resolve_transitive(
    entry_id: str,
    entries: dict[str, Entry],
    visited: frozenset[str] | None = None,
) -> str:
    """Recursively resolve all @REFs in an entry to their full body text.

    Performs full transitive closure: @A → A's body → expand @REFs within A's body
    → continue until all references are resolved or cycles are hit.

    Cycle handling: if entry_id is already in `visited`, returns `{NAME}` tag
    instead of body, breaking the recursion. This prevents infinite loops on
    A→B→A patterns.

    Depth is tracked implicitly via the visited frozenset — each resolution
    path gets its own visited set, so the same entry can appear in multiple
    paths (correct for transitive closure — D should appear in both B's and
    C's resolved text when A→B→D and A→C→D).
    """
    if visited is None:
        visited = frozenset()

    entry = entries.get(entry_id)
    if entry is None:
        return f"{{UNRESOLVED:{entry_id}}}"

    if entry_id in visited:
        # Cycle detected — emit name tag, stop recursion
        return f"{{{entry_id}}}"

    visited = visited | {entry_id}
    body = entry.body

    # Find all @REFs, sort longest-first to avoid partial matches
    refs = _extract_refs(body)
    refs.sort(key=len, reverse=True)

    for ref in refs:
        ref_key = ref.split(".")[0]  # @G1.search_intent → G1
        if ref_key == entry_id:
            # Self-reference: replace with name tag
            body = _replace_ref(body, ref, f"{{{ref_key}}}")
        elif ref_key in entries:
            resolved_body = resolve_transitive(ref_key, entries, visited)
            body = _replace_ref(body, ref, resolved_body)
        # else: ref not in dictionary — leave @ref as-is

    # Size guard
    if len(body.encode("utf-8")) > MAX_RESOLVED_BYTES:
        body = body.encode("utf-8")[:MAX_RESOLVED_BYTES].decode("utf-8", errors="replace")
        body += "\n[... truncated at 50KB]"

    return body


def _replace_ref(text: str, ref: str, replacement: str) -> str:
    """Replace @ref with replacement text, handling both @REF and @REF.sub patterns."""
    # Match @REF optionally followed by .sub
    import re as _re
    pattern = _re.compile(rf"@{_re.escape(ref)}(?!\w)")
    return pattern.sub(replacement, text)


def resolve_all(entries: dict[str, Entry]) -> dict[str, str]:
    """Resolve all entries to their full transitive closure bodies.

    Returns dict[entry_id → resolved_body_string].
    """
    return {
        eid: resolve_transitive(eid, entries)
        for eid in entries
    }


def parse_dictionary(path: Path | None = None) -> dict[str, Entry]:
    """Parse reasoning_prompt.txt into a dict of Entry objects keyed by canonical id.

    Returns entries for: rules, terms, gates, schemas, algorithms, diagrams,
    identities, and epistemic blocks.
    """
    if path is None:
        path = KERNEL
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    entries: dict[str, Entry] = {}

    # ── Pass 1: split into major sections by H1/H2 headers ──
    # We track: current H1 section name, current H2 section name, and line ranges
    i = 0
    # Skip frontmatter
    if lines[0].strip() == "---":
        i = 1
        while i < len(lines) and not FRONTMATTER_END.match(lines[i].strip()):
            i += 1
        i += 1  # skip closing ---

    # State machine
    current_h1: str | None = None     # e.g., "Semantic Vector", "Protocol", "Schemas"
    current_h2: str | None = None
    in_rules_section = False
    in_terms_section = False
    current_category: str = ""         # G1, G2, G3, ..., CC

    while i < len(lines):
        line = lines[i]

        # ═══ GATE / IDENTITY DETECTION (before H1 — gates are H1 lines with @Gn tags) ═══
        if line.startswith("# ") and not line.startswith("## "):
            # Gate: # GROUND (@G1), # DECOMPOSE (@G2), ..., # CROSS_CUTTING (@CC)
            gate_match = re.search(r"\(@(G\d\d?|CC)\)", line)
            if gate_match:
                gate_id = gate_match.group(1)
                body_lines = []
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    # Stop at any H1 or H2 header
                    if nxt.startswith("# ") and not nxt.startswith("## "):
                        break  # any H1 starts a new section
                    if HEADER_H2.match(nxt):
                        break
                    body_lines.append(nxt)
                    j += 1
                body = _body_lines_to_str(body_lines)
                refs = _extract_refs(body)
                entries[gate_id] = Entry(
                    id=gate_id, type="gate", body=body, refs=refs,
                    line_start=i + 1, line_end=j,
                )
                current_h1 = line.lstrip("#").strip()
                current_h2 = None
                i = j
                continue

            # Identity sections: # IDENTITIES (@IDENTITIES), # GATE_IDENTITY_DISPATCH (@...)
            id_match = re.search(r"\(@(IDENTITIES|GATE_IDENTITY_DISPATCH)\)", line)
            if id_match:
                tag = id_match.group(1)
                body_lines = []
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    if nxt.startswith("# ") and not nxt.startswith("## "):
                        break  # any H1 starts a new section
                    if HEADER_H2.match(nxt):
                        break
                    body_lines.append(nxt)
                    j += 1
                body = _body_lines_to_str(body_lines)
                refs = _extract_refs(body)
                entries[tag] = Entry(
                    id=tag, type="identity", body=body, refs=refs,
                    line_start=i + 1, line_end=j,
                )
                current_h1 = line.lstrip("#").strip()
                current_h2 = None
                i = j
                continue

        # ═══ H1 HEADER (generic, after gate check) ═══
        m1 = HEADER_H1.match(line)
        if m1:
            current_h1 = m1.group(1).strip()
            current_h2 = None
            in_rules_section = False
            in_terms_section = False
            i += 1
            continue

        # ═══ Plain-text section markers: RULES:, TERMS:, PROMPT_ABI: ═══
        if line.strip() == "RULES:":
            in_rules_section = True
            in_terms_section = False
            i += 1
            continue
        if line.strip() == "TERMS:":
            in_terms_section = True
            in_rules_section = False
            i += 1
            continue
        if line.strip() == "PROMPT_ABI:":
            in_rules_section = False
            in_terms_section = False
            i += 1
            continue

        # ═══ Inside RULES section: extract individual rules ═══
        if in_rules_section:
            cm = COMMENT_SEP.match(line)
            if cm:
                current_category = cm.group(1)
                i += 1
                continue
            rm = RULE_KV.match(line)
            if rm:
                rule_id = rm.group(1)
                body = rm.group(2).strip()
                refs = _extract_refs(body)
                entries[rule_id] = Entry(
                    id=rule_id, type="rule", body=body, refs=refs,
                    line_start=i + 1, line_end=i + 1,
                    category=current_category,
                )
            i += 1
            continue

        # ═══ Inside TERMS section: extract individual terms ═══
        if in_terms_section:
            tm = YAML_KV.match(line)
            if tm:
                term_id = tm.group(1)
                body = tm.group(2).strip()
                refs = _extract_refs(body)
                entries[term_id] = Entry(
                    id=term_id, type="term", body=body, refs=refs,
                    line_start=i + 1, line_end=i + 1,
                )
            i += 1
            continue

        # ═══ H2 HEADER ═══
        m2 = HEADER_H2.match(line)
        if m2:
            current_h2 = m2.group(1).strip()
            tag = _extract_tag(current_h2)
            parent = current_h1 or ""

            # ── Schemas ──
            if "Schemas" in parent and tag:
                body_lines = []
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    if HEADER_H2.match(nxt) or HEADER_H1.match(nxt):
                        break
                    body_lines.append(nxt)
                    j += 1
                body = _body_lines_to_str(body_lines)
                entries[tag] = Entry(
                    id=tag, type="schema", body=body, refs=_extract_refs(body),
                    line_start=i + 1, line_end=j,
                )
                i = j
                continue

            # ── Algorithms ──
            if "Algorithms" in parent and tag:
                body_lines = []
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    if HEADER_H2.match(nxt) or HEADER_H1.match(nxt):
                        break
                    body_lines.append(nxt)
                    j += 1
                body = _body_lines_to_str(body_lines)
                entries[tag] = Entry(
                    id=tag, type="algorithm", body=body, refs=_extract_refs(body),
                    line_start=i + 1, line_end=j,
                )
                i = j
                continue

            # ── Diagrams ──
            if "Diagrams" in parent and tag:
                body_lines = []
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    if HEADER_H2.match(nxt) or HEADER_H1.match(nxt):
                        break
                    body_lines.append(nxt)
                    j += 1
                body = _body_lines_to_str(body_lines)
                entries[tag] = Entry(
                    id=tag, type="diagram", body=body, refs=_extract_refs(body),
                    line_start=i + 1, line_end=j,
                )
                i = j
                continue

            # ── Identities (under "Agent Specs") ──
            if "Agent Specs" in parent:
                id_name = current_h2.split("(")[0].strip().upper().replace(" ", "_")
                body_lines = []
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    if HEADER_H2.match(nxt) or (HEADER_H1.match(nxt) and "Policy Specs" in nxt):
                        break
                    body_lines.append(nxt)
                    j += 1
                body = _body_lines_to_str(body_lines)
                entries[id_name] = Entry(
                    id=id_name, type="identity", body=body, refs=_extract_refs(body),
                    line_start=i + 1, line_end=j,
                )
                i = j
                continue

            # ── Epistemic blocks ──
            if "Epistemic" in parent and tag:
                body_lines = []
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    if HEADER_H2.match(nxt) or HEADER_H1.match(nxt):
                        break
                    body_lines.append(nxt)
                    j += 1
                body = _body_lines_to_str(body_lines)
                entries[tag] = Entry(
                    id=tag, type="epistemic", body=body, refs=_extract_refs(body),
                    line_start=i + 1, line_end=j,
                )
                i = j
                continue

            # ── General H2 with tag (catch-all) ──
            if tag and tag not in entries:
                body_lines = []
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    if HEADER_H2.match(nxt) or HEADER_H1.match(nxt):
                        break
                    body_lines.append(nxt)
                    j += 1
                body = _body_lines_to_str(body_lines)
                # Heuristic: looks like a schema (has structured YAML/list body)
                etype = "schema"  # default for tagged H2 blocks
                entries[tag] = Entry(
                    id=tag, type=etype, body=body, refs=_extract_refs(body),
                    line_start=i + 1, line_end=j,
                )
                i = j
                continue

        i += 1

    return entries


# ── Reporting ─────────────────────────────────────────────────────────


def validate(entries: dict[str, Entry]) -> dict:
    """Validate entry counts against expected values."""
    counts: dict[str, int] = {}
    for e in entries.values():
        counts[e.type] = counts.get(e.type, 0) + 1

    expected = {
        "rule": 42,   # gate rules + CC rules integrated into gates
        "term": 12,   # kernel terms
        "gate": 0,    # gates rendered inline (rich format), not separate entries
        "schema": None,  # variable
        "algorithm": 4,
        "diagram": None,  # variable
        "identity": None,
        "epistemic": 4,
    }

    issues = []
    for typ, exp in expected.items():
        actual = counts.get(typ, 0)
        if exp is not None and actual != exp:
            issues.append(f"Expected {exp} {typ}s, got {actual}")

    return {
        "total": len(entries),
        "by_type": counts,
        "issues": issues,
        "valid": len(issues) == 0,
    }


def report(entries: dict[str, Entry]) -> str:
    """Format a summary report."""
    v = validate(entries)
    lines = [
        f"Dictionary: {v['total']} entries from {KERNEL.name}",
        "",
        "By type:",
    ]
    for typ, count in sorted(v["by_type"].items()):
        lines.append(f"  {typ}: {count}")

    if v["issues"]:
        lines.append("")
        lines.append("Issues:")
        for issue in v["issues"]:
            lines.append(f"  ⚠ {issue}")
    else:
        lines.append("")
        lines.append("✅ All counts match expected.")

    # List entries
    lines.append("")
    lines.append("Entries:")
    for eid in sorted(entries.keys()):
        e = entries[eid]
        refs_str = f" → [{', '.join(e.refs[:5])}]" if e.refs else ""
        cat_str = f" [{e.category}]" if e.category else ""
        lines.append(f"  @{eid:<30} {e.type:<10}{cat_str}{refs_str}")

    return "\n".join(lines)


def main() -> int:
    if not KERNEL.exists():
        print(f"ERROR: {KERNEL} not found", file=sys.stderr)
        return 1

    entries = parse_dictionary()

    if "--resolve-all" in sys.argv:
        resolved = resolve_all(entries)
        for eid in sorted(resolved):
            body = resolved[eid]
            print(f"=== {eid} ({len(body)} chars) ===")
            print(body[:500])
            if len(body) > 500:
                print(f"... ({len(body) - 500} more chars)")
            print()
        return 0

    if "--resolve" in sys.argv:
        idx = sys.argv.index("--resolve")
        if idx + 1 < len(sys.argv):
            eid = sys.argv[idx + 1]
            if eid in entries:
                resolved = resolve_transitive(eid, entries)
                print(f"=== {eid} — raw: {len(entries[eid].body)} chars, resolved: {len(resolved)} chars ===")
                print(resolved)
            else:
                print(f"Unknown entry: {eid}")
                print(f"Available: {', '.join(sorted(entries.keys())[:20])}...")
                return 1
        else:
            print("Usage: --resolve ENTRY_ID")
            return 1
        return 0

    if "--json" in sys.argv:
        out = {
            eid: {
                "type": e.type,
                "body": e.body,
                "refs": e.refs,
                "category": e.category,
                "lines": f"{e.line_start}-{e.line_end}",
            }
            for eid, e in entries.items()
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0

    if "--validate" in sys.argv or "-v" in sys.argv:
        v = validate(entries)
        print(f"Total: {v['total']}  Valid: {v['valid']}")
        if v["issues"]:
            for issue in v["issues"]:
                print(f"  ⚠ {issue}")
        return 0 if v["valid"] else 1

    print(report(entries))
    return 0


if __name__ == "__main__":
    sys.exit(main())
