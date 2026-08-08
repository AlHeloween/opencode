"""Fix kernel: move CC rules to CC_TAIL, remove from main RULES."""
import re

path = r"D:\zPython\opencode\packages\opencode\src\session\prompt\reasoning_prompt.txt"
text = open(path, "r", encoding="utf-8").read()

cc_rules = {
    "TONE_AND_STYLE": "Act as expert, no hedging. No apologies or disclaimers. No safety lectures unless asked. Ethical filter: omit non-compliant content, label (Filtered). Understand question intent before answering. Multi-topic -> separate per topic. Accurate, unique, multi-perspective, concise. Verified sources with links. Fractal perspectives when applicable. No time-ambiguous claims.",
    "NAMING": "rule identifiers use UPPER_SNAKE_CASE with underscore '_' delimiter. Dots '.' and hyphens '-' are forbidden. All rules are fully underscore-unified. Rule key references must match exactly. No aliases, no fuzzy matching. The exact count of rules is len(RULES).",
    "DOCUMENT_SURFACE": "maintain doc surface: docs/ (detailed), DOCINDEX.md (owners/entrypoints/last_verified), index.md (folder-based repo map). Update when adding or moving files.",
    "WORKSPACE_LANES": "organize by purpose: experiments/ (ad-hoc scratch), futures/ (drafts not ready), obsolete/ (deprecated refs), makeups/ (explicit stubs). Never mix throwaway with mainline.",
    "PROGRESS_LOG": "track progress: _development_plan.md (goals+tasks with [x] checks), _progress_log.md ([TIMESTAMP] activity -> script -> output), _application_workflow_diagram.md (modules->functions->I/O map). Update after each non-trivial change.",
    "MEMORY_RANK": "session-read Exact > summary Inferred > unaided Guess; never treat summaries as Exact",
    "MEMORY_LINKS": "every summary and message* must carry message IDs for session-read recovery",
    "ADID_FREEZE": "never hand-edit ADID framework rule receivers; change only via kernel SPECS or official ADM pipelines",
    "CODE_STANDARDS": "Follow language-specific coding standards: PEP 8 for Python, StandardJS/ESLint for TypeScript, gofmt for Go. Use project-configured linters and formatters. Consistency with existing codebase style takes precedence over personal preference.",
    "FRAMEWORK_INHERITANCE": "Build framework-oriented code: inherit and extend existing abstractions rather than rewriting. Use polymorphism and dependency injection. Do not duplicate working patterns. Breaking changes to established interfaces require explicit approval.",
}

# Remove from main RULES section
idx_rules = text.find("\nRULES:")
idx_tier = text.find("# Tier B")
before = text[:idx_rules]
rules_section = text[idx_rules:idx_tier]
after = text[idx_tier:]

for name in cc_rules:
    before_count = len(re.findall(rf"^  {name}:", rules_section, flags=re.M))
    rules_section = re.sub(rf"^  {name}: .+$\n?", "", rules_section, flags=re.M)
    after_count = len(re.findall(rf"^  {name}:", rules_section, flags=re.M))
    print(f"  {name}: {before_count} -> {after_count}")
rules_section = re.sub(r"\n{3,}", "\n\n", rules_section)

# Build CC_RULES block
lines = []
for name in sorted(cc_rules):
    lines.append(f"  {name}: {cc_rules[name]}")
cc_block = "CC_RULES:\n" + "\n".join(lines)

# Replace empty CC_RULES
text = before + rules_section + after
text = text.replace("CC_RULES:\n## CC Terms", cc_block + "\n## CC Terms")

open(path, "w", encoding="utf-8").write(text)

# Verify
t2 = open(path, "r", encoding="utf-8").read()
idx_r = t2.find("\nRULES:")
idx_t = t2.find("# Tier B")
main2 = set(re.findall(r"^\s{2}([A-Z][A-Z_0-9]{2,}):", t2[idx_r:idx_t], re.M))
idx_cc = t2.find("CC_RULES:")
cc2 = set(re.findall(r"^\s{2}([A-Z][A-Z_0-9]{2,}):", t2[idx_cc:], re.M))
dup = main2 & cc2
print(f"Main: {len(main2)}, CC_TAIL: {len(cc2)}, Duplicates: {len(dup)}")
print(f"File size: {len(t2)} bytes")
print(f"CC_TAIL rules: {sorted(cc2)}")
