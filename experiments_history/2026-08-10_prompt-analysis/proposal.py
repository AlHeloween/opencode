"""Visualize the proposed cache-friendly ordering."""
print("""
CURRENT ORDER (cache-inefficient):
═══════════════════════════════════
  "model"              ← immutable
  "max_tokens"         ← immutable
  "messages": [
    sys[0] UNIVERSAL_ENV   41 chars   immutable
    sys[1] KERNEL          25,877     immutable (per opencode version)
    sys[2] TOOL_PROSE      101,919    REDUNDANT — duplicate of JSON tools
    sys[3] PATH            68,401     semi-immutable (per project)
    sys[4] SESSION         1,650      mutable (per session)
    user   "2+2=?"         1,645      mutable (per turn)
  ]
  "tools": [...]          99,983     immutable — BUT AFTER user → always cache miss
  "thinking": {...}
  ...

  Cache hit:  sys[0..4]
  Cache miss: user + tools + thinking + ... = 25K tokens EVERY TURN

PROPOSED ORDER (cache-optimized):
═══════════════════════════════════
  "model"              ← immutable
  "max_tokens"         ← immutable
  "tools": [...]       ← 99,983 immutable — BEFORE messages!
  "thinking": {...}    ← immutable
  "messages": [
    sys[0] UNIVERSAL_ENV   41 chars   immutable
    sys[1] KERNEL          25,877     immutable
    sys[2] removed — tools is the authority
    sys[3] PATH            68,401     semi-immutable (per project)
    sys[4] SESSION         1,650      mutable (per session) ← already last
    user   "2+2=?"         1,645      mutable (per turn)
  ]

TIER           CACHE SURVIVES ACROSS
  ────────     ─────────────────────
  model+tools  ALL projects, ALL sessions (100K tokens)
  kernel       opencode version upgrades only (26K)
  path         project switches (68K)
  session      same session turns (2K)
  user         0 — always cache miss

SAME PROJECT, NEW SESSION:
  hit: model+tools+kernel+path = 195K tokens (~49K)
  miss: session+user = 3K tokens

SAME PROJECT, SAME SESSION, NEXT TURN:
  hit: model+tools+kernel+path = 195K tokens
  miss: session+user = 3K tokens

  vs CURRENT: hit=53K, miss=25K
  → cache efficiency from 68% → 94%
  → 25K miss → 3K miss
""")
