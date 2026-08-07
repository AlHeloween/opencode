"""Add tag: KEY to all schemas in core_schemas.yaml that don't have one.

Run: python -m prompts_kernel.tools.tag_schemas
"""
import sys
from pathlib import Path
import yaml

SCHEMAS_PATH = Path(__file__).resolve().parents[1] / "core_schemas.yaml"

# Schemas that should NOT get auto-tags (already handled or special)
SKIP = {"version", "gates", "rules", "definitions"}

# Manual tag overrides for schemas where auto-derived tag would conflict
TAG_OVERRIDES = {
    "master_plan": "MASTER_PLAN_SCHEMA",  # conflicts with G3 name MASTER_PLAN
    "bug_fix": "BUG_FIX_SCHEMA",           # conflicts with BUG_FIX_CHAIN definition
    "sv_output": "SV_OUTPUT_SCHEMA",       # conflicts with SV_OUTPUT rule
    "clean_next_state": "CLEAN_NEXT_STATE",
    "task_statuses": "TASK_STATUSES",
    "action_class": "ACTION_CLASS",
    "execution_envelope": "EXECUTION_ENVELOPE",
    "claim_ledger": "CLAIM_LEDGER",
    "fractal_geometry": "FRACTAL_GEOMETRY",
    "smoke_contract": "SMOKE_CONTRACT",
    "msg_tag": "MSG_TAG",
    "signal_cluster": "SIGNAL_CLUSTER",
    "explorer_goal": "EXPLORER_GOAL",
    "domain_sources": "DOMAIN_SOURCES",
    "institutional_sources": "INSTITUTIONAL_SOURCES",
    "blocker": "BLOCKER",
    "stamps": "STAMPS",
}


def main():
    text = SCHEMAS_PATH.read_text(encoding="utf-8")
    data = yaml.safe_load(text)

    added = 0
    lines = text.split("\n")
    new_lines = []
    i = 0
    while i < len(lines):
        line = lines[i]
        new_lines.append(line)

        # Detect top-level schema key: "  keyname:" (2-space indent at top level)
        stripped = line.rstrip()
        if stripped and not stripped.startswith("#") and not stripped.startswith(" "):
            # Top-level key like "sv_output:" or "gates:"
            key = stripped.rstrip(":")
            if key in SKIP or key not in data:
                i += 1
                continue

            val = data[key]
            if isinstance(val, dict) and "tag" not in val:
                tag = TAG_OVERRIDES.get(key, key.upper().replace(" ", "_"))
                # Insert "  tag: TAG" after the key line (2-space indent)
                new_lines.append(f"  tag: {tag}")
                added += 1
                print(f"  + {key}: tag={tag}")
            elif isinstance(val, dict):
                print(f"  = {key}: already tagged ({val.get('tag')})")

        i += 1

    if added:
        SCHEMAS_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        print(f"\nAdded {added} tags to {SCHEMAS_PATH.name}")
    else:
        print("\nNo changes needed")

    return 0


if __name__ == "__main__":
    sys.exit(main())
