# prompts_kernel/tools — Structural Prompt Engineering Toolkit

Python tools for analyzing, validating, and navigating the GATED agent kernel.

## Tools

### `refcheck.py` — Reference Validator

Verifies all `@REF` cross-references in the unified kernel resolve to existing anchors.

```bash
python -m prompts_kernel.tools.refcheck
```

Output:
- Count of `@references` found and resolved
- List of unresolved (broken) references
- Coverage report: which anchors have no incoming references

Used as a build-time gate — CI should run this before shipping the kernel.

### `refgraph.py` — Reference Graph Navigator

Builds optimal traversal paths through the kernel from starting keywords.

```bash
# Navigate from specific references
python -m prompts_kernel.tools.refgraph @G1 @G8 @SV_OUTPUT

# Show full reference graph
python -m prompts_kernel.tools.refgraph --all

# Limit traversal depth
python -m prompts_kernel.tools.refgraph @CLAIM_PROMOTION --depth=3
```

Output:
- Matched starting sections
- Optimal BFS reading order
- Edge list for each node

## Future: BGE Semantic Deduplication

Planned: use BGE v1.5 embeddings to detect semantically duplicate rules.

Pipeline:
1. `refcheck.py` extracts all `@REF` → anchor mappings
2. For each anchor, extract full defining text
3. Embed with BGE v1.5
4. Cosine similarity matrix → threshold > 0.85 = duplicate
5. Report real duplicates (vs normalized-string false positives)

## Integration

- **CI**: `python -m prompts_kernel.tools.refcheck` as build gate
- **Docs**: linked from `DOCINDEX.md`
- **AGENTS.md**: tool usage guide for kernel development
