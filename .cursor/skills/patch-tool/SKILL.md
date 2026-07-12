---
name: patch-tool
description: Apply apply_patch-format patches via adm with ADID backups and per-file ledgers.
---
intent:
Skill definition — see opencode_prompts_kernel.py for canonical typed dict.
This file is a reference copy; all authoritative definitions live in the kernel.

state:
source: opencode_prompts_kernel.py (canonical typed dict)

scope:
- skill-specific operations
- tool usage within skill domain
- All behavior defined in opencode_prompts_kernel.py as typed Python dict

constraints:
- Follow kernel specification for all operations
- All behavior defined in opencode_prompts_kernel.py

invariants:
- Canonical definition lives in opencode_prompts_kernel.py
- This file is a reference copy

forbidden_actions:
- Deviating from kernel specification
- Using undefined or implicit behavior

acceptance_tests:
- Behavior matches kernel spec
- All operations repeatable from kernel definition

# patch-tool (adm wrapper for apply_patch)

Use this when you need to apply an `apply_patch`-format patch file in a way that still creates ADID rotated backups and per-file JSONL ledgers.

## Command

- Apply a patch file: `tools/adm.exe --patch-tool <patch_file>` (or `python -m adm --patch-tool <patch_file>` in a repo checkout).
- Dry-run (no writes): `tools/adm.exe --dry-run --patch-tool <patch_file>`

## Notes

- This wrapper calls the bundled `apply_patch.exe` and pre-creates rotated backups for any existing target files.
- It emits per-file entries to `<file>.adid.log.jsonl` with `"command": "--patch-tool"` so you can audit what changed.
- Patch files must start with `*** Begin Patch` and end with `*** End Patch`, with file operations like `*** Update File: ...`, `*** Add File: ...`, `*** Delete File: ...`, and `*** Move to: <new_path>` (rename after update).

