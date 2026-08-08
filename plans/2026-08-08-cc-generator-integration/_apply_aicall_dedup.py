#!/usr/bin/env python3
"""Apply aicall-verified semantic dedup replacements."""
import re, os

PROJECT = r'D:\zPython\opencode'

# Map: filename -> [(old_text, replacement)]
replacements = {
    '20_specs_agents.py': [
        # BUILD_MODE
        ('"Identity id is build_mode (not bare \'build\')"', '"@IDENTITY_MATCH"'),
        ('"Read current state before assuming file content"', '"@READ_ENTIRE_FILE"'),
        ('"On stuck failure: universalsearch web+code before custom workaround"', '"@REUSE_BEFORE"'),
        ('"Inventing workarounds after stuck failures without universalsearch web+code"', '"@REUSE_BEFORE"'),
        # CODER_AGENT
        ('"Identity id is coder_agent (not bare \'coder\')"', '"@IDENTITY_MATCH"'),
        ('"Committing unless user explicitly asks"', None),  # handled below
        # EXPLORER_AGENT
        ('"Identity id is explorer_agent (not bare \'explore\' / codegraph mode explore)"', '"@IDENTITY_MATCH"'),
        ('"Running destructive bash commands"', '"@CONSTITUTION_BLOCKS"'),
        # GENERAL_AGENT
        ('"Identity id is general_agent"', '"@IDENTITY_MATCH"'),
        # MEDIA_AGENT
        ('"Identity id is media_agent"', '"@IDENTITY_MATCH"'),
        # ORCHESTRATOR_AGENT
        ('"Identity id is orchestrator_agent"', '"@IDENTITY_MATCH"'),
        ('"Every task has concrete test specifications"', '"@SMOKE_BEFORE"'),
        ('"Smoke Tests required before dispatching implementation workers"', '"@SMOKE_BEFORE"'),
        ('"Using edit/write outside plans/*.md"', '"@WRITE_SCOPE"'),
        ('"Dispatching for plans without Smoke Tests (or smoke:N/A)"', '"@SMOKE_BEFORE"'),
        # PLAN_MODE
        ('"Identity id is plan_mode (not bare \'plan\')"', '"@IDENTITY_MATCH"'),
        ('"Must never modify product/source files — only plans/**"', '"@WRITE_SCOPE"'),
        ('"Editing source, tests, configs, or non-plan paths"', '"@WRITE_SCOPE"'),
        ('"Using shell to rewrite product files"', '"@NO_SCRIPT_EDITING"'),
        # RESEARCHER_AGENT
        ('"Identity id is researcher_agent"', '"@IDENTITY_MATCH"'),
        # SUMMARY_AGENT
        ('"Identity id is summary_agent"', '"@IDENTITY_MATCH"'),
        # TITLE_AGENT
        ('"Identity id is title_agent"', '"@IDENTITY_MATCH"'),
    ],
    '24_specs_policies.py': [
        ('"ADID receivers must not be hand-edited by coding agents"', '"@ADID_FREEZE"'),
        ('"Product SPECS/reasoning stay host-agnostic — no worktree paths or external CLI cookbooks"', '"@ADID_OPS"'),
        ('"Hand-editing ADID framework rule receivers"', '"@ADID_FREEZE"'),
        ('"Encoding host governance, skill manuals, or external tool CLIs into SPECS"', '"@ADID_OPS"'),
        ('"Shell for file ops (ls, cat, grep, redirection) when product tools exist"', '"@ADID_OPS"'),
        ('"Embedding external CLI cookbooks into SPECS"', '"@ADID_OPS"'),
        ('"universalsearch web+code before agent for prior art"', '"@REUSE_BEFORE"'),
        # AGENT_DIRECTIVES
        ('"Tag claims: [Exact], [Inferred], [Hypothetical], [Guess], [Unknown]"', '"@INFOMARK_SEP"'),
        ('"Claiming fixed without oracle evidence"', '"@VERIFY_OUTCOME"'),
        # GROUNDING_RULES
        ('"Before claiming \'not found\', check intent-appropriate tool per @G1.search_intent"', '"@GROUND"'),
        ('"Internal knowledge alone insufficient for Inferred confidence"', '"@INFOMARK_SEP"'),
        ('"Applying single linear tool order without intent routing"', '"@GROUND"'),
        ('"Claiming \'not found\' without checking intent-appropriate tool"', '"@GROUND"'),
        # PLANNING
        ('"Completed plans \u2192 plans_completed/ immediately."', '"@PLANS_COMPLETED"'),
        ('"Mode 1 linear step lists for multi-step work"', '"@DECOMPOSE"'),
        # REASONING_MODE
        ('"All claims must be tagged with epistemic markers: [Exact] only if the fact is in the current conversation"', '"@INFOMARK_SEP"'),
    ],
}

total = 0
for filename, reps in replacements.items():
    path = os.path.join(PROJECT, 'prompts_kernel', filename)
    with open(path) as f:
        content = f.read()
    
    for old, new in reps:
        if new is None:
            continue
        if old in content:
            content = content.replace(old, new)
            total += 1
            print(f'  {filename}: {old[:60]}... → {new}')
        else:
            print(f'  {filename}: NOT FOUND: {old[:60]}...')
    
    # Also handle CODER_AGENT committing rule (shared with BUILD_MODE, referenced above)
    # Remove duplicate "Committing unless user explicitly asks" — already handled by BUILD_MODE
    
    with open(path, 'w') as f:
        f.write(content)

print(f'\nApplied {total} replacements')
