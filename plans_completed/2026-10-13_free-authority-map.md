# Free Authority Map — every paid source name gets a measured free authoritative equivalent

<!-- intention: the evidence ladder's primary-authority rung names paid databases that a keyless service cannot read (its «honest limits» leave them on Hypothetical) -> every paid name has a MEASURED free authoritative equivalent (university library, open repository, government source) with a documented read and search interface, so the search service can raise results from it to Inferred with a source stamp -->

<!-- goal_sv: free-authority, keyless-api, authority-class, search-and-read-interfaces, live-call-verification -->

- **plan_id:** 2026-10-13_free-authority-map
- **revision:** 1
- **state:** ACTIVE
**Status:** COMPLETE
- **reported:** owner's delegation, 2026-10-13 — the Superlight stack (`D:\zPython\universal-search`, read-only) leaves IEEE Xplore, ACM DL, INSPEC, Cochrane, CINAHL, HeinOnline, Westlaw, LexisNexis, JSTOR as «paywalled, cannot be keyless»; the kernel's §1.3 @SOURCE_ROUTING table names more paid ones.
- **why it matters:** the ladder raises a result to Inferred only from a primary authority carrying a source stamp; a discipline whose primary rung is a paid database stalls at Hypothetical. The free equivalents exist — university libraries, open repositories, government sources — and this plan MEASURES them instead of assuming them.

```yaml
Keywords: free-authority 0.30, keyless-api 0.24, authority-class 0.18, live-call 0.16, search-and-read 0.12
Semantic dominant: Every paid source name in the evidence ladder gets a measured free authoritative substitute with a documented search and read interface.
md5: 3b7e1f4a2c9d0e5b8a6f1c3d2e4b5a7c
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Goal

For every paid source name the brief lists, find the best FREE authoritative substitute for the same discipline, record its SEARCH interface (endpoint, method, query params, response fields: title/url/authors/date/abstract/identifier) and READ interface (abstract or full text, format, markdown-ability), its key need, its rate/politeness rule, its license and its owner institution with an `authority_class` to stamp results with — and ground each claim on the ladder (docs page = Hypothetical; provider's own docs = Inferred; one live call returning results = Exact).

Scope: research and mapping ONLY — no product code. The service (`D:\zPython\universal-search`) is NOT edited by this plan; nothing in it is launched. The kernel's own name lists are NOT touched (they activate knowledge; never cut or paraphrased) — only the service gets a free mapping.

## The paid names (28 unique, counted against the brief)

Superlight «Honest limits» (9): IEEE Xplore, ACM DL, INSPEC, Cochrane, CINAHL, HeinOnline, Westlaw, LexisNexis, JSTOR.

Kernel §1.3 @SOURCE_ROUTING additional names (20 rows, 1 duplicate): PsycINFO, PsycArticles, Compendex, Engineering Village, Reaxys, SpringerMaterials, GeoRef, GeoScienceWorld, SocINDEX, SocAbstracts, AgeLine, CAB_Abstracts, EdSource, LearnTechLib, Project MUSE, APS Journals, IOPscience, CINAHL (dup), MEDLINE (free via PubMed — confirm), MatWeb.

Unique total: 9 + 20 − 1 = **28**. Every one gets a row in REPORT.md.

## Rules (owner's delegation, 2026-10-13)

- **Keyless first.** A source needing free registration goes to a separate **tier 2** list; no accounts are registered, no keys entered, no key of the owner's used.
- Anything that would need evading a block, a captcha or a login is **DROPPED**, not worked around; the drop reason is recorded.
- **Documented APIs and bulk interfaces only** — no scraping of pages that forbid it.
- Grounding rungs: documentation page = Hypothetical; the same page **read from the provider's own docs** = Inferred; **one live call returning results = Exact**. For every live call the PREDICTION is written first, then the request, status, the first result's fields, and whether the prediction held; an off-prediction outcome is logged, not hidden.
- Live calls and web research run through `researcher_agent` sub-agents (owner rule: trials go there) against documented free APIs — no WebFetch of arbitrary pages.
- Gaps are honest: where no free authority exists for a discipline, the report says so and names the nearest open source **with what it lacks**; never a paid fallback.

## Deliverables

- `experiments/2026-10-13_free-authorities/sources.json` — one object per substitute (tier 1 / tier 2 / dropped), plus a coverage map (paid name → substitute id) and a gaps list.
- `experiments/2026-10-13_free-authorities/REPORT.md` — a row per paid name (28), per-substitute detail, the live-call ledger, and the counts.

## Smoke Tests

1. **JSON validity:** `python -m json.tool experiments/2026-10-13_free-authorities/sources.json` → exit 0; one object per substitute.
2. **Coverage count:** REPORT.md carries one row for each of the 28 paid names above (counted against this plan's list, no name missing).
3. **Rung rule:** every row either records a live call (prediction, request URL, status, first-result fields, prediction-held verdict) or is marked `UNMEASURED` with its why.
4. **Field completeness:** every substitute object names search endpoint/method/params/fields, read interface + format, key need, rate/politeness, license, docs URL, owner institution, authority_class.
5. **Map visibility:** `svm render` names this plan in `plans/MASTER_PLAN.md`; `planstatus` coverage reports no misses.
6. **Fallibility:** failed or off-prediction live calls are visible as such in REPORT.md — the ledger is distinct, falsifiable outcomes, not uniform success scanning.

## Tasks

- [x] **S1 — Cross-discipline registries & resolvers.** Crossref, OpenAlex, Unpaywall, Zenodo, OpenAIRE, DOAJ, CORE (keyless — live), fatcat (API unreachable — dropped). <!-- sv: crossref,openalex,zenodo,openaire,doaj,fatcat -->
- [x] **S2 — Biomedicine & health.** MEDLINE confirmed free (PubMed E-utilities — 3 live calls), Europe PMC (+ fullTextXML), PMC OA (oa.fcgi 404 → superseded), ClinicalTrials.gov; Cochrane and CINAHL mapped (abstract/metadata free via PubMed). <!-- sv: pubmed,europepmc,pmc-oa,clinicaltrials,cochrane,cinal -->
- [x] **S3 — Physics, astronomy, CS & engineering.** arXiv, INSPIRE-HEP (live); DBLP blocked by Anubis (dropped); Semantic Scholar 429 (tier 2); NASA ADS tier-2; IEEE Xplore, ACM DL (now fully OA since 2026-01-01 — measured), INSPEC, Compendex, Engineering Village, APS Journals, IOPscience mapped. <!-- sv: arxiv,inspirehep,dblp,semanticscholar,ieee,acm -->
- [x] **S4 — Chemistry & materials.** PubChem, COD, AFLOW (live); Materials Project tier-2 (key needed — fetched); Reaxys, SpringerMaterials, MatWeb mapped; NIST WebBook — no API found, UNMEASURED. <!-- sv: pubchem,cod,aflow,materials-project,reaxys -->
- [x] **S5 — Geoscience & agriculture.** USGS Publications Warehouse (live); AGRIS — no documented API found (dropped as machine interface); GeoRef, GeoScienceWorld, CAB Abstracts mapped. <!-- sv: usgs,agris,georef,geoscienceworld,cab -->
- [x] **S6 — Social sciences & education.** ERIC, OECD, OSF/SocArXiv (live); PsycINFO, PsycArticles, SocINDEX, SocAbstracts, AgeLine, EdSource, LearnTechLib mapped. <!-- sv: eric,oecd,osf,socarxiv,psycinfo -->
- [x] **S7 — Law.** Harvard CAP / static.case.law, EUR-Lex SPARQL (live); CourtListener token 5/min (tier 2); GovInfo — keyed API + KEYLESS bulk (live); Cornell LII dropped (no API); HeinOnline, Westlaw, LexisNexis mapped. <!-- sv: case-law,courtlistener,govinfo,eurlex,westlaw -->
- [x] **S8 — Humanities.** HathiTrust Bib API, Internet Archive, Persée (live); OAPEN documented but REFUSED our address (recorded); DOAB unmeasured; JSTOR, Project MUSE mapped. <!-- sv: hathitrust,internetarchive,persee,oapen,jstor -->
- [x] **S9 — Assemble & close.** sources.json + REPORT.md written; counts (paid names / substituted / tier 2 / dropped / gaps); `svm render`; `_progress_log.md` entry; commit naming this plan; `_build.ps1` recorded: run `20261013T093653Z_39595b13`, exit 0, "Build complete - artifacts in dist/". <!-- sv: sources-json,report,counts,commit,closure -->

## Honest limits of this plan

- An Exact live call proves the SEARCH interface answered; it does not prove coverage parity with the paid index it stands in for — coverage differences are stated per row, not measured away.
- `free-registration` sources are documented from their own docs only (Inferred); registering is forbidden by this delegation, so their interfaces stay UNMEASURED.
- Live-call results are single-query observations on 2026-10-13; rate limits and licenses are read from the provider's own terms at that date.

## Rollback

Research-only: `git revert` of this plan's commit; no product surface, no service and no kernel list was touched.
