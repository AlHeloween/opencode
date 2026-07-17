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
| `zig-0.16-migration.md` | OpenTUI native build stays on Zig **0.15.2** for now (working DLL, Sixel/Kitty path). Full 0.16 toolchain + uucode v0.2 bump is a large API break with no current product blocker. Revisit when 0.15.2 is untenable or upstream OpenTUI requires 0.16. |
| `zig-0.16-source-fixes.md` | Companion source fixes (Mutex, ArrayList `.empty`, fs/EnvMap renames) only matter after the 0.16 build migration. Parked with that plan. |
