# Kernel assembly

Production system prompt is `packages/opencode/src/session/prompt/reasoning_prompt.txt`.
Canonical source is `prompt_kernel/source.py`.

## Build

```powershell
python -m pytest prompt_kernel/tests/ -q
python -m prompt_kernel --install
```

`python build.py --only kernel` runs the same install. Rebuild the opencode binary after install. Open a new session: a checkpointed session keeps the previous system prefix until compact.

## Layout of the installed prompt

1. `KERNEL_MAP` — nodes, spine, side/back/terminal edges
2. `ABI_AND_VOCABULARY` — terms, `@INFOMARK`, `@SV_FORMAT` YAML, `@SOURCE_ROUTING`, state, action classes
3. `SHARED_RULES` — including `@SIMULATION_ERROR` and `@CURRENT_SV`
4. `GATE_REFINEMENT` — `G1 GROUND` … `G9 CLEAN_STATE`
5. Cross-cutting protocols — semantic attention (SV knobs) and evolution
6. Identity contracts — `BUILD_MODE`, `PLAN_MODE`, …

`source.py` is the only semantic owner. `validate.py` rejects broken topology before render. `python -m prompt_kernel` without `--install` only stamps `prompt_kernel/dist/`.

## Assembly point

The map is first. `@SV_FORMAT` is the YAML schema of a semantic vector, not the thing emitted. After every response the current observed vector is written in that format (`@CURRENT_SV`). `@ORACLE` pins Exact medoids; the rest is Unknown.

