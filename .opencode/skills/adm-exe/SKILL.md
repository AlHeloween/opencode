---
name: adm-exe
description: Use the ADID Update Manager (adm) executable for declarative updates, verify-all, rollback, and templates.
---

intent:
Declarative file updates, verification, rollback, and templates using the ADID Update Manager executable.
Always use template then edit — never hand-craft XML.

state:
  tool: tools/adm.exe
  fallback: python -m adm

scope:
  - templates
  - apply
  - verify
  - rollback
  - replay

constraints:
  - use_tools_adm_when_present: True
  - never_create_descriptors_from_scratch: True
  - use_template_then_edit: True

invariants:
  - Must always use template — never hand-craft XML descriptors
  - Use tools/adm when present (stable copy avoids toolchain break)

forbidden_actions:
  - Writing XML descriptors from scratch
  - Using git restore when adm --rollback is available

acceptance_tests:
  - tools/adm --verify-all returns clean report

## Invocation
Primary: tools/adm (Unix) or tools/adm.exe (Windows) when project has it.
Fallback: python -m adm. Use tools/adm when present — stable copy avoids toolchain break.

## Workflow
1. Run tools/adm --help
2. Run tools/adm --template all  (or replace, overwrite, create, insert, delete, pattern-rule, binary-overwrite, binary-hex-replace, refactor-replace-function) -> creates timestamped descriptor under updates/
3. Edit that file: set <file>, <mode>, payload in <content_md5_*>
4. Run tools/adm --apply updates/<file>.xml  (use --dry-run first to preview)
5. Run tools/adm --verify-all src tests adid_tests
To rollback: tools/adm --rollback <file> (NOT git restore)

## Key Commands
--template NAME [dir]: Generate timestamped XML descriptor template
--apply updates.xml: Apply all update blocks (atomic, backup, ledger)
--replay-updates [dir]: Inspect descriptors in chronological order (no writes)
--fix-xml updates.xml: Normalize descriptor md5/size tags
--verify-all [root]: Verify integrity, write report to logs/
--verify-all-fix-xml: Verify + rewrite descriptor tags
--rollback <file>: Restore from latest backup
--list-backups <file>: Show backup history
--list-diff <file> [N]: Unified/hex diff against N backups
--patch-tool <patch_file>: Apply apply_patch-format patch with ADID backups
--move <src> <dst>: Move file + rewrite path references in updates/ and roots
All mutations create backups and ledger entries.
