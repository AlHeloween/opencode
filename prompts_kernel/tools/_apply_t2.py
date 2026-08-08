"""Apply T2 (CC tail) and T1 (G9 consolidation) to test_kernel."""
import re

path = r"D:\zPython\opencode\test_kernel\reasoning_prompt.txt"
text = open(path, "r", encoding="utf-8").read()

# ── T2: Extract @CC rules from RULES section ──
cc_rules = [
    "TONE_AND_STYLE",
    "NAMING",
    "DOCUMENT_SURFACE",
    "WORKSPACE_LANES",
    "PROGRESS_LOG",
    "MEMORY_RANK",
    "MEMORY_LINKS",
    "ADID_FREEZE",
]

cc_terms = [
    "hygiene", "memory", "evidence", "scope", "cache",
    "adid", "mutation", "verification", "oracle", "style", "infomark", "plan",
]

# Build the CC_TAIL section
cc_lines = ["\n# Cross-Cutting (@CC_TAIL)\n"]
cc_lines.append("## CC Rules\n")
for rule in cc_rules:
    pat = re.compile(rf"^  {rule}: (.+)$", re.MULTILINE)
    m = pat.search(text)
    if m:
        cc_lines.append(f"  {rule}: {m.group(1)}")

cc_lines.append("\n## CC Terms\n")
for term in cc_terms:
    pat = re.compile(rf"^  {term}: (.+)$", re.MULTILINE)
    m = pat.search(text)
    if m:
        cc_lines.append(f"  {term}: {m.group(1)}")

cc_block = "\n".join(cc_lines) + "\n"

# Remove CC rules from RULES section
for rule in cc_rules:
    text = re.sub(rf"^  {rule}: .+$\n?", "", text, flags=re.MULTILINE)

# Remove CC terms from TERMS section
for term in cc_terms:
    text = re.sub(rf"^  {term}: .+$\n?", "", text, flags=re.MULTILINE)

# Clean up double blank lines in RULES/TERMS
text = re.sub(r"\n{3,}", "\n\n", text)

# Append CC_TAIL at the end
text = text.rstrip() + "\n" + cc_block

open(path, "w", encoding="utf-8").write(text)

# Verify
new_text = open(path, "r", encoding="utf-8").read()
remaining_cc = [r for r in cc_rules if re.search(rf"^  {r}: ", new_text, re.MULTILINE)]
remaining_terms = [t for t in cc_terms if re.search(rf"^  {t}: ", new_text, re.MULTILINE)]

print(f"Moved to @CC_TAIL: {len(cc_rules)} rules, {len(cc_terms)} terms")
print(f"Remaining in RULES/TERMS (should be 0): rules={remaining_cc}, terms={remaining_terms}")
print(f"@CC_TAIL present: {'@CC_TAIL' in new_text}")
print(f"New file size: {len(new_text)} chars")
