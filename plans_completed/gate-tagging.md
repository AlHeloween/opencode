# Plan: Complete @tag coverage for kernel

## Problem
`refdupes.py` embeds 20 tagged sections but misses the GATE DEFINITIONS (G1-G9)
because they're injected from `core_schemas.yaml` without `@` tags.
Also 15 `@REF` links are unresolved — they point to gate sections that have no tags.

## Solution
Inject `@G1`-`@G9` tags during `@schema:` resolution so every gate section
becomes an anchor. Then `refcheck.py` resolves 100% and `refdupes.py`
embeds gate definitions for real semantic comparison.

## Steps

### 1. Tag schema sections in `core_schemas.yaml`
Add `tag: G1`, `tag: G2` ... `tag: G9` fields to each gate definition.
These are metadata for the assembler, not model-facing content.

### 2. Update `_assemble_prompts_kernel.py`  
In `_section_to_comment_lines()`: when rendering a gate section that has a `tag` field,
prepend `### G{N}: {name} (@G{N})` header before the YAML dump.

### 3. Regenerate and validate
- `python -m prompts_kernel.tools.tag_sections` (already done)
- `python -m prompts_kernel.tools.refcheck` → expect 100% resolution
- `python -m prompts_kernel.tools.refdupes --top 5` → richer table with gate definitions

### 4. Update refdupes to resolve through links
When embedding `@G4`, follow the reference chain:
`@G4` → gate definition → its `@WRITE_SCOPE`, `@AUTH_RESOLVER` references
Embed the TARGET definition text, not the link text.

## Smoke Tests
- `refcheck.py` → 0 unresolved
- `refgraph.py G4` → shows chain to WRITE_SCOPE, AUTH_RESOLVER
- `refdupes.py --top 5` → table includes G1-G9 rows
- `pytest prompts_kernel/tests/ -q` → 482 pass
