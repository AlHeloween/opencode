#!/usr/bin/env python3
"""Add IDENTITY_MATCH rule and replace duped invariants."""
import re, os

PROJECT = r'D:\zPython\opencode'

# === 1. Add IDENTITY_MATCH to dictionary ===
path = os.path.join(PROJECT, 'prompts_kernel', '27_runtime_dict.py')
with open(path) as f: c = f.read()

# Add rule body
old = '    "MEMORY_LINKS": "every summary and message* must carry message IDs for session-read recovery",\n\n    # G2: DECOMPOSE'
new = '    "MEMORY_LINKS": "every summary and message* must carry message IDs for session-read recovery",\n    "IDENTITY_MATCH": "Agent identity must match canonical name exactly (e.g. build_mode not \'build\', coder_agent not \'coder\'). No abbreviations or aliases.",\n\n    # G2: DECOMPOSE'
assert old in c, 'MEMORY_LINKS pattern not found'
c = c.replace(old, new)
print('Added IDENTITY_MATCH rule body')

# Add to categories
old_cat = '    "MEMORY_RANK": "G1", "MEMORY_LINKS": "G1",'
new_cat = '    "MEMORY_RANK": "G1", "MEMORY_LINKS": "G1",\n    "IDENTITY_MATCH": "G1",'
c = c.replace(old_cat, new_cat)
print('Added to categories')

# Add to owners
old_own = '    "MEMORY_LINKS": "memory",'
new_own = '    "MEMORY_LINKS": "memory",\n    "IDENTITY_MATCH": "identity",'
c = c.replace(old_own, new_own)
print('Added to owners')

# Add to BASE_CONTRACT
old_base = '    "NAMING", "MEMORY_RANK", "MEMORY_LINKS", "ADID_FREEZE",\n)'
new_base = '    "NAMING", "MEMORY_RANK", "MEMORY_LINKS", "ADID_FREEZE",\n    "IDENTITY_MATCH",\n)'
c = c.replace(old_base, new_base)
print('Added to BASE_CONTRACT')

with open(path, 'w') as f: f.write(c)

# === 2. Replace all "Identity id is X (not bare 'Y')" with @IDENTITY_MATCH ===
path = os.path.join(PROJECT, 'prompts_kernel', '20_specs_agents.py')
with open(path) as f: c = f.read()

# Pattern: "Identity id is <name> (not bare '<short>')"  → "@IDENTITY_MATCH"
# Find all matches and replace
pattern = re.compile(r'"Identity id is \w+ \(not bare \'\w+\'\)"')
matches = pattern.findall(c)
print(f'Found {len(matches)} identity invariants to replace')
c = pattern.sub('"@IDENTITY_MATCH"', c)

with open(path, 'w') as f: f.write(c)
print('Replaced identity invariants with @IDENTITY_MATCH')
