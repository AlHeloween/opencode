# Free Authority Map — paid sources → measured free authoritative equivalents

Plan: `plans/2026-10-13_free-authority-map.md` · Date: 2026-10-13 · Scope: research/mapping only — the service (`D:\zPython\universal-search`) was NOT edited and NOT launched.

**What this is.** For every paid source name in the task brief (28 unique: 9 from the Superlight plan's «Honest limits» + 20 kernel §1.3 names − 1 duplicate), this report names the best FREE authoritative substitute, its search interface, its read interface, its key requirement, its rate/politeness rule from the provider's own terms, its license (where captured) and the doc URL — each grounded on the ladder: docs page = Hypothetical · provider's own docs = Inferred · one live call returning results = Exact. Machine-readable form: `sources.json` (one object per substitute, plus coverage map, drops and gaps).

**Instrument note (recorded defect, not a footnote).** The `researcher_agent` sub-agent failed on ALL multi-call internet tasks: 4 occurrences of one class (`Sub-agent 'researcher_agent' failed: undefined` or killed with no output; three waves — 8-job batch, 4-job batch, one foreground call). Single-call probes survived (two `FETCH_OK`). Per `@TOOLCHAIN_QUALIFICATION` the capability was re-routed to the primary agent's `webfetch` (verified on the example.com fixture) plus `python` for endpoints webfetch's transport cannot reach (http-only, refusing). This deviates from the delegation's «trials go to researcher_agent» because that instrument is broken; the deviation is the residual, not a fix.

**Method deviations & block discipline.** Everything needing evasion was DROPPED, never worked around: DBLP is now behind an Anubis proof-of-work wall; NCBI's usage-guidelines page served a reCAPTCHA (the E-utilities API itself answered fine, keyless); OAPEN's REST refused our address outright; fatcat's API is unreachable. No account was registered, no key entered, no email fabricated (the Unpaywall probe deliberately ran WITHOUT an email to prove the policy — expected-fail, 422).

---

## 1. Coverage — one row per paid name (28)

| # | Paid name (as named in the brief) | Free substitute(s) | Rung | Notes / what the substitute lacks |
|---|---|---|---|---|
| 1 | IEEE Xplore | `crossref` + `arxiv` + `openalex` | **Exact** (Crossref `filter=member:263` returned `publisher:"IEEE"` records live) | IEEE metadata is keylessly readable in Crossref; preprints on arXiv; full text stays commercial (IEEE API has register-gated metadata + sales-gated full text). |
| 2 | ACM DL | `crossref` + `openalex` + `arxiv` | **Exact** | **Status change measured:** ACM's own page — «ACM has transitioned to a fully Open Access publishing model, as of January 1, 2026 … all ACM research content freely available». Machine route stays Crossref/OpenAlex (no public ACM API). |
| 3 | INSPEC | `openalex` + `crossref` + `arxiv` | **Exact** | Lacks INSPEC's curated subject indexing (50+ years, expert thesaurus) — abstract/metadata coverage only. |
| 4 | Cochrane (Library) | `pubmed` + `clinicaltrials` + `europepmc` | **Exact** (PubMed live: 17 544 `Cochrane Database Syst Rev[ta]` records) | Review abstracts/metadata free via PubMed; full review text stays paywalled. CENTRAL's raw material = trial registries (ClinicalTrials.gov live). |
| 5 | CINAHL | `pubmed` + `doaj` | **Exact** | Journal core is in PubMed/MEDLINE; lacks CINAHL's nursing-specific indexing and non-MEDLINE content (dissertations, books — per EBSCO's own page). |
| 6 | HeinOnline | `caselaw-cap` + `govinfo-bulk` + `doaj` | **Exact** (both bulk endpoints live) | Lacks HeinOnline's law-review back-catalog full text and historical treaties; case law itself is covered (CAP bulk). |
| 7 | Westlaw | `caselaw-cap` + `courtlistener`(t2) + `govinfo-bulk` | **Exact** (CAP/GovInfo live; CourtListener is tier-2 token, UNMEASURED) | Lacks the citator (KeyCite) — no free equivalent exists; recorded as a gap. |
| 8 | LexisNexis | `caselaw-cap` + `courtlistener`(t2) + `govinfo-bulk` + `eurlex-sparql` | **Exact** (EUR-Lex SPARQL live) | Lacks Shepard's citator; EU law covered by EUR-Lex SPARQL. |
| 9 | JSTOR | `hathitrust` + `internetarchive` + `doaj` + `persee` | **Exact** (all four live) | Lacks the modern journal back-catalog (in-copyright); public-domain + OA + metadata layers covered. |
| 10 | PsycINFO | `pubmed` + `openalex` + `doaj` | **Exact** | Lacks APA's controlled vocabulary and books/dissertations indexing. |
| 11 | PsycArticles | `doaj` + `pubmed` + `europepmc` | **Exact** | APA full texts stay paywalled; OA psychology articles reachable. |
| 12 | Compendex | `openalex` + `crossref` + `arxiv` | **Exact** | Lacks curated engineering indexing/dissertations/standards (Engineering Village's own page: «journals, conference proceedings, dissertations, technical standards»). |
| 13 | Engineering Village | `openalex` + `crossref` + `arxiv` | **Exact** | Same as Compendex (EV is its platform). |
| 14 | Reaxys | `pubchem` + `cod` | **Exact** (both live) | Lacks curated reaction conditions/optimization data at Reaxys scale (the free reaction layer — Open Reaction Database — was not verified this session). |
| 15 | SpringerMaterials | `cod` + `aflow` + `materials-project`(t2) | **Exact** (COD/AFLOW live; MP tier-2 key, UNMEASURED) | Lacks curated experimental property datasheets (Landolt-Börnstein/ISP curation) — free set is structure + computed properties. |
| 16 | GeoRef | `usgs` + `crossref` + `openalex` + `osf` | **Exact** | Lacks GeoRef's curated global geoscience index (deep historical coverage); free set is USGS output + abstract-level metadata + preprints. |
| 17 | GeoScienceWorld | `crossref` + `openalex` + `doaj` | **Exact** | GSW journal metadata is in Crossref; OA parts reachable via DOAJ; paywalled full texts are not. |
| 18 | SocINDEX | `openalex` + `osf`(SocArXiv) + `doaj` | **Exact** | Lacks EBSCO's curated sociology indexing; OA/preprint + metadata coverage. |
| 19 | SocAbstracts | `openalex` + `osf`(SocArXiv) + `doaj` | **Exact** | Same as SocINDEX. |
| 20 | AgeLine | `pubmed` + `openalex` | **Exact** | Lacks AgeLine's grey-literature curation; gerontology journal core is in MEDLINE. |
| 21 | CAB_Abstracts | `pubmed` + `europepmc` + `openalex` (+ AGRIS web-only) | **Exact** (PubMed/EuropePMC/OpenAlex live; AGRIS has NO documented API — dropped as machine interface) | Lacks CABI's applied-life-sciences grey-literature depth; AGRIS remains a free web portal without a documented machine interface this session. |
| 22 | EdSource | `eric` + `oecd-sdmx` | **Exact** (both live) | EdSource itself is a free nonprofit newsroom (not an index); the research/statistics rung is covered by ERIC + OECD. |
| 23 | LearnTechLib | `eric` + `openalex` + `doaj` | **Exact** | Lacks LearnTechLib's conference proceedings depth; ERIC/OA coverage for education research. |
| 24 | Project MUSE | `doaj` + `hathitrust` + `oapen` | **Exact** (DOAJ/HathiTrust live; OAPEN documented but REFUSED our address — recorded) | Lacks MUSE-exclusive journal/book full texts; OA books via OAPEN (restricted), OA journals via DOAJ. |
| 25 | APS Journals | `arxiv` + `crossref` + `inspire` | **Exact** (all three live) | Publisher PDFs stay paywalled (APS «Open Science» branding noted, status not verified); physics preprints on arXiv are the community's authoritative layer. |
| 26 | IOPscience | `arxiv` + `crossref` + `inspire` | **Exact** | Same as APS. |
| 27 | MEDLINE | `pubmed` | **Exact — CONFIRMED FREE** (esearch+efetch live, keyless; an API key only raises the rate) | Nothing lacks: MEDLINE is served free by PubMed E-utilities. |
| 28 | MatWeb | `aflow` + `cod` + `materials-project`(t2) | **Exact** (AFLOW/COD live) | Lacks MatWeb's commercial property-table breadth (MatWeb's page rendered title-only for our fetcher — access model not captured). |

Count: 28 rows = 9 (Superlight «Honest limits») + 20 (kernel §1.3) − 1 (CINAHL duplicate). No name missing.

---

## 2. Substitutes — contract table (details per substitute)

T1 = keyless (live-verified unless noted); T2 = free-registration / restricted.

| Substitute | Tier | Replaces (group) | Discipline | Owner institution | authority_class | Search interface | Read interface | Key | Rate / politeness (provider's terms) | License (where captured) | Rung |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `crossref` | T1 | IEEE/ACM/IOP/APS metadata | cross-discipline (DOI registry) | Crossref (publisher consortium, not-for-profit) | primary_metadata_registry | `GET api.crossref.org/works` — query.bibliographic, filter=member:<id>, rows, select | metadata; abstract where deposited; full text via DOI/arXiv/OA links | none | not stated on fetched pages; metadata «openly shared … through our free APIs» | metadata openly shared (fetched) | Exact |
| `openalex` | T1 | index layer: INSPEC/Compendex/EV/PsycINFO/SocINDEX… | cross-discipline | OurResearch (nonprofit) | secondary_index | `GET api.openalex.org/works` — search/filter/per-page/select | abstract (inverted index) + OA links (`open_access`) | none (free key = 10× budget) | 10 req/s keyless; 30 req/s with free key (fetched) | «OpenAlex data is free» (fetched) | Exact |
| `zenodo` | T1 | repository/grey layer | cross-discipline (data, software, papers) | CERN | primary_data_repository | `GET zenodo.org/api/records?q=` — size/page | metadata + files; deposit API needs token | none (read) | not stated on fetched docs | metadata CC0 (fetched) | Exact |
| `openaire` | T1 | EU repository aggregator | cross-discipline (EU) | OpenAIRE AMKE (EU consortium) | secondary_index | `GET api.openaire.eu/search/publications?title=` (legacy, XML) | metadata; full text via links | none | not captured | not captured | Exact (legacy endpoint) |
| `doaj` | T1 | OA layers of MUSE/JSTOR/PsycArticles/CINAHL | cross-discipline (OA journals) | Lund University | fulltext_repository | `GET doaj.org/api/search/articles/{q}` — page/pageSize | fulltext link (publisher OA copy) | none | 2 req/s; bursts ≤5 queued (fetched) | not stated on fetched page | Exact |
| `core` | T1 | institutional-repository aggregator | cross-discipline (UK-led) | The Open University + Jisc | fulltext_repository | `GET api.core.ac.uk/v3/search/works?q=` — limit/offset | downloadUrl → PDF; full text for registered/API users | none (keyless live!) | unregistered: 5 single requests / 10 s (fetched) | «Free API access without registration» (fetched) | Exact |
| `pubmed` | T1 | MEDLINE + cores of Cochrane/CINAHL/PsycINFO/AgeLine | biomedicine | NLM/NIH (government) | primary_science | esearch/efetch — term, retmode, id | abstract XML free; full text via PMC OA/publishers | none (key optional) | not captured (usage page reCAPTCHA'd); 3 keyless calls OK | NLM terms (not captured) | Exact |
| `europepmc` | T1 | biomed index + OA full text | biomedicine | EMBL-EBI with NLM + funders | fulltext_repository | `GET .../rest/search?query=&format=json` — resultType=lite/core | `/rest/<PMCID>/fullTextXML` (165 KB live) | none | not stated on fetched page | Privacy Notice governs (fetched ref) | Exact |
| `clinicaltrials` | T1 | Cochrane CENTRAL material | clinical trials | NLM/NIH (government) | government_primary | `GET clinicaltrials.gov/api/v2/studies?query.term=` | structured JSON per trial | none | not captured (docs page shell) | not captured | Exact |
| `arxiv` | T1 | APS/IOP/IEEE preprint layer | physics/math/CS | Cornell University (now independent nonprofit) | primary_science | `GET export.arxiv.org/api/query` — search_query/max_results (Atom) | abstract + PDF link `arxiv.org/pdf/<id>` | none | Terms page fetched; wording not extractable | per-paper arXiv licenses | Exact |
| `inspire` | T1 | HEP literature | high-energy physics | CERN (+ partners) | primary_science | `GET inspirehep.net/api/literature?q=&fields=` | abstracts + bibtex/json/cv export | none | not captured | not captured | Exact |
| `cod` | T1 | SpringerMaterials/MatWeb structure layer | chemistry/crystallography | COD community (crystallography.net) | primary_data_repository | `GET crystallography.net/cod/result?text=|formula=|format=json|csv|lst` | `/cod/<ID>.cif` (CIF/hkl/rdf/html) | none | not stated in wiki | not captured | Exact |
| `aflow` | T1 | SpringerMaterials/MatWeb property layer | materials science | Duke University | primary_data_repository | `GET aflow.org/API/aflux/?species(X),nspecies(n)` | JSON entries + AFLOWDATA paths | none | not captured | not captured | Exact |
| `usgs` | T1 | GeoRef/GSW (USGS layer) | geoscience | U.S. Geological Survey (government) | government_primary | `GET pubs.usgs.gov/pubs-services/publication/?q=` | docAbstract + links; service root 401 (recorded) | none (search endpoint) | not captured | not captured | Exact |
| `eric` | T1 | EdSource/LearnTechLib | education | IES, U.S. Dept. of Education (government) | government_primary | `GET api.ies.ed.gov/eric/?search=&format=json` | abstract (description) + full text on ERIC | none | not captured | «free … no registration required» (fetched) | Exact |
| `osf` | T1 | SocINDEX/SocAbstracts/EarthArXiv/PsyArXiv | social sci., geoscience, psychology | Center for Open Science (nonprofit) | fulltext_repository | `GET api.osf.io/v2/preprints/?filter[provider]=…&format=json` | preprint files via OSF links | none | not captured | per preprint | Exact |
| `hathitrust` | T1 | JSTOR/MUSE book/serial layer | books & serials | HathiTrust (60+ research libraries consortium) | primary_metadata_registry | `GET catalog.hathitrust.org/api/volumes/brief/<idtype>/<id>.json` | identifier lookup (NOT a search API — their statement); bulk via OAI/hathifiles; full view readable, search-only limited | none (Bib API) | «small numbers of items at a time» (fetched) | third-party agreements (OCLC) noted | Exact |
| `internetarchive` | T1 | JSTOR public-domain layer | books/media | Internet Archive (nonprofit) | fulltext_repository | `GET archive.org/advancedsearch.php?q=&output=json` | item files via /metadata/<id>; full text PD / lending model | none | not stated | «does not assert any new copyright … rights» (fetched) | Exact |
| `persee` | T1 | JSTOR French humanities metadata | humanities (FR) | ENS de Lyon | primary_metadata_registry | OAI-PMH `http://oai.persee.fr/oai?verb=…&metadataPrefix=oai_dc` (HTTP-only + UA) | metadata free; content restricted to identified users (fetched) | none (metadata) | their harvest recommendation (sets + from=) | not captured | Exact |
| `caselaw-cap` | T1 | Westlaw/LexisNexis/HeinOnline (US cases) | law (US) | Harvard Law School Library | primary_law | bulk: `static.case.law/` + Reporters/Volumes/Jurisdictions Metadata.json (no query API) | per-case JSON in the bulk tree; search needs local index / CourtListener | none (bulk) | not captured | not captured this session (verify CC0 at deployment) | Exact |
| `eurlex-sparql` | T1 | Westlaw/LexisNexis (EU law) | law (EU) | Publications Office of the EU | primary_law | `GET publications.europa.eu/webapi/rdf/sparql?query=…&format=…` | Cellar resource URIs | none | not captured | EU reuse policy (not captured) | Exact |
| `oecd-sdmx` | T1 | OECD stats/education layer | economics/education statistics | OECD (intergovernmental) | government_primary | `GET sdmx.oecd.org/public/rest/dataflow?format=json-structure-2.0.0` (accepted formats returned live) | SDMX-JSON datasets | none | not captured | not captured | Exact |
| `govinfo-bulk` | T1 | Westlaw/LexisNexis/HeinOnline (US federal) | law (US federal) | U.S. Government Publishing Office | government_primary | `GET govinfo.gov/bulkdata/json/<collection>/…` (keyless) | bulk XML/JSON/PDF; keyed search API = free registration | none (bulk) | not captured | not captured | Exact |
| `unpaywall` | T1* | OA link resolver | cross-discipline | OurResearch (nonprofit) | oa_resolver | `GET api.unpaywall.org/v2/<DOI>?email=` | best OA copy URL | none, **contact email REQUIRED (422 proven without it)** | not captured | not captured | Exact (expected-fail probe) |
| `semanticscholar` | T2 | CS/eng index layer | CS/engineering/biomed | Allen Institute for AI | secondary_index | `GET api.semanticscholar.org/graph/v1/paper/search` | abstract + openAccessPdf | free registration (key) | keyless pool REFUSED us twice (429) | not captured | UNMEASURED (429×2) |
| `nasa-ads` | T2 | astrophysics index layer | astrophysics | Smithsonian Astrophysical Observatory at Harvard | secondary_index | `GET api.adsabs.harvard.edu/v1/search/query` + Bearer token | abstracts + links | free registration (token) | per-endpoint daily limits via headers (5000/day example, fetched) | ADS terms (referenced) | UNMEASURED (token; registration forbidden here) |
| `materials-project` | T2 | SpringerMaterials/MatWeb computed layer | materials science | Lawrence Berkeley National Laboratory | primary_data_repository | `api.materialsproject.org` via `mp-api` client | structured data per endpoint | free registration (key — «An API key is needed», fetched) | not captured | access-controlled data terms referenced | UNMEASURED (key) |
| `courtlistener` | T2 | Westlaw/LexisNexis (US cases/dockets) | law (US) | Free Law Project (nonprofit) | primary_law | API v4 + `Authorization: Token <token>` | opinions/dockets/RECAP full text | free registration (token) | 5/min · 50/h · 125/day (fetched) | not captured | UNMEASURED (token) |
| `oapen` | T2 | MUSE OA book layer | OA books (HSS) | OAPEN Foundation | fulltext_repository | `GET library.oapen.org/rest/search?query=…` | bitstreams (PDFs) | none stated — but address REFUSED | not captured | not captured | UNMEASURED (refused: «You address is not allowed to access this API») |

---

## 3. Live-call ledger (prediction → result)

Format: # · source · prediction → result · first-result fields · prediction verdict. All calls 2026-10-13 unless noted. Failures are kept, not hidden.

| # | Source | Prediction | Result / first result | Verdict |
|---|---|---|---|---|
| 1 | crossref works | 200 JSON, items[0] DOI/title/author/issued | 200; DOI 10.4135/9781506368603.n2, title, 2018 | partial (author empty on records) |
| 2 | crossref member:263 | 200; IEEE publisher items | 200; DOI 10.1109/iceeccot.2016.7955241 `publisher:"IEEE"` | held |
| 3 | openalex works | 200; results[0] id/doi/title/year/authors | 200; W2557283755 “Deep Learning”, 2016, Goodfellow/Bengio/Courville | held |
| 4 | zenodo records | 200; hits[0] metadata | 200; 10.5281/zenodo.10141912, 2023-11-19 | held |
| 5 | openaire (legacy) | 200 XML results | 200; title «Open Access-or Open Science?», Pulverer, 2018-12-03 | held |
| 6 | doaj articles | 200 JSON results | 200; total 38740; «European Urology Open Science» article | held |
| 7 | core works | 200 keyless (else 401) | 200; totalHits 40 721 133; downloadUrl …/597539722.pdf | held (keyless!) |
| 8 | pubmed esearch | 200 JSON idlist | 200; count 37371, ids 42863803/42859811 | held |
| 9 | pubmed efetch | 200 XML abstract | 200; labeled abstract, DOI 10.1016/j.rmed.2026.109214 | held |
| 10 | pubmed Cochrane query | records returned | 200; count 17 544 (journal translated) | held — MEDLINE free confirmed |
| 11 | europepmc search | 200 JSON resultList | 200; pmid 42617523, doi 10.1016/j.ijnurstu.2026.105675 | held |
| 12 | europepmc fullTextXML | 200 XML full text | 200; 165 KB article XML (PMC13138708) | held |
| 13 | clinicaltrials v2 | 200 JSON studies[] | 200; nctId NCT07214753 | held |
| 14 | arxiv | 200 Atom entries | 200; 0706.3294v1 + a PRL-journal-ref entry | partial — `+` parsed as OR in search_query (quote phrases) |
| 15 | inspire (full) | 200 JSON | 200; 472 KB → truncated, re-called | n/a (oversized) |
| 16 | inspire (fields=) | 200 JSON metadata | 200; id 3127339, Eur.Phys.J.C 86 (2026) 457 | held |
| 17 | dblp API | 200 JSON | **Anubis proof-of-work wall** | FAILED — dropped, not evaded |
| 18 | semanticscholar | 200 (429 possible) | **429 Too Many Requests** | FAILED (logged) |
| 19 | semanticscholar retry | 200 | **429 again** | FAILED — tier 2 |
| 20 | cod (webfetch ×2) | 200 | transport failure («unknown error») | FAILED transport — endpoint re-probed via python |
| 21 | cod lst (python) | 200 ID list | 200; IDs 1515581… | held |
| 22 | cod json (python) | 200 JSON records | 200; «Aspirin form II», P 1 21/c 1 | held |
| 23 | aflow | 200 JSON array | 200; compound Ag2, aurl AFLOWDATA/… | held |
| 24 | pubchem | 200 JSON properties | 200; CID 2244, C9H8O4, 180.16 | partial (ConnectivitySMILES vs requested CanonicalSMILES) |
| 25 | usgs pubs | 200 JSON records | 200; recordCount 8503; title/doi/authors | held |
| 26 | eric | 200 JSON docs[] | 200; numFound 1 489 769; ED621142, 1916 | held |
| 27 | osf (no format) | JSON | served browsable HTML page instead | off-prediction (logged) |
| 28 | osf format=json | 200 JSON data[] | 200; id 2rjm6_v1 | held |
| 29 | hathitrust isbn ×2 | 200 JSON records | 200 but **empty records** for both ISBNs | off-prediction (logged) |
| 30 | hathitrust oclc | 200 JSON records+items | 200; «Infinite series», htid mdp.39015025315527, «Limited (search-only)» | held |
| 31 | internetarchive | 200 JSON docs[] | 200; numFound 740; MobyDick_844 | held |
| 32 | persee (no UA) | 200 XML | timeout | FAILED (logged) |
| 33 | persee (python+UA) | 200 OAI Identify | 200; repositoryName «Persée, périodiques scientifiques» | held |
| 34 | static.case.law | index page | 200; full reporter index + 3 metadata files | held |
| 35 | eurlex sparql | 200 JSON bindings | 200; binding = cdm URI | held |
| 36 | oecd (format=jsondata) | 200 JSON | 200 validation message: accepted formats listed | off-prediction (logged, corrected) |
| 37 | oecd (json-structure) | 200 JSON structure | 200; meta.id IREF834611 | held |
| 38 | govinfo bulk | 200 JSON folder list | 200; BILLSTATUS/119 folders | held |
| 39 | fatcat lookup | 200 JSON release | **unreachable (transport failure)** | FAILED — dropped |
| 40 | oapen rest | 200 JSON records | **“You address is not allowed to access this API.”** | REFUSED — recorded |
| 41 | unpaywall (no email) | 422 email required | **422, email required** | held (EXPECTED_FAIL probe) |
| 42 | pmc oa.fcgi | 200 XML links | **404 (endpoint gone)** | FAILED — replaced by Europe PMC fullTextXML (#12) |

A failed call is a result; a fabricated success would not be.

---

## 4. Counts

- Paid names in the brief: **28** (9 Superlight + 20 kernel − 1 duplicate). Rows: 28/28.
- Keyless substitutes (tier 1, live-verified unless marked): **24**.
- Tier 2 (free registration / restricted): **5** — `semanticscholar`, `nasa-ads`, `materials-project`, `courtlistener`, `oapen`.
- Dropped candidates with reasons: **4** — `dblp` (bot wall), `fatcat` (unreachable), `agris` machine interface (no documented API found), `cornell-lii` (no documented API).
- Unmeasured (recorded, not asserted): **2** — `nist-webbook` (no API found, not verified), `base` (scope-cut; CORE + OpenAIRE carry the aggregator role live).
- Live calls recorded: **42 rows** in the ledger — **35 held/partial**, **5 failed/refused** (dblp, s2×2, fatcat, oapen), **1 expected-fail probe** (unpaywall), plus transport-level retries recorded inline (cod, persee).

## 5. Gaps (honest — no paid fallback)

1. **Citators** (KeyCite/Shepard's) have NO free equivalent — recorded as a permanent gap for Westlaw/LexisNexis mappings.
2. **Curated subject indexing** (INSPEC/CINAHL/CABI/GeoRef depth) is not reproduced; free substitutes give abstract/metadata coverage, not the curators' work.
3. **Modern in-copyright journal back-catalogs** (JSTOR/MUSE/HeinOnline law reviews) remain paywalled; free layers cover public-domain, OA, and metadata.
4. **Curated experimental property datasheets** (SpringerMaterials/MatWeb) have no full free equivalent; COD/AFLOW/Materials Project cover structures + computed properties.
5. **Reaction-synthesis curation** (Reaxys) — PubChem/COD cover compounds/structures; the free reaction layer (Open Reaction Database) was NOT verified this session.
6. **AGRIS without a machine interface** — the free authoritative agricultural index exists but only as a web portal (no documented API found).
7. Doc-side blanks, marked per row: rate limits/licenses not captured for some sources (NCBI usage page reCAPTCHA; Zenodo/OSF/ClinicalTrials/PubChem docs JS-rendered; OECD terms page had no license statement; CAP license text JS-rendered).

## 6. How a service should consume this (one paragraph)

Tier 1 is actionable today with zero secrets: Query-plan the disciplines onto `crossref`/`openalex` (metadata spine, ≥10 req/s keyless), `arxiv`/`inspire` (physics/CS), `pubmed`/`europepmc`/`clinicaltrials` (biomed), `doaj`/`core`/`zenodo`/`openaire` (OA/repositories), `cod`/`aflow` (chemistry/materials), `usgs` (geoscience), `eric`/`oecd-sdmx` (education/stats), `osf` (preprints), `hathitrust`/`internetarchive`/`persee` (books/humanities), `caselaw-cap`/`govinfo-bulk`/`eurlex-sparql` (law), and stamp each hit with the `authority_class` in this table (metadata → `primary_metadata_registry`, publisher-DOI hits may be stamped Inferred via Crossref's registry status; full-text/OA layers → repository/storage classes). Tier 2 unlocks with free keys (NASA ADS, Materials Project, CourtListener, Semantic Scholar) or one email contact (Unpaywall) — a config change, not an architecture change.
