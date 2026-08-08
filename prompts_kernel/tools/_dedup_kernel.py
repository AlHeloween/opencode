"""Remove duplicate CC rules from main RULES section only (not CC_TAIL)."""
import re

path = "D:/zPython/opencode/packages/opencode/src/session/prompt/reasoning_prompt.txt"
t = open(path, "r", encoding="utf-8").read()

dupes = [
    "ADID_FREEZE", "CODE_STANDARDS", "DOCUMENT_SURFACE",
    "FRAMEWORK_INHERITANCE", "MEMORY_LINKS", "MEMORY_RANK",
    "NAMING", "PROGRESS_LOG", "TONE_AND_STYLE", "WORKSPACE_LANES",
]

# Find RULES section boundaries
idx_rules = t.find("\nRULES:")
idx_tier = t.find("# Tier B")
before = t[:idx_rules]
rules_section = t[idx_rules:idx_tier]
after = t[idx_tier:]

# Remove duplicates only from rules_section
for d in dupes:
    rules_section = re.sub(rf"^  {d}: .+$\n?", "", rules_section, flags=re.M)

rules_section = re.sub(r"\n{3,}", "\n\n", rules_section)

# Reassemble
t = before + rules_section + after
open(path, "w", encoding="utf-8").write(t)

# Verify
t2 = open(path, "r", encoding="utf-8").read()
idx_r = t2.find("\nRULES:")
idx_t = t2.find("# Tier B")
main2 = set(re.findall(r"^\s{2}([A-Z][A-Z_0-9]{2,}):", t2[idx_r:idx_t], re.M))
idx_cc = t2.find("@CC_TAIL")
cc2 = set(re.findall(r"^\s{2}([A-Z][A-Z_0-9]{2,}):", t2[idx_cc:idx_t], re.M))
dup = main2 & cc2
print(f"Main: {len(main2)}, CC_TAIL: {len(cc2)}, Duplicates: {len(dup)}")
if dup:
    print(f"STILL DUP: {dup}")
print(f"Only in main: {len(main2 - cc2)}, Only in CC: {len(cc2 - main2)}")
print(f"File size: {len(t2)} bytes")
print(f"CC_TAIL present: {'@CC_TAIL' in t2}")
