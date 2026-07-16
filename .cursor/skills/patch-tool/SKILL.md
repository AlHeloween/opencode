---
name: patch-tool
description: Apply apply_patch-format patches via adm with ADID backups and per-file ledgers.
---

intent:
Apply apply_patch-format patches via adm with ADID backups and per-file ledgers.
Use when you need apply_patch with ADID rotated backups and JSONL ledgers.

state:
  tool: tools/adm.exe --patch-tool

scope:
  - apply_patch patches with ADID backups

constraints:
  - patch_format_required: True

invariants:
  (none)

forbidden_actions:
  (none)

## Command
Apply patch: tools/adm.exe --patch-tool <patch_file>
Dry-run: tools/adm.exe --dry-run --patch-tool <patch_file>

## Patch Format
Files must start with *** Begin Patch and end with *** End Patch.
Operations: *** Update File: ..., *** Add File: ..., *** Delete File: ..., *** Move to: <new_path>

## Notes
Pre-creates rotated backups for any existing target files.
Emits per-file entries to <file>.adid.log.jsonl with "command": "--patch-tool".
Fallback: python -m adm --patch-tool <patch_file> when tools/adm not present.
