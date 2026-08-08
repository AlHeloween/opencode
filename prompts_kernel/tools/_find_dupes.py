import re
t = open("D:/zPython/opencode/packages/opencode/src/session/prompt/reasoning_prompt.txt", "r", encoding="utf-8").read()
idx_r = t.find("\nRULES:")
idx_t = t.find("# Tier B")
rules_section = t[idx_r:idx_t]
idx_cc = t.find("@CC_TAIL")
cc_section = t[idx_cc:idx_t]

main = set(re.findall(r"^\s{2}([A-Z][A-Z_0-9]{2,}):", rules_section, re.M))
cc = set(re.findall(r"^\s{2}([A-Z][A-Z_0-9]{2,}):", cc_section, re.M))
dup = main & cc
only_main = main - cc
only_cc = cc - main

print(f"Main RULES: {len(main)}")
print(f"CC_TAIL: {len(cc)}")
print(f"DUPLICATES: {len(dup)}")
for d in sorted(dup):
    print(f"  DUPLICATE: {d}")
print(f"\nOnly in main ({len(only_main)}): {sorted(only_main)[:10]}...")
print(f"Only in CC_TAIL ({len(only_cc)}): {sorted(only_cc)}")
