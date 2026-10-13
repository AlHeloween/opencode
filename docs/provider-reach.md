# Provider reach — descend from the highest surface (moved from AGENTS.md, 2026-10-13)

The rule and its five guards stay in AGENTS.md § Provider Reach; this file is the record — why it is a postulate, the per-provider numbers, and the measured evidence, verbatim.

**Why this is a postulate and not a preference.** Providers migrate to their newest
version and newest transport, and the legacy path then costs them extra: protocol
translation, older connection pools, separate capacity. That path is therefore the
*first* to be rate-limited, deprioritised or simply refused. A legacy surface that
works today is the one that gets throttled first under load — so pinning to it buys
a quiet week and then an outage whose cause looks like "the provider is flaky".
Climbing removes that whole class of intermittent failure instead of diagnosing it
one incident at a time.

### The number is not a constant — read it per provider

Never write a version literal into the rule. As of 2026-09-17:

| Provider | Endpoint | What the number is |
|---|---|---|
| `zai` | `api.z.ai/api/paas/v4` | own API **v4** |
| `novita-ai` | `api.novita.ai/v3/openai` | own API **v3**, then openai dialect |
| `openrouter` | `openrouter.ai/api/v1` | own API v1 |
| `huggingface` | `router.huggingface.co/v1` | router v1 |
| `deepseek` | `api.deepseek.com` | unversioned host; SDK appends the dialect |

A rule saying "use v3" would already have been wrong for Z.AI on the day it was
written.

### Evidence

Novita h3 vs h2, interleaved 6-pair benchmark 2026-09-08: median **2188 ms vs
3294 ms**, tail 2× shorter, zero give-ups, server advertising `alt-svc h3`.
Transport defaults and their probes are recorded in `provider/provider-sync.ts`
above `VERIFIED_H2_OPTIONS`.

A new provider is not finished until both rungs are recorded with the probe that
established them.
