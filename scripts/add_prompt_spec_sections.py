"""
Batch add structured spec sections to remaining prompt/instruction files.
Run: python scripts/add_prompt_spec_sections.py
"""

import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKILL_HEADER = """intent:
Skill definition — see prompt_kernel/ for canonical typed dict.
This file is a reference copy; all authoritative definitions live in the kernel.

state:
source: prompt_kernel/ (canonical typed dict)

scope:
- skill-specific operations
- tool usage within skill domain
- All behavior defined in prompt_kernel/ as typed Python dict

constraints:
- Follow kernel specification for all operations
- All behavior defined in prompt_kernel/

invariants:
- Canonical definition lives in prompt_kernel/
- This file is a reference copy

forbidden_actions:
- Deviating from kernel specification
- Using undefined or implicit behavior

acceptance_tests:
- Behavior matches kernel spec
- All operations repeatable from kernel definition

"""

AGENTS_HEADER = """intent:
AGENTS.md — project-specific conventions and instructions.
Read by the AI for context. See prompt_kernel/ for canonical governance.

state:
source: prompt_kernel/ (canonical governance)

scope:
- project-specific conventions
- coding standards
- build and test instructions

constraints:
- All governance rules defined in prompt_kernel/
- This file supplements, not replaces, the kernel

invariants:
- Kernel definitions take precedence over this file
- This file must not contradict the kernel

forbidden_actions:
- Contradicting prompt_kernel/ governance

acceptance_tests:
- Contents consistent with kernel governance

"""

# Handle .cursor/skills/*/SKILL.md files
for root, _dirs, files in os.walk(os.path.join(PROJECT_ROOT, ".cursor", "skills")):
    for f in files:
        if f == "SKILL.md":
            fp = os.path.join(root, f)
            with open(fp, "r", encoding="utf-8") as fh:
                content = fh.read()

            if "intent:" not in content.lower():
                # Find the end of YAML frontmatter
                if content.startswith("---"):
                    parts = content.split("---", 2)
                    if len(parts) >= 3:
                        content = parts[0] + "---" + parts[1] + "---\n" + SKILL_HEADER + parts[2].lstrip("\n")
                else:
                    content = SKILL_HEADER + "\n" + content

                with open(fp, "w", encoding="utf-8") as fh:
                    fh.write(content)
                print(f"  Updated {os.path.relpath(fp, PROJECT_ROOT)}")
            else:
                print(f"  Skipped (has intent) {os.path.relpath(fp, PROJECT_ROOT)}")

# Handle remaining AGENTS.md files
AGENTS_FILES = [
    "packages/app/AGENTS.md",
    "packages/desktop/AGENTS.md",
    "packages/desktop-electron/AGENTS.md",
    "packages/opencode/src/provider/sdk/copilot/AGENTS.md",
    "packages/opencode/src/session/llm/AGENTS.md",
    "packages/opencode/test/AGENTS.md",
]

for rel in AGENTS_FILES:
    fp = os.path.join(PROJECT_ROOT, rel)
    if os.path.isfile(fp):
        with open(fp, "r", encoding="utf-8") as fh:
            content = fh.read()

        if "intent:" not in content.lower():
            content = AGENTS_HEADER + "\n" + content
            with open(fp, "w", encoding="utf-8") as fh:
                fh.write(content)
            print(f"  Updated {rel}")
        else:
            print(f"  Skipped (has intent) {rel}")
    else:
        print(f"  Not found {rel}")

print("\nDone.")
