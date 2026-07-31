# Reasoning protocol fragments

**Reasoning is a mode protocol**, not a dump of external skills.

Edit the numbered `*.txt` files here, then assemble:

```bash
python packages/opencode/script/assemble_reasoning.py
```

That overwrites `../reasoning.txt` (imported by `ProviderTransform.systemPromptParts`).

| Fragment | Topic |
|----------|--------|
| `00_map.txt` | Prompt slot map, source layout, skill boundary |
| `01_behavior_hygiene.txt` | Shared behavior, secrets, hygiene, compaction |
| `02_algorithms.txt` | SVM filter, classify, invariants, bug-fix |
| `03_gates.txt` | Gates 1–9 workflow |
| `04_infomark_oracles.txt` | InfoMark separations + oracle define/run/PASS→Exact |

Do **not** embed adm/cmd_runner/rag skill manuals here — those live in the skill package.
