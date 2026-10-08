# /session/:id/message answers 401 over a full window — a different failure wearing the auth status

<!-- intention: GET /session/ses_ee71eb62bffeGfzHDNQGaxq2Q6/message on the owner's host answers 401 {"_tag":"Unauthorized","message":"Unauthorized"} whenever the page reaches the session's OLDEST message (limit 74 -> 200; limit >= 75 or no limit -> 401) although the credential is identical in every call -> the endpoint returns the whole history for every limit, and any real failure reports itself as its own class instead of Unauthorized -->

- **plan_id:** 2026-10-08_messages-endpoint-401
- **revision:** 2
- **state:** ACTIVE
- **reported:** owner's orchestrator, 2026-10-08 — owner's live bin/ TUI on `127.0.0.1:4096`, client `tools/opencode_host.py` with that host's token.
- **why it matters:** the orchestrator is forced to read `opencode.db` directly to see a session's history — the API it must use says 401 for a request that is authenticated.

```yaml
Keywords: messages-endpoint 0.30, unauthorized-401 0.24, unparsed-tool-input 0.18, effect-httpapi 0.14, error-class-honesty 0.14
Semantic dominant: A 401 that is not an auth failure can only be a swallowed error — the whole history must come back, and what fails must fail as itself.
md5: 4a7d19c2b0e54f8a9c1d2e3f4a5b6c7d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## T1 — reproduced (✓ 2026-10-08, `experiments/2026-10-08_messages-401/repro.py` + `probe_branches.py` + `probe_bisect.py`)

- Target session: `limit` 1/10/74 → 200; 75/76/100/500/none → **401** `{"_tag":"Unauthorized","message":"Unauthorized"}`; both control sessions → 200 (81/89 rows). Row-for-row identical to the report.
- Branch boundary: `limit=74` returns the **cursor branch** (`HttpServerResponse.jsonUnsafe`, no schema encode); `limit>=75` returns the **plain value** (`page.items`), which the framework encodes with `success: Schema.Array(MessageV2.WithParts)` (`httpapi/session.ts:221`).
- Bisect over constructed cursors (`before=<base64{id,time}>`): the smallest failing prefix is 62 → the culprit row is `msg_118eb1f9e001MubqwDWiPzRFkn` (`prt_118eb46e3001uTdswmmXo1IF02`). Everything without it encodes; the single-message endpoint serves it (200) — so the trigger is `Schema` validation of that one part, not its size.
- The part: `type:"tool", tool:"edit", state:{status:"error", input:"{…raw arguments JSON…}", error:"AI_ToolCallRepairError: …"}`. `ToolStateError.input` is declared **`Schema.Record(Schema.String, Schema.Any)`** (`message-v2.ts:520`) — a **string** violates it and the encode of the array fails.
- Class size in this DB (dbread): `error` + `text` input = **2** parts; all others (11 722 completed, 287 error, 4 running) are objects.
- Writer (read, `processor.ts:940-952`): `case "tool-call"` stores the stream's `value.input` verbatim into the running state; `failToolCall` (`processor.ts:825-842`) carries that `input` into the error state. A tool call whose JSON never parsed (repair threw, `tool-call-repair.ts:113`) arrives as the raw **string**.

## T2 — the 401 is a swallowed failure (✓ read in `effect@4.0.0-beta.57` + live probes)

1. `HttpApiBuilder.makeSecurityMiddleware` (`node_modules/.bun/effect@4.0.0-beta.57/…/HttpApiBuilder.js:331-350`) tries each declared security scheme **in order**, and on ANY failure stores it and tries the next one, finally returning **the LAST scheme's failure**. The middleware wraps the whole endpoint core — decode, handler AND the response encode (`:286-287`).
2. Our `Authorization` declares **two** schemes (`auth.ts:16-19`): `basic` and `authToken`. Scheme 1 (`basic`) validates the credential and runs the core; the core's failure (here: the body-encode error of the invalid part) is therefore treated as "this credential was rejected" → scheme 2 runs.
3. Scheme 2 (`authToken in query`) never finds a token (the client sends the header), so its credential is empty and `validateCredential` (`auth.ts:36-40`) fails with **our** `Unauthorized({message:"Unauthorized"})` — that is the body we see.
4. Live proof of the class (`probe_masquerade.py`, same valid credential): a **declared** `HttpApiError.BadRequest` (`before` without `limit`, `httpapi/session.ts:558`) → 401; `limit=abc` (query decode failure) → 401; `limit=-1` → 401. Every failure of every endpoint in the 15 groups under this middleware reports as 401.
5. Side effect of the same loop, measured in the code: with no credential configured (private server, test env) scheme 2 passes validation and **re-runs the handler** — a failing handler executes twice.

## Acceptance frame

| # | criterion | surface | instrument@rung | falsifier |
|---|-----------|---------|-----------------|-----------|
| A1 | the endpoint returns the whole history, including sessions whose stored tool part never parsed its input | `GET /session/:id/message` | reproducer on the live host (Exact) + `test/server/messages-endpoint-401.test.ts` (Exact) | any 4xx/5xx, a missing row, or an unencodable part in the body |
| A2 | a real failure reports its own class | the same endpoint with a declared `BadRequest` and a query decode error, **host credential set** | the new test file + reproducer (`probe_masquerade.py`) | any `_tag: Unauthorized` on a non-auth failure |
| A3 | the paging contract is unchanged | `limit` pages, `Link`/`X-Next-Cursor`, cursor round-trip | `test/server/session-messages.test.ts` (existing, must stay green) + reproducer | a lost/duplicated row or a missing cursor |
| A4 | `?auth_token=` still authenticates | Hono rewrite (`server/middleware.ts:71`) → Basic header | live probe (dist candidate) | a 401 for a valid `auth_token` |

## T3 — the fix (design)

1. **`session/message-v2.ts` — one predicate, `normalizeToolPart`.** A tool part whose `state.input` is not a record is contrary to the schema; the raw text moves to `metadata.rawInput` (declared on running/error/completed) and `input` becomes `{}`. Applied at the **read materializer** `parts()` (rows stored before this change keep working — the live session's case) and at the **write boundary** `session.updatePart` (no writer can store the malformed shape again). The processor is the source, but it is not the only writer; the boundary is.
2. **`session/processor.ts` — `failToolCall` carries `state.metadata` forward**, so a `rawInput` set at the running stage survives the error flip (the abort path already does this, `:1589`).
3. **`server/routes/instance/httpapi/auth.ts` — one security scheme.** The `authToken` scheme is redundant: the Hono layer already rewrites `?auth_token=` into `Authorization: Basic …` (`server/middleware.ts:71`) before the Effect handler. With a single scheme the loop returns the endpoint's OWN failure, which the endpoint's error schema then maps honestly (`BadRequest` → 400, `HttpApiSchemaError` → die → 500). A second scheme is what turns every failure into `Unauthorized` (T2.1-T2.3).

Not taken: **a DB migration to rewrite the rows.** The migration index (`storage/migration.gen.ts`) is hand-assembled from `migration/*.ts` and a backfill precedent exists (`20260906000001_session_cost_sidecar_backfill.ts`), but a migration runs only at DB open and cannot be exercised by the suite through the endpoint; the read materializer covers every already-stored row in every DB at once and keeps the original bytes for forensics. Recorded as a rejected alternative, not as an unknown.

## Tasks

- [x] ✓ **T1 — reproducer** (`experiments/2026-10-08_messages-401/repro.py` + probes; run 2026-10-08, live host `127.0.0.1:4096` pid 27004). Evidence: statuses/limits above, raw bodies under `experiments/2026-10-08_messages-401/raw/`.
- [x] ✓ **T2 — localize** (mechanism + culprit row + class size above; all from code reads with file:line and live probes).
- [x] ✓ **T3 — fix**, the design above with one correction the regression suite forced: the `authToken` scheme was not fully redundant — `test/server/httpapi-bridge.test.ts` drives `InstanceRoutes()` DIRECTLY, so the query token is now read INSIDE the single `basic` scheme (`queryCredential`, `auth.ts:61-66`) instead of by a scheme of its own. Files: `session/message-v2.ts` (`normalizeToolPart`, applied in the materializer `part()`/`parts()`), `session/session.ts` (`updatePart` write guard), `session/processor.ts` (`failToolCall` metadata carry), `server/routes/instance/httpapi/auth.ts` (single scheme).
- [x] ✓ **T4 — pin.** RED on the pre-fix tree `20261008T053404Z_04a30d20` — 0 pass / 3 fail: 400, 400 and **401** where 200 / 200 / 400 are required (the third is the live defect reproduced in-process). GREEN `20261008T053700Z_e06abd3f` and, after the auth rework, `20261008T053950Z_a5d7f41c` — **3 pass / 0 fail**, 13 expect(). Regressions, one file per run: `test/server/httpapi-bridge.test.ts` 8 pass / 0 fail `20261008T054037Z_017f13b1` (includes `accepts auth_token query credentials`); `test/server/host-auth.test.ts` 3/0 `20261008T054132Z_80c4f334`; `test/session/messages-pagination.test.ts` 46/0 `20261008T054218Z_583c8394`; `test/session/message-v2.test.ts` 45/0 `20261008T054312Z_5b692693`; `bun typecheck` exit 0 (`20261008T053657Z_5331c4a5`, `20261008T053945Z_feaf566c`).
  **Found, NOT caused here — `test/server/session-messages.test.ts:149`** expects 404 for a missing session and gets 500. It is red BEFORE this change too: the pre-fix live binary answered the same request with 500 (`probe_masquerade.py`, credential set — had the two-scheme loop produced its own 401 the credential would have forced 401, and it did not). Cause: `Session.get` THROWS (`session.ts:824`) — a defect — so it never reaches Hono's `NotFoundError → 404` mapping (`middleware.ts:39`). A router-level NamedError→status mapping is the real fix; out of this plan's envelope (touches every endpoint), recorded as a residual, the assertion untouched.
- [x] ✓ **T5 — candidate + closure.** `_build.ps1` exit 0 `20261008T054417Z_06a30446` (version 10.0.1235, smoke `--version` passed, artifacts in `dist/`). The candidate served a scratch worktree whose DB is a SQLite-snapshot copy of this project's (`prepare_dist_worktree.py`; the owner's live host is never touched), started with the provider credentials removed (`start_candidate.py`; 9 names listed, values never read): `verify_dist.py` → **7/7 cases as required** (details in the Smoke Tests below).

## Smoke Tests

1. ✓ **Baseline (pre-fix, live):** `limit=75` → 401 `_tag: Unauthorized`; `limit=74` → 200 (T1).
2. ✓ **Post-change (dist candidate):** no limit → 200 with **75 items**, oldest row `msg_118e14a0e001tSIMQsCfRxwN1D` present, culprit `msg_118eb1f9e001MubqwDWiPzRFkn` present; its tool part arrives with `state.input = {}` and `state.metadata.rawInput` = the original 1 760-char text; `limit=75` → 200 with 75 items.
3. ✓ **Error honesty (dist candidate):** `?before=…` without `limit` → **400** `{"_tag":"BadRequest"}` (was 401).
4. ✓ **`?auth_token=`** (dist candidate, no Authorization header) → 200.
5. ✓ **Fallibility:** the pin file is RED on the pre-fix tree and GREEN after (run ids in T4). One pre-existing red found in `test/server/session-messages.test.ts:149` (missing session does 500, not 404) — measured on the pre-fix binary too, left untouched and recorded in T4.
6. ✓ **Unit files, one per run** (see T4/T5); never the whole package suite (AGENTS.md § Full package test suite).
7. ✓ **Residual probe (not acceptance):** the same candidate answers a missing session with 500 — the pre-existing defect above, unchanged by this fix.

## Out of scope

- Restarting or touching the owner's live TUI / anything in `bin/` (verification on the `dist/` candidate; the owner promotes).
- The `running`/`pending` double-execution in the no-credential case (T2.5) — removed by the same single-scheme fix, not measured separately.
- Other stored-part shapes (only `state.input` was measured malformed in this DB).
