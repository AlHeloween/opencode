# 2026-10-08 — /session/:id/message answered 401 over an unparsed tool input

Plan: `plans/2026-10-08_messages-endpoint-401.md` · commit `00d6312e5a` · archived 2026-10-08.

## The defect, in one paragraph

`GET /session/:id/message` answered `401 {"_tag":"Unauthorized"}` whenever a page included the
tool part `prt_118eb46e3001uTdswmmXo1IF02` (`msg_118eb1f9e001MubqwDWiPzRFkn`), whose
`state.input` held the **raw string** of a tool call whose JSON never parsed. Two defects produced
one symptom: the part violates `ToolStateError`'s schema (`input: Schema.Record`), so
`Schema.Array(MessageV2.WithParts)` cannot encode the response; and effect's
`HttpApiBuilder.makeSecurityMiddleware` (4.0.0-beta.57, `HttpApiBuilder.js:331-350`) treats ANY
failure of a scheme's middleware — a downstream handler failure included — as «this credential was
rejected», tries the NEXT scheme and answers with the LAST scheme's failure. Our second scheme
(`authToken`) therefore turned every failure of every endpoint in all 15 groups into `Unauthorized`
(measured live: a declared `BadRequest`, `limit=abc` and `limit=-1` all answered 401).

## Instruments (run from the repo root)

| file | what it did |
|---|---|
| `repro.py` | the live reproducer through `tools/opencode_host.py` — limits × sessions, statuses and item counts (token never printed) |
| `probe_branches.py` | single-row endpoint vs cursor branch vs plain page |
| `probe_bisect.py` | binary-searches the culprit row with constructed `before=` cursors |
| `probe_masquerade.py` | proves the class: a declared BadRequest and a malformed query both answer 401 on the pre-fix host |
| `prepare_dist_worktree.py` | SQLite-backup snapshot of this project's DB into a scratch worktree (the owner's live host is never touched) |
| `start_candidate.py` | starts `dist/bin/opencode.exe serve` with the provider env stripped (NAMES printed, values never read) |
| `verify_dist.py` | the acceptance measured against that candidate |

## Result (candidate from `_build.ps1`, version 10.0.1235)

`verify_dist.py` → **7/7 cases as required** (`summary.json` beside this file): whole history 200
with 75 items including the oldest row; the culprit part served with `state.input = {}` and
`state.metadata.rawInput` = the original 1 760 chars; `limit=75` → 200/75; `limit=74` → 200 with
the cursor branch intact; `?before=` without `limit` → **400** `{"_tag":"BadRequest"}`; `?auth_token=`
→ 200.

Pre-fix, on the owner's live binary: `limit=74` → 200, `limit>=75`/none → 401; the same
declared error → 401.

## Known residual (NOT this defect)

A **missing session** answers **500** where `test/server/session-messages.test.ts:149` expects 404 —
measured with the same instrument on the pre-fix binary too. `Session.get` THROWS
(`session.ts:824`), a defect, so it never reaches Hono's `NotFoundError → 404` mapping. The fix is
a router-level `NamedError → status` mapping; out of this plan's envelope.

## Reproducing

1. `python prepare_dist_worktree.py` (needs this worktree's DB; ~455 MB copy, gitignored scratch)
2. `cmd_runner start -- python start_candidate.py`
3. `python verify_dist.py` (reads the candidate's host record from the scratch DB)
