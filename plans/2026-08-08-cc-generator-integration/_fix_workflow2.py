#!/usr/bin/env python3
"""Fix: add IDENTITY_MATCH to universal pack."""
p = r'D:\zPython\opencode\prompts_kernel\27_runtime_dict.py'
c = open(p).read()
old = '                  "READ_ENTIRE_FILE", "NO_SCRIPT_EDITING", "TONE_AND_STYLE"),'
new = '                  "READ_ENTIRE_FILE", "NO_SCRIPT_EDITING", "TONE_AND_STYLE", "IDENTITY_MATCH"),'
assert old in c, 'universal pack not found'
c = c.replace(old, new)
open(p, 'w').write(c)
print('Added IDENTITY_MATCH to universal pack')
