---
name: patch-tool
description: Apply apply_patch-format patches via adm with backups and per-file ledgers.
---

# patch-tool

Apply an `apply_patch`-format patch file with rotated backups and per-file JSONL ledgers.

## Command

- Apply: `tools/adm.exe --patch-tool <patch_file>`
- Dry-run: `tools/adm.exe --dry-run --patch-tool <patch_file>`

## Notes

- Creates rotated backups for existing target files
- Patch files use `*** Begin Patch` / `*** End Patch` with file operations
