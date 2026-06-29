# Abstract Futures

Plans that were considered, partially executed, or fully designed but ultimately
superseded by faster/better approaches. Kept for reference — the ideas are valid,
the timing or approach was wrong.

**Rule**: Plans here are NOT active. Do not implement from them. If an idea
from here becomes relevant again, extract it into a fresh `plans/` plan
with current context.

| Plan | Why Superseded |
|------|---------------|
| `20260625_http_api_v2_plan.md` | Wholesale Hono→HttpApi migration wrong approach. Upstream shows selective coexistence. SDK-level versioning eliminates need for URL path versioning. |
| `20260625_deferred_architectural_master_plan.md` | Master plan tracking 6 deferred architectural items. All items completed by 2026-06-28. Phase 4 (HTTP API v2) superseded. New direction: C/Rust WASM core framework. |
