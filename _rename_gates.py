"""Mechanical rename: @G1..@G9 → @GATE_N_... across all kernel files."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Order matters: replace longer prefixes first to avoid partial matches
# @G9 before @G1, etc.
AT_MAPPING = [
    ("@G9", "@GATE_9_CLEAN_STATE"),
    ("@G8", "@GATE_8_ORACLE"),
    ("@G7", "@GATE_7_IMPLEMENT"),
    ("@G6", "@GATE_6_GROUND_PLAN"),
    ("@G5", "@GATE_5_CONCERN_LOOP"),
    ("@G4", "@GATE_4_AUTHORIZE"),
    ("@G3", "@GATE_3_MASTER_PLAN"),
    ("@G2", "@GATE_2_DECOMPOSE"),
    ("@G1", "@GATE_1_GROUND"),
]

# Bare gate definition headers (exact match, word boundary)
BARE_MAPPING = [
    ("G9_CLEAN_STATE", "GATE_9_CLEAN_STATE"),
    ("G8_ORACLE", "GATE_8_ORACLE"),
    ("G7_IMPLEMENT", "GATE_7_IMPLEMENT"),
    ("G6_GROUND_PLAN", "GATE_6_GROUND_PLAN"),
    ("G5_CONCERN_LOOP", "GATE_5_CONCERN_LOOP"),
    ("G4_AUTHORIZE", "GATE_4_AUTHORIZE"),
    ("G3_MASTER_PLAN", "GATE_3_MASTER_PLAN"),
    ("G2_DECOMPOSE", "GATE_2_DECOMPOSE"),
    ("G1_GROUND", "GATE_1_GROUND"),
]

# For YAML gate keys: "  G1:" → "  GATE_1_GROUND:"
YAML_GATE_KEYS = [
    ("G9:", "GATE_9_CLEAN_STATE:"),
    ("G8:", "GATE_8_ORACLE:"),
    ("G7:", "GATE_7_IMPLEMENT:"),
    ("G6:", "GATE_6_GROUND_PLAN:"),
    ("G5:", "GATE_5_CONCERN_LOOP:"),
    ("G4:", "GATE_4_AUTHORIZE:"),
    ("G3:", "GATE_3_MASTER_PLAN:"),
    ("G2:", "GATE_2_DECOMPOSE:"),
    ("G1:", "GATE_1_GROUND:"),
]

# For YAML tag values: "tag: G1" → "tag: GATE_1_GROUND"
YAML_TAG_VALUES = BARE_MAPPING  # same transformation

# Files to process (from user's list)
FILES = [
    ROOT / "prompts_kernel" / "reasoning" / "01_gates.txt",
    ROOT / "prompts_kernel" / "reasoning" / "00_map.txt",
    ROOT / "prompts_kernel" / "20_specs_agents.py",
    ROOT / "prompts_kernel" / "27_runtime_dict.py",
    ROOT / "prompts_kernel" / "28_runtime_render.py",
    ROOT / "prompts_kernel" / "core_schemas.yaml",
    ROOT / "prompts_kernel" / "14_plan_cluster.py",
    ROOT / "_build.ps1",
]

# Add all tool description files
TOOL_DIR = ROOT / "packages" / "opencode" / "src" / "tool"
FILES.extend(sorted(TOOL_DIR.glob("*.txt")))

# Add all test files
TEST_DIR = ROOT / "prompts_kernel" / "tests"
FILES.extend(sorted(TEST_DIR.glob("*.py")))

# Also add non-listed source files that contain gate refs
EXTRA_FILES = [
    ROOT / "prompts_kernel" / "24_specs_policies.py",
    ROOT / "prompts_kernel" / "06_contracts.py",
    ROOT / "prompts_kernel" / "26_specs_grounding.py",
    ROOT / "prompts_kernel" / "tools" / "dictionary.py",
    ROOT / "prompts_kernel" / "tools" / "refdupes.py",
]
FILES.extend(EXTRA_FILES)

# Remove duplicates
FILES = sorted(set(str(f) for f in FILES if f.exists()))

def replace_in_file(filepath: str) -> int:
    """Apply all replacements to a file. Returns count of replacements made."""
    path = Path(filepath)
    if not path.exists():
        print(f"  SKIP (not found): {path}")
        return 0
    
    content = path.read_text(encoding="utf-8")
    original = content
    changes = 0
    
    # 1. Replace @G1..@G9 with @GATE_N_... (longest first to avoid partial matches)
    for old, new in AT_MAPPING:
        count = content.count(old)
        if count > 0:
            content = content.replace(old, new)
            changes += count
    
    # 2. Replace bare gate definition headers (word-boundary aware)
    for old, new in BARE_MAPPING:
        # Only replace when followed by : or space (not part of larger identifier)
        # Pattern: old followed by :, space, newline, or end
        pattern = re.compile(r'\b' + re.escape(old) + r'\b')
        count = len(pattern.findall(content))
        if count > 0:
            content = pattern.sub(new, content)
            changes += count
    
    if content != original:
        path.write_text(content, encoding="utf-8", newline="\n")
        print(f"  OK: {path.relative_to(ROOT)} ({changes} replacements)")
    else:
        print(f"  --: {path.relative_to(ROOT)} (no changes)")
    
    return changes


def main():
    total_changes = 0
    total_files = 0
    print(f"Processing {len(FILES)} files...")
    print()
    
    for fp in FILES:
        changes = replace_in_file(fp)
        total_changes += changes
        if changes > 0:
            total_files += 1
    
    print()
    print(f"Done: {total_files} files modified, {total_changes} total replacements")

if __name__ == "__main__":
    main()
