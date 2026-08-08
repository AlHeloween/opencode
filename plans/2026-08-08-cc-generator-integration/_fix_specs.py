#!/usr/bin/env python3
"""Fix specs and tests for new compact format."""
import os, re

PROJECT = r'D:\zPython\opencode'

# 1. Fix 31_prompt_ir.py — make _SPEC_FIELDS accept new format
path = os.path.join(PROJECT, 'prompts_kernel', '31_prompt_ir.py')
with open(path) as f: c = f.read()
c = c.replace(
    '_SPEC_FIELDS = {"intent", "state", "scope", "constraints", "invariants", "forbidden_actions", "acceptance_tests"}',
    '_SPEC_FIELDS = {"intent", "state", "scope", "constraints", "invariants", "forbidden_actions", "acceptance_tests", "gates", "contract", "inherits"}'
)
with open(path, 'w') as f: f.write(c)
print('Updated _SPEC_FIELDS')

# 2. Update DOMAIN_SOURCES in core_schemas.yaml
path = os.path.join(PROJECT, 'prompts_kernel', 'core_schemas.yaml')
with open(path) as f: c = f.read()

compact_domains = '''
domain_sources:
  tag: DOMAIN_SOURCES
  rule: check domain authority before universalsearch
  physics: [arXiv, INSPEC, IOPscience, APS_Journals, NASA_ADS]
  biology: [PubMed, BioRxiv, GenBank, NCBI_Taxonomy]
  chemistry: [PubChem, ChemRxiv, Reaxys, NIST_WebBook]
  materials: [mdx, MaterialsProject, SpringerMaterials, MatWeb]
  medicine: [PubMed, MEDLINE, CINAHL, CochraneLibrary]
  engineering: [IEEEXplore, Compendex, INSPEC, EngineeringVillage]
  cs: [ACM_DL, IEEEXplore, CiteSeerX, arXiv_CS]
  geology: [GeoRef, GeoScienceWorld, USGS_Pubs]
  sociology: [SocINDEX, SocAbstracts, ICPSR, AgeLine]
  law: [HeinOnline, Westlaw, LexisNexis, ScholarCaseLaw]
  economics: [RePEc, FRED, WorldBankData, NBER]
  history: [JSTOR, HathiTrust, InternetArchive, ProjectMUSE]
  psychology: [PsycINFO, PubMed, OSF_Preprints, PsycArticles]
  education: [ERIC, EdSource, LearnTechLib, OECD_Ed]
  anthropology: [AIO, AnthroSource, eHRAF]
  agriculture: [AGRICOLA, AGRIS, CAB_Abstracts, FAO]
'''

# Find and replace the domain_sources section
start = c.find('\ndomain_sources:')
end = c.find('\ninstitutional_sources:')
if start > 0 and end > start:
    c = c[:start] + compact_domains
    # Remove institutional_sources entirely
    c = c[:c.find('\ninstitutional_sources:')] + '\n'
    with open(path, 'w') as f: f.write(c)
    print('Updated DOMAIN_SOURCES (compact) + removed institutional_sources')

# 3. Fix test_spec_field_counts
path = os.path.join(PROJECT, 'prompts_kernel', 'tests', 'test_specs.py')
with open(path) as f: c = f.read()
# Update the counts to 0 for fields that no longer exist in compact format
old = '''            "CODER_AGENT": {"constraints": 4, "invariants": 4, "forbidden_actions": 4},
            "ORCHESTRATOR_AGENT": {"constraints": 3, "invariants": 5, "forbidden_actions": 5},
            "BUILD_MODE": {"constraints": 5, "invariants": 4, "forbidden_actions": 4},'''
new = '''            "CODER_AGENT": {"constraints": 0, "invariants": 4, "forbidden_actions": 2},
            "ORCHESTRATOR_AGENT": {"constraints": 0, "invariants": 6, "forbidden_actions": 5},
            "BUILD_MODE": {"constraints": 2, "invariants": 4, "forbidden_actions": 2},'''
c = c.replace(old, new)
with open(path, 'w') as f: f.write(c)
print('Updated test_spec_field_counts')
