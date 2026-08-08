#!/usr/bin/env python3
"""Apply embedding-verified dedup: replace prose with @REF where cos>0.85."""
import json, os

PROJECT = r'D:\zPython\opencode'
data = json.load(open(os.path.join(PROJECT, 'plans/2026-08-08-cc-generator-integration/dedup_results.json')))

# Group replacements by spec file
# Spec files: 20_specs_agents.py (agents), 24_specs_policies.py (policies)
agent_specs = {'BUILD_MODE', 'CODER_AGENT', 'PLAN_MODE', 'EXPLORER_AGENT', 'GENERAL_AGENT', 
               'ORCHESTRATOR_AGENT', 'RESEARCHER_AGENT', 'MEDIA_AGENT', 'SUMMARY_AGENT', 'TITLE_AGENT'}

agent_matches = [m for m in data['matches'] if m['spec'] in agent_specs]
policy_matches = [m for m in data['matches'] if m['spec'] not in agent_specs]

def apply_replacements(filename, matches):
    path = os.path.join(PROJECT, 'prompts_kernel', filename)
    with open(path) as f:
        content = f.read()
    
    for m in matches:
        old_text = m['text']
        new_text = f"@{m['best_match']}"
        ref = f"@{m['best_match']}"
        if old_text in content:
            content = content.replace(f'"{old_text}"', f'"{ref}"')
            print(f"  {m['spec']}.{m['field']}: \"{old_text[:60]}...\" → @{m['best_match']}")
        else:
            print(f"  NOT FOUND: {m['spec']}.{m['field']}: \"{old_text[:50]}...\"")
    
    with open(path, 'w') as f:
        f.write(content)

if agent_matches:
    print("Agent specs:")
    apply_replacements('20_specs_agents.py', agent_matches)

if policy_matches:
    print("Policy specs:")
    apply_replacements('24_specs_policies.py', policy_matches)

print(f"\nApplied {len(data['matches'])} replacements")
