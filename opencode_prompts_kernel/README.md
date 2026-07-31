# opencode_prompts_kernel (package)

Topic-sliced identity / reasoning kernel. **Do not reassemble a monofile.**

| Module | Topic |
|--------|--------|
| `01_enums` … `18_conformance` | Layer-1 algorithms (enums → conformance) |
| `19_specs_*` … `26_specs_*` | Layer-2 SPECS (agents, commands, policies) |
| `21_skills_boundary` | Skills are **not** in kernel (separate package) |
| `27_runtime_dict` / `28_runtime_render` | Model-facing dictionary + render |
| `29_syntax` / `30_epistemic` / `31_prompt_ir` | Projection / IR |

Public API:

```python
from opencode_prompts_kernel import Activity, render_runtime_kernel, _ALL_SPECS
```

CLI:

```bash
python -m opencode_prompts_kernel --render-runtime packages/opencode/src/session/prompt/opencode_prompts_kernel.txt
python -m opencode_prompts_kernel   # self-test
```

Tests: `pytest tests/kernel/ -q` (targeted modules, not one monotest).
