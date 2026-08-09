"""Fix remaining edge cases after initial @G rename."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ── 1. core_schemas.yaml: rename YAML gate keys and tag values ──
def fix_core_schemas():
    path = ROOT / "prompts_kernel" / "core_schemas.yaml"
    content = path.read_text(encoding="utf-8")
    original = content
    
    # Rename YAML keys: "  G1:" → "  GATE_1_GROUND:"
    yaml_keys = [
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
    
    # Only replace when "  GN:" appears at start of line (YAML key, not inside string)
    for old, new in yaml_keys:
        content = re.sub(r'(?m)^(\s+)' + re.escape(old), r'\1' + new, content)
    
    # Rename tag values: "tag: G1" → "tag: GATE_1_GROUND" (inside YAML strings)
    tag_vals = [
        ("tag: G9", "tag: GATE_9_CLEAN_STATE"),
        ("tag: G8", "tag: GATE_8_ORACLE"),
        ("tag: G7", "tag: GATE_7_IMPLEMENT"),
        ("tag: G6", "tag: GATE_6_GROUND_PLAN"),
        ("tag: G5", "tag: GATE_5_CONCERN_LOOP"),
        ("tag: G4", "tag: GATE_4_AUTHORIZE"),
        ("tag: G3", "tag: GATE_3_MASTER_PLAN"),
        ("tag: G2", "tag: GATE_2_DECOMPOSE"),
        ("tag: G1", "tag: GATE_1_GROUND"),
    ]
    for old, new in tag_vals:
        content = content.replace(old, new)
    
    # Also rename inline bare G refs in YAML values (e.g. "envelope_ok: G6")
    # These appear at end of strings, after commas or colons
    inline_refs = [
        ("G9", "GATE_9_CLEAN_STATE"),
        ("G8", "GATE_8_ORACLE"),
        ("G7", "GATE_7_IMPLEMENT"),
        ("G6", "GATE_6_GROUND_PLAN"),
        ("G5", "GATE_5_CONCERN_LOOP"),
        ("G4", "GATE_4_AUTHORIZE"),
        ("G3", "GATE_3_MASTER_PLAN"),
        ("G2", "GATE_2_DECOMPOSE"),
        ("G1", "GATE_1_GROUND"),
    ]
    for old, new in inline_refs:
        # Match "GN" when it's a standalone token (preceded by space/colon/comma, followed by space/comma/}/newline)
        # But NOT when preceded by @ (already done) or part of a larger token
        # Use negative lookbehind for @ and word chars
        content = re.sub(r'(?<!@)(?<!\w)' + re.escape(old) + r'(?!\w)', new, content)
    
    if content != original:
        path.write_text(content, encoding="utf-8", newline="\n")
        print(f"  OK: core_schemas.yaml fixed")
    else:
        print(f"  --: core_schemas.yaml (no changes)")


# ── 2. 00_map.txt: rename gate dispatch table entries ──
def fix_00_map():
    path = ROOT / "prompts_kernel" / "reasoning" / "00_map.txt"
    content = path.read_text(encoding="utf-8")
    original = content
    
    # Table entries: "| G1 GROUND |" → "| GATE_1_GROUND |"
    # Pattern: | GN NAME |
    table_entries = [
        ("G9 CLEAN_STATE", "GATE_9_CLEAN_STATE"),
        ("G8 ORACLE", "GATE_8_ORACLE"),
        ("G7 IMPLEMENT", "GATE_7_IMPLEMENT"),
        ("G6 GROUND_PLAN", "GATE_6_GROUND_PLAN"),
        ("G5 CONCERN_LOOP", "GATE_5_CONCERN_LOOP"),
        ("G4 AUTHORIZE", "GATE_4_AUTHORIZE"),
        ("G3 MASTER_PLAN", "GATE_3_MASTER_PLAN"),
        ("G2 DECOMPOSE", "GATE_2_DECOMPOSE"),
        ("G1 GROUND", "GATE_1_GROUND"),
    ]
    for old, new in table_entries:
        content = content.replace(old, new)
    
    # Also fix "no G7 mutation" → "no GATE_7_IMPLEMENT mutation"
    # And "@G7" / "@G6" → should already be done from first pass
    
    if content != original:
        path.write_text(content, encoding="utf-8", newline="\n")
        print(f"  OK: 00_map.txt fixed")
    else:
        print(f"  --: 00_map.txt (no changes)")


# ── 3. 27_runtime_dict.py: rename category values and comments ──
def fix_27_runtime_dict():
    path = ROOT / "prompts_kernel" / "27_runtime_dict.py"
    content = path.read_text(encoding="utf-8")
    original = content
    
    # Replace category string values: "G1" → "GATE_1_GROUND"
    cat_vals = [
        ('"G9"', '"GATE_9_CLEAN_STATE"'),
        ('"G8"', '"GATE_8_ORACLE"'),
        ('"G7"', '"GATE_7_IMPLEMENT"'),
        ('"G6"', '"GATE_6_GROUND_PLAN"'),
        ('"G5"', '"GATE_5_CONCERN_LOOP"'),
        ('"G4"', '"GATE_4_AUTHORIZE"'),
        ('"G3"', '"GATE_3_MASTER_PLAN"'),
        ('"G2"', '"GATE_2_DECOMPOSE"'),
        ('"G1"', '"GATE_1_GROUND"'),
    ]
    for old, new in cat_vals:
        content = content.replace(old, new)
    
    # Replace comment headers: "# G1: GROUND" → "# GATE_1_GROUND"
    comment_vals = [
        ("# G9: CLEAN_STATE", "# GATE_9_CLEAN_STATE"),
        ("# G8: ORACLE", "# GATE_8_ORACLE"),
        ("# G7: IMPLEMENT", "# GATE_7_IMPLEMENT"),
        ("# G6: GROUND_PLAN", "# GATE_6_GROUND_PLAN"),
        ("# G4: AUTHORIZE", "# GATE_4_AUTHORIZE"),
        ("# G3: MASTER_PLAN", "# GATE_3_MASTER_PLAN"),
        ("# G2: DECOMPOSE", "# GATE_2_DECOMPOSE"),
        ("# G1: GROUND", "# GATE_1_GROUND"),
    ]
    for old, new in comment_vals:
        content = content.replace(old, new)
    
    if content != original:
        path.write_text(content, encoding="utf-8", newline="\n")
        print(f"  OK: 27_runtime_dict.py fixed")
    else:
        print(f"  --: 27_runtime_dict.py (no changes)")


# ── 4. 01_gates.txt: fix bare G refs in prose ──
def fix_01_gates():
    path = ROOT / "prompts_kernel" / "reasoning" / "01_gates.txt"
    content = path.read_text(encoding="utf-8")
    original = content
    
    # Fix bare G references in branch descriptions
    # "-> G6" → "-> GATE_6_GROUND_PLAN"
    content = content.replace("-> G6", "-> GATE_6_GROUND_PLAN")
    # "return_to_G2" → "return_to_GATE_2_DECOMPOSE"
    content = content.replace("return_to_G2", "return_to_GATE_2_DECOMPOSE")
    # "re_ask_G4" → "re_ask_GATE_4_AUTHORIZE"
    content = content.replace("re_ask_G4", "re_ask_GATE_4_AUTHORIZE")
    
    if content != original:
        path.write_text(content, encoding="utf-8", newline="\n")
        print(f"  OK: 01_gates.txt fixed")
    else:
        print(f"  --: 01_gates.txt (no changes)")


def main():
    print("Fixing remaining edge cases...")
    print()
    fix_core_schemas()
    fix_00_map()
    fix_27_runtime_dict()
    fix_01_gates()
    print()
    print("Done.")

if __name__ == "__main__":
    main()
