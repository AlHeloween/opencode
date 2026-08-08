#!/usr/bin/env python3
"""Assemble full kernel from fragments + runtime dictionary."""
import sys, os
PROJECT = r'D:\zPython\opencode'
sys.path.insert(0, os.path.join(PROJECT, 'prompts_kernel'))
from _kernel_precompiled import assemble_reasoning, render_runtime_kernel

r = assemble_reasoning()
d = render_runtime_kernel(tier='A')
full = r + '\n' + d

out = os.path.join(PROJECT, 'packages', 'opencode', 'src', 'session', 'prompt', 'reasoning_prompt.txt')
with open(out, 'w', encoding='utf-8', newline='\n') as f:
    f.write(full)

# Also generate .mdc
frontmatter = '---\ndescription: "GATED agent — 9-gate spine, semantic vector, rules, contracts"\nalwaysApply: true\n---\n\n'
mdc_path = os.path.join(PROJECT, 'packages', 'opencode', 'src', 'session', 'prompt', 'reasoning_prompt.mdc')
with open(mdc_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(frontmatter + full)

import re
idx = full.find('\nRULES:')
end = full.find('\n# Tier B', idx)
if end == -1: end = len(full)
rules = re.findall(r'^  ([A-Z][A-Z_0-9]{2,}):', full[idx:end], re.M)
print(f'Kernel: {len(full)}B, {len(rules)} rules, @CC_TAIL={"@CC_TAIL" in full}')
print(f'.mdc: {len(frontmatter+full)}B')
