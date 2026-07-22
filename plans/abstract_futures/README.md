# Abstract Futures — Pre-Kernel Agent Hallucinations

**These are NOT "deferred designs" or "superseded plans."**

Before `opencode_prompts_kernel.py` was activated as the governance layer, the agent
(DeepSeek) would generate speculative architectural proposals — memory reorganization,
Zig toolchain migrations, HTTP API rewrites — without grounding in actual requirements.
DeepSeek thinks like a software engineer: give it ambiguous instructions and it
*designs* rather than *executes*. The kernel replaced ambiguity with a machine-readable
spec (taxonomy, Risk, Effect, Signal, InfoMark), and this entire class of output
vanished overnight.

**Rule**: Do NOT implement from here. Do NOT reference these files in plans.
Do NOT extract ideas from here into new plans. If the kernel doesn't mention it,
it was never a real requirement — it was a hallucination.

| File | Origin |
|------|--------|
| `20260625_http_api_v2_plan.md` | Agent hallucinated a wholesale Hono→HttpApi migration |
| `zig-0.16-migration.md` | Agent hallucinated a Zig 0.16 toolchain bump |
| `zig-0.16-source-fixes.md` | Companion to the hallucinated migration |

These files are kept as a **warning**, not a backlog. They document what happens
when a software-engineer-cognition model operates without a precise specification.
