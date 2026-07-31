# ADID Framework 15.4.3 candidate (split)

Source monofile: repo-root `reasoning_candidate.txt` (not the runtime system prompt).

## Layout

```
docs/adid_15_4_3/
  README.md                 ← this file
  ALIGNMENT.md              ← reuse / improve matrix vs opencode kernel
  split_candidate.py        ← re-split from monofile
  ASSEMBLED.md              ← full reassembly of raw fragments
  fragments/                ← raw split of candidate
  fragments_improved/       ← fractal_only patches (01, 02, 06)
```

## Runtime vs candidate

| Stack | Path | Purpose |
|-------|------|---------|
| **Runtime identity** | `packages/opencode/src/session/prompt/reasoning/*` | Small pocket protocol in system prefix |
| **ADID reference** | `docs/adid_15_4_3/fragments*` | Full framework essay, split for editing |

Do **not** feed all fragments into the model system prefix. Pull only proven deltas into SPECS / ALGORITHM_CARD / plan docs.

## Split / assemble

```bash
python docs/adid_15_4_3/split_candidate.py
```
