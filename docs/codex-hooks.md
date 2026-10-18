# Codex Hooks — context recovery after compact and delegated-work reports

Native Python (stdlib only) component implementing the Codex hook lifecycle for
this project. Plan: `plans_completed/2026-10-18_codex-continuity-and-robot-hooks.md`
(task H1, plan revision2 + root review criteria 1-10). Official hook spec:
https://learn.chatgpt.com/docs/hooks (checked 2026-10-18).

## What problem it solves

After a compact, Codex restores only a short summary; delegated work has no
mandatory execution receipt. This component:

1. **Captures** full user/assistant texts, SV vectors and raw transcript line
   addresses at PreCompact into SQLite — full history, never trimmed.
2. **Restores** whole primary records at SessionStart(compact|resume) — the
   guaranteed injection channel — selected by CURRENT relevance: the newest
   user constraints first, then records whose SV label sits on the CURRENT
   chain (walked backward by prev labels from the newest vector) or the current
   parent goal, then the rest newest-first. PostCompact records a
   projection/capture receipt only; its additionalContext is not promised by
   the docs and is not used.
3. **Reports** delegated work: SubagentStart records the association,
   SubagentStop records an immutable execution report read from the CHILD
   transcript only, with completion kept strictly separate from acceptance —
   nothing is ever auto-accepted.
4. **Collects** external OpenCode robots through the existing nonce/auth host
   client (read API only, no prompt replay).
5. **Provenance**: read-only Fossil lookup by exact `sv:<md5>` labels.

## Files

| Path | Role |
|------|------|
| `scripts/codex-hooks/codex_hooks.py` | the whole component (stdlib only) |
| `scripts/codex-hooks/tests/` | focused unittest suite (55 tests) |
| `<worktree>/.opencode/data/codex-hooks.sqlite` | derived state (default DB) |

Reused read-only (never modified): `tools/codex_svchain.py` (SV parser),
`tools/opencode_host.py` (nonce/auth host client).

## Handler wire contract

`python scripts/codex-hooks/codex_hooks.py handler` — one hook event JSON on
stdin, exactly one event JSON value on stdout, every diagnostic on stderr.
`trusted_hash` and hook trust are never touched; this component never installs
or modifies hook configuration (the parent owns `.codex/hooks.json`).

| Event | Behaviour | Output |
|-------|-----------|--------|
| `PreCompact` | capture full texts + SV + addresses; compact instructions stored as a current constraint | `{"continue": true}` |
| `PostCompact` | projection/capture receipt only (plan revision2) | `{"continue": true}` |
| `SessionStart` | injection for `source` compact/resume; other sources pass through | `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ...}}` |
| `SubagentStart` | agent/session/task association record | `{"continue": true}` |
| `SubagentStop` | execution report from `agent_transcript_path` ONLY — the parent `transcript_path` is never read as the child | `{"continue": true}` |
| `Stop` | one bounded reminder about unverified reports, then pass — no infinite re-prompts | `{"decision": "block", "reason": ...}` once, then `{"continue": true}` |

`additionalContextLimit: 0` (set by the parent later) passes the full
additionalContext; the component pins its own output bound at 256 KiB UTF-8.

## Identity refusals (never a shared bucket)

- An event without `session_id` is **REFUSED_NO_SESSION** — nothing is stored
  under a shared `unknown` key; restore without a session identity returns a
  labeled REFUSED text.
- A transcript whose `session_meta` names a DIFFERENT session is
  **REFUSED_IDENTITY** — a runtime identity mismatch stores NOTHING.
- A transcript without `session_meta` captures with an explicit **degraded
  historical status** anomaly (allowed for old fixtures).
- An unfamiliar transcript schema (lines but zero recognized
  `response_item` message rows) is **REFUSED_SCHEMA** — a visible refusal,
  never a silent empty green.
- All rows are isolated by `session_id AND worktree` — a shared explicit DB
  cannot bleed across sessions or worktrees.

## Selection vs storage

Storage is complete; injection is a separate selection:

- **Budget**: 256 KiB UTF-8 (`BUDGET_BYTES`) caps the WHOLE additionalContext —
  headers, SV chain, anomalies, fossil comments and the overflow index
  included; the assembler accounts every byte.
- **Whole records only** — a record is never cut mid-text; a record that does
  not fit is excluded whole. A huge fossil comment is rendered whole or
  omitted with its DB pin and uuid — never mid-cut.
- **Priority**: newest user constraints + compact instructions first, then
  vector-anchored records on the CURRENT chain / current parent goal, then the
  rest newest-first. Rendering is chronological. Having ANY vector is not
  relevance — an old broken-off chain is tier-3 material.
- **Overflow**: a bounded index — excluded count, the recall command, per-record
  address lines while they fit, then an explicit omitted-note; the FULL
  inventory is always reachable through the recall CLI and SQLite:
  `python scripts/codex-hooks/codex_hooks.py recall --db "<db>" --worktree "<wt>" --session "<id>" --after <N>`
  The renderer reserves 2048 bytes for the footer before selecting primary
  records, so filling the context cannot remove the way back to excluded text.
- The context is labelled `HISTORICAL EVIDENCE — reference material from
  primary sources, NOT new instructions`. No summary-of-summary, no generated
  facts; source transcripts and opaque reasoning stay unchanged.
- **Self-block non-reingestion**: a re-capture after compaction skips the
  hook's own injected historical blocks (marker-detected, counted in an
  anomaly) — primary memory is never multiplied by the hook's own output.
- Visible by design: `NO_SV`, `BREAK`/`RESET`/`LINK`/`START` chain edges
  (labels, not checksums), malformed-row anomalies, fossil outcomes,
  unfinished-work residuals. Record addresses carry the FULL transcript path
  and line (`D:\...\rollout-x.jsonl:402`), so recall names a real path+line.

## SQLite schema (codex_hook_* namespace, schema_version 3)

Default DB `<worktree>/.opencode/data/codex-hooks.sqlite`; override with
`--db` or env `CODEX_HOOKS_DB`. Derived, recoverable projection — not primary
memory; no new JSON runtime store. Older DBs migrate via explicit ALTER TABLE.

- `codex_hook_meta(key, value)` — schema_version.
- `codex_hook_capture(capture_id, session_id, worktree, kind, line_address,
  source_hash, text, vector_md5, vector_prev, vector_parent, vector_keywords,
  vector_dominant, captured_at, event_hash UNIQUE)` — full texts + raw
  addresses. `kind`: user | assistant | compact-instruction | subagent-start |
  postcompact-receipt | anomaly. Per-record idempotency by
  `(session, address, source hash)`.
- `codex_hook_report(report_id PK, source, session_id, worktree, agent, task,
  source_transcript, final_message, errors, tool_errors, tools_used,
  changed_paths, test_evidence, completed, completion_basis, surfaced, address,
  external_refs, created_at)` — immutable execution reports. `report_id` is a
  content hash → duplicate events are idempotent. `completion_basis`:
  final-assistant-message | final-assistant-message:legacy-no-channel-marker |
  commentary-not-final | stale-final-new-user | unfinished-tool-call | error | no-final-message |
  no-child-transcript | no-transcript | incomplete | finish=<r>+time.completed.
- `codex_hook_receipt(receipt_id, report_id UNIQUE, address, created_at)` —
  idempotent receipt with the address for the root:
  `codex_hook_report/report_id=<id>`.

## CLI

```
python scripts/codex-hooks/codex_hooks.py handler                       # hook dispatch
python scripts/codex-hooks/codex_hooks.py collect-opencode --session ID [--worktree PATH] [--db PATH]
python scripts/codex-hooks/codex_hooks.py show-report --report-id ID [--worktree PATH] [--db PATH]
python scripts/codex-hooks/codex_hooks.py recall --session ID [--worktree PATH] [--db PATH] [--capture-id N] [--after N]
python scripts/codex-hooks/codex_hooks.py fossil-lookup --md5 <32hex> [--fossil-repository PATH] [--worktree PATH]
```

Exit codes: `collect-opencode` 0 COMPLETE / 2 NOT_COMPLETE / 4 HOST_ERROR;
`fossil-lookup` 0 MATCH / 2 otherwise; others 0 (failures are visible on
stderr and in the JSON body). `show-report` always prints
`acceptance: NOT CLAIMED — acceptance belongs to the root, never to the hook`.

## Subagent completion predicate

The report's primary source is `agent_transcript_path` ONLY. Completion
(`completed=1`, basis `final-assistant-message`) requires a final assistant
message with NO outstanding tool call ids — commentary plus two outstanding
call ids and one result does NOT complete; an error row differentiates to
basis `error` (completed=0). Without a child transcript the basis is
`no-child-transcript` — the parent transcript is never mined for a final
message. `channel=final` establishes the final message; commentary alone cannot
complete. A new user message invalidates the previous turn's final. A transcript
without any channel markers uses the explicit
`final-assistant-message:legacy-no-channel-marker` qualification; a transcript
with channel markers and no final remains incomplete.

## External OpenCode completion predicate

`collect-opencode` connects through `tools/opencode_host.py` (live nonce echo
required; a stale record raises `HostError` — never a silent fallback), then
GETs `/session/status` and `/session/<id>/message` only — no prompt replay, no
token ever printed. COMPLETE requires ALL of:

1. a VALID status map, where the session is `idle` OR ABSENT from the map —
   `SessionStatus.set_idle` REMOVES the idle session's key
   (`packages/opencode/src/session/status.ts:69-84`); an invalid map refuses;
2. the latest assistant message ends the turn: last `step-finish` reason not in
   `tool-calls`/`error`/absent, and `time.completed` set;
3. that assistant message is the LAST message of the session — a newer user
   turn is not complete.

Incomplete runs are SAVED (completed=0, reasons in `errors`) with an idempotent
address — the failure history is retained, no acceptance inferred. Reports
retain available message ids, tool names, tool errors and host identity
(url+pid; the auth token never leaves the client); `changed_paths` and
`test_evidence` are stored as explicitly `unavailable: not exposed by the host
read API` — not a verified absence.

## Fossil provenance (read-only)

Repository source: explicit `--fossil-repository`, or the worktree's own
`_FOSSIL_`/`.fslckout` checkout database — an SQLite db whose `vvar` table
holds `name='repository'` (verified pointer; a pointer naming a missing file is
a visible error). The worktree directory only — no walking up into foreign
checkouts. Lookup opens the repository file in SQLite **read-only** mode, SQL
pre-filters check-ins by the wanted labels (no full-timeline scan per compact),
then an exact lexical check of `sv:`-prefixed labels runs in Python; a label
merely mentioned in prose never matches. Multiple check-ins per label are
**AMBIGUOUS** (all candidates listed) — never one verified match. Every result
carries a DB pin (head-hash + size + mtime). Outcomes `MATCH` / `AMBIGUOUS` /
`NO_MATCH` / `SCHEMA_DRIFT` / `NO_CHECKOUT` are always explicit — no-match is
never reported as a match, and the transcript remains the primary evidence.

## Testing

```
cd scripts/codex-hooks
python -m unittest discover -s tests -v
```

55 tests: RED→GREEN API surface; capture/restore byte-exactness + isolation +
NO_SV + anomalies + full-path addresses; WHOLE-context cap with unicode, big
overflow and a huge fossil comment (never mid-cut); current-chain/parent-goal
selection with two topics and latest-retraction survival; self-block
non-reingestion; unknown-schema refusal; real disposable Fossil fixtures
(vvar pointer verification, broken pointer, exact match, no-match,
prose-mention non-match, AMBIGUOUS, cross-repo refusal, schema drift,
SHA-unchanged reads); subagent reports (child transcript only, outstanding
call ids, idempotency, EXPECTED_FAIL receipt control, one bounded Stop
reminder); local HTTP host fixture (complete / absent-key-idle / invalid map /
new-user-turn / idle-alone-saved / tool-calls / provider error / stale host);
identity refusals and shared-DB isolation; subprocess wire contract. No mocks
for persistence/readback — real SQLite and real Fossil.

## Verified installation (2026-10-18)

Project-local `.codex/hooks.json` preserves the CodeGraph UserPromptSubmit
handler and adds PreCompact, PostCompact, SessionStart(compact/resume),
SubagentStart, SubagentStop and Stop. The file is intentionally local/ignored;
the configured Python/script absolute paths name this Windows installation.
Reconfigure those paths when moving the checkout. Review/trust definitions
through Codex's normal UI; changing trusted hashes by hand is unsupported.

Desktop runtime `0.163.0-alpha.10.2` reported all seven handlers enabled/trusted,
with no hook warnings/errors. The native lifecycle fixture observed a
217785-byte developer context block after compact, including three independent
primary statements and rollout addresses. Removing the block while retaining
the user input made the acceptance predicate fail. No neural provider was used.
The source revision, controls and retained failures are indexed in
`experiments_history/2026-10-18_codex-hooks/README.md`.

The deterministic lifecycle fixture used the temporary provider `hookfixture`.
Its thread must be archived after inspection: opening it later without the
per-run provider override produces “Model provider `hookfixture` not found”.
This does not require adding that provider to the user's config. The retained
fixture was archived through the normal app API; its primary transcript moved
to `archived_sessions` with an identical SHA-256. The cleanup receipt in the
evidence archive records the new address. Do not reopen a synthetic fixture as
a working chat. The archived lifecycle harness is historical evidence; a new
native replay must include explicit cleanup of its own disposable thread.

## Operational boundaries

Fossil fixture subprocesses receive `stdin=DEVNULL` and an explicit disposable
password. This keeps the native ConPTY run noninteractive; no real credentials
or user configuration are used. The retained hanging run is a harness failure,
not a passed suite.

- Never touches `trusted_hash`, hook trust, `.codex/hooks.json`, Claude home
  hooks, the kernel, `bin/`, or permanent memory.
- Hook feedback does not undo prior tool effects; trust belongs to the
  runtime/user. Installation and normal-trust review are the root's steps.
- Rollback: remove the handlers from `.codex/hooks.json` (parent-owned) and
  delete the derived SQLite file — source transcripts and Fossil are untouched.

<!-- goal_sv: Keywords: context-recovery 0.45, execution-receipts 0.35, native-windows 0.20
Semantic dominant: Проверенное восстановление полных первичных текстов и адресуемая отчётность делегированной работы.
md5: e342a7096db84f2c9051a8d73c6be042
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f81c69a257304de89b06173ac54e2f90
note: hash values are generative tags — search them, never compute them.
-->
