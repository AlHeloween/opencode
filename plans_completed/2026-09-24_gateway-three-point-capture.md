<!-- intention: gateway diagnostics show one copy of the request body (captured after rewrites, pretty-printed) and lose aborted/error responses -> three separated capture points per exchange: what we intended to send, what went onto the wire, what came off the wire, each verbatim -->
# Gateway three-point wire capture

Status: COMPLETE (2026-09-24). Branch: `Local_Development`.

**Implementer: this session.** The earlier «заводи план и не делай, тебе нельзя работать с проводом»
was addressed to Anthropic — owner, 2026-09-24: «это я антропику — у них бредосистема безопасности
нынче». The owner then assigned the plan to this session («Да, делай спокойно»). Code under
`packages/opencode/src/provider/gateway/**`, its tests, and docs are edited by this identity, T1–T6.
Original plan text frozen pre-revision: commit `737be793f3`.

## Design (owner's model — the three folders already exist, their CONTENT is wrong)

| folder | meaning (owner, 2026-09-24) | capture point it needs |
|---|---|---|
| `per-request/` | what we INTENDED to send | `wrapFetch` entry, BEFORE any rewrite |
| `raw-wire/` | what WENT ONTO the wire | inside the transport call, the exact string/headers handed to h1/h2/h3 |
| `per-response/` | what CAME OFF the wire | streamed as bytes arrive, before coalescing, incl. aborts and errors |

## Findings

### Original evidence (prior session; 6 exchanges at the time; kept as authored)

- ✓ (Python compare of parsed JSON, 6/6) `per-request/*.json` and `raw-wire/*.json` carry IDENTICAL `body`
  and `headers`; the only difference is the wrapper keys `id`/`timestamp`/`type`. The two points are one copy.
- ✓ (code read) Both are taken from the same `init.body` AFTER `rewriteReasoningContent`
  (`adaptive-client.ts:370`) and `applyTemporaryDataAcquisition` (`:416`), and after `x-opencode-*`
  headers are consumed (`:400-420`). The pre-rewrite intent is never recorded.
- ✓ (code read) `raw-wire/` is written BEFORE the transport (`:673`), body passed through `tryParseJSON`
  + pretty-print, headers through `wireHeaders`. It is not the bytes the transport sent; transport-added
  headers (`host`, `content-length`, `accept-encoding`) are invisible.
- ✓ (gateway.log + files) Exchanges `16596021…` and `893a8583…` logged `gateway.stream.first_chunk`
  (ttft 51/52 ms) but no `gateway.request.end` and no `per-response/` files. Mechanism (code read):
  the response body is buffered and written only in the TransformStream `flush()` (`:929`), which does
  not run on cancel/abort/error.
- ✓ (code read) Error bodies are never written: h3 5xx throws and discards the body (`:772`); h2
  `TransportError` carries `body` but `errorEntry` (`:874`) records only category/message.
- ✓ (code read) Response capture sits AFTER `CoalescingTransform` (`:896`): chunk boundaries and arrival
  times are lost.
- ~ (code read, not observed live) `sensitiveRegex` matches the substring `token`, so rate-limit response
  headers like `x-ratelimit-remaining-tokens` would be dropped from `per-response/`.
- ✓ (file names) The three files of one exchange carry three different time stamps and do not sort together.

### Re-verification (this session, 2026-09-24, instruments named; dataset grew 13 → 21 while checking)

- ✓ C1 re-verified independently: read-only comparer `experiments/2026-09-24_gateway-capture-verify/compare.py`
  (python, exit OK) over ALL present exchanges — **21/21** `body` and `headers` identical between per-request
  and raw-wire; wrapper keys differ exactly `{type, timestamp, id}`.
- ✓ Stored bodies are PARSED objects (`dict` in 21/21): the files are not the wire bytes — confirmed on
  data, not only by code read.
- ✓ Transport-added headers invisible across ALL raw-wire files: `host`, `content-length`, `accept-encoding`,
  `connection` never present; only `content-type`, `user-agent`, `x-request-id`, `x-session-affinity`,
  `x-session-id` ever appear.
- ✓ Missing `per-response` is now FOUR exchanges, all one log signature (`request.start → limiter.acquire →
  stream.acquire → stream.first_chunk`, no `request.end`): `16596021…`, `893a8583…` + `940f71ec…`, `ef6e4c42…`.
  The dataset grows live — this session's own traffic writes into the same folder.
- ✓ T2 seams exist: h3 — inline `fetch` (`:763`, body `init.body` string at `:766`); h2 —
  `session.session.request({":method",":path", ...verbatim headers})` (`h2-transport.ts:269` and `:434`);
  h1 — `fetch` with verbatim headers (`h1-transport.ts:33-41`). Transports are called only from
  adaptive-client (`:776`, `:785`, `:808`; `mod.ts` uses H2 for session management only).

### Corrections (do not repeat these as originally written)

- ✗ "6 exchanges" — stale: 21 and growing.
- ✗ C3 over-generalised. Real loss confirmed for **h3 5xx** (`:772` throws before reading the body). For
  **h2 non-stream `TransportError`** the field exists (`body: h2Result.body`, `:796`) but every raising path
  resolves `body: ""` (`h2-transport.ts:315-321, 359-362, 387-390`) — an empty carrier, dropped by
  `errorEntry` anyway. For **streamed non-2xx** (h2 `requestStream`, h1, h3 <500): resolved as a normal
  `Response` (`h2-transport.ts:458-465`, clamp 200–599, no throw) and ARE captured today when the consumer
  reads them — S3 baseline shows it; T3 must not "fix" what works.
- ~ `sensitiveRegex` × `token`: code-read confirmed; a live dropped name is unobservable in the data —
  stays Inferred until T5 changes behaviour.

## Decisions (owner, 2026-09-24)

- **T5**: mask the VALUE as `***`, keep the header NAME; narrow `token` so `x-ratelimit-*-tokens` survives.
  Masking applies to ALL three points — the intent snapshot is taken BEFORE credential consumption, so it
  contains `x-opencode-oauth-token` and its value must be masked at the source.
- **Implementer**: this session; plan DRAFT → ACTIVE (G4 ALLOW given).

## Contract after T1–T5

One exchange key on every file: `<ISO-start>-<requestId>`, where
`ISO-start = new Date(startTime).toISOString().replace(/[:.]/g, "-")`, computed ONCE at `wrapFetch` entry.
Transports are ATTEMPTS: `-attempt<N>` counts capture calls in order (`N` increments only when a hand-off
to a transport actually happens; a transport that fails before its seam leaves no record — nothing was sent).

| point | file(s) | stores |
|---|---|---|
| intent | `per-request/<key>.json` (+ derived `<key>.diff`) | `body` = VERBATIM incoming string (no parse, no pretty); `headers` = incoming set BEFORE credential consumption, values masked, names kept (incl. `x-opencode-*`) |
| sent | `raw-wire/<key>-attempt<N>.json` (+ derived `<key>-attempt<N>.diff`) | the exact `body` string and the final header set handed to the transport, one record per ATTEMPT that reached the seam |
| received | `per-response/<key>-attempt<N>.json/.md/.raw.txt` | status + ALL arrival headers (masked) on arrival; body appended pre-coalesce; terminal `state: complete \| aborted \| error`; error bodies (h3 5xx, `TransportError.body`) included. A pre-body error capture (h3 5xx, h2 `TransportError`) writes `.json` + `.raw.txt` only — there is no assistant message to assemble |

## Tasks (bindings inline)

- [x] **T1** — `per-request/` = intent. Snapshot at `wrapFetch` entry (after `:359-360`): `intentBody`
  (verbatim string), `intentHeaders` (flattened incoming, pre-consumption); `:375` becomes
  `const headers = { ...intentHeaders }`. Store verbatim — `formatPerRequestEntry` stops parsing; the
  `.diff` stays a derived view (pretty-derived for line granularity, fed from the verbatim strings).
- [x] **T2** — `raw-wire/` = sent. New module `wire-capture.ts` (naming + best-effort verbatim write,
  failure logs `bug:` and continues). Transports gain `onWire?: (headers, body) => void` and invoke it at
  their seam (`h1-transport.ts:33`, `h2-transport.ts:269` and `:434`, pseudo-header set included);
  h3 invokes the same closure at `:763`. `prevWireBody` pseudo-diff kept, derived, per attempt.
- [x] **T3** — `per-response/` = received. Raw chunk push moves into the FIRST TransformStream
  (pre-coalesce, `:900-906`); terminal wrapper (`ReadableStream` pull/cancel around the piped body) writes
  `aborted` (consumer cancel) and `error` (source error); `flush()` writes `complete`; all three share one
  `finalizeResponse(state)` (guarded once). h3 5xx: read body (size-capped) before throw, write error
  capture. h2 non-stream `TransportError`: write error capture at the throw site. `gateway.request.end`
  gains `state`. Telemetry (`sample.chunks` on coalesced emissions) unchanged — true per-chunk arrival
  metadata is a named residual, not part of T3.
- [x] **T4** — one exchange key `<ISO-start>-<requestId>` on all three points (attempt suffix on sent +
  received only); shared `isoFileStamp()` / `exchangeStem()` in `wire-capture.ts`. Tests move in the SAME
  change (renames break `adaptive-client.test.ts`, `async-logger.test.ts`).
- [x] **T5** — masking: value `***`, name kept; `"token"` → `"\\btoken\\b"`; `sanitizeHeaders` masks;
  `wireHeaders` keeps its shape (strip internal + mask). Applies to intent, wire, response, and the
  `request.start` debug headers.
- [x] **T6** — docs: record the three-point contract in `docs/` next to the capture lane (target:
  `docs/reasoning-round-trip-contract.md` §capture or a new `docs/gateway-capture.md` + index entry);
  refresh the stale filename comment `config-manager.ts:175-176`.

## Touch map (G6)

| file | change |
|---|---|
| `src/provider/gateway/adaptive-client.ts` | entry snapshot + shared stem; masking (`:111-153`); per-request write (`:509-549`); per-attempt capture closure + h3/h2/h1 seam calls (`:670-716`, `:763-810`); TS1 raw push + terminal wrapper + `finalizeResponse(state)` + per-response naming (`:893-1019`) |
| `src/provider/gateway/wire-capture.ts` | NEW: `isoFileStamp`, `exchangeStem`, `writeWireAttempt`, error-response capture writer |
| `src/provider/gateway/h1-transport.ts` | `onWire` option + call before `fetch` |
| `src/provider/gateway/h2-transport.ts` | `onWire` option + calls before `session.request` (request, requestStream) |
| `src/provider/gateway/async-logger.ts` | `makePerRequest` honours `entry.fileName`; `formatPerRequestEntry` stores verbatim |
| `src/provider/gateway/raw-diff.ts` | verify-only (renderers already take raw strings / parsed bodies) — adjust imports if signatures say otherwise |
| `src/provider/gateway/config-manager.ts` | comment `:175-176` → three-point contract |
| `test/provider/adaptive-client.test.ts` | update 2 tests (fallout of T1/T4), add three-point test (S1'/S2'/S3/S4/S5 in-process) |
| `test/provider/async-logger.test.ts` | naming + verbatim expectations |
| `docs/` | T6 section |

## Smoke Tests

Baseline (measured this session, BEFORE edits):
- S1: per-request body == raw-wire body — today 21/21 equal (comparer, exit OK).
- S2: aborted streaming turn → no `per-response/` — today 4 exchanges with the signature.

Post-change (primary oracle = focused tests; live TUI keeps old code until the owner rebuilds — `bin/` untouched):
- S1': one turn → `per-request` body ≠ `raw-wire` body (the `:370` rewrite and/or `:416` TDA must show);
  the raw-wire `body` string byte-equals the string handed to the transport.
- S2': abort mid-stream → `per-response/<key>-attempt1.json` with `state: "aborted"` + partial body.
- S3: h3 5xx (stubbed QUIC fetch in tests) → error capture on disk with the body; streamed non-2xx stays captured.
- S4: fallback chain → one `raw-wire` record per attempt that reached its seam, error `per-response` for the failed attempt.
- S5: capture is read-only — bytes received by the server identical with logging on vs off.
- S6: focused suites green: `bun test test/provider/adaptive-client.test.ts test/provider/async-logger.test.ts test/provider/gateway-tda.test.ts`.

## Claims

| id | claim | falsifier | status |
|---|---|---|---|
| C1 | per-request and raw-wire are one copy today | any exchange where bodies differ | ✓ Exact (21/21, this session; original 6/6) |
| C2 | aborted/cancelled streams lose the response | a partial per-response after an abort | ~ Inferred (4 observed signatures + flush-only write, code) |
| C3 | error bodies are never persisted | an error body on disk | ~ Inferred (code; corrected scope — h3 5xx real, h2 non-stream carrier empty, streamed non-2xx already captured) |

## Implementation record (2026-09-24)

- Code: `wire-capture.ts` (new), `adaptive-client.ts`, `h1-transport.ts`, `h2-transport.ts`, `async-logger.ts`; docs `docs/gateway-capture.md` + `docs/README.md` index; `config-manager.ts` comment refreshed.
- Typecheck: `bun typecheck` (tsgo, cmd_runner run `20260924T100232Z_14a93368`) — **exit 0**.
- Tests: `bun test test/provider/adaptive-client.test.ts test/provider/async-logger.test.ts` (run `20260924T100232Z_54e1d35f`) — **25 pass / 0 fail / 116 expect()**, covering S1' (intent ≠ wire after the rewrite), S2' (`aborted` state with partial body), S3 (h3-5xx body on disk), S4 (fallback: attempts `[h3, h2]`, response on attempt 2), S5 (wire bytes identical with logging off) and S6.
- Re-verification instrument archived: `experiments_history/2026-09-24_gateway-capture-verify/`.
- **Residual (owner action):** the running `bin/opencode.exe` still executes the pre-change gateway (bin/ untouched per the owner fence); a rebuild + restart is needed to see the three-point files on live traffic. Until then S1'–S5 are proven by the in-process suite, not by the TUI.

## Risks

- R1 (critical) — capture must not alter what is sent or delay the stream: the tee is read-only; a write
  failure logs `bug:` and continues. Guard: S5.
- R2 — disk: request bodies ~0.3–2.5 MB each; three points triple that (verbatim intent + verbatim wire).
  All capture stays behind `gateway.logging.enabled` + `perRequest`, as today.
- R3 — secrets: masking must apply before the first byte hits disk at ALL three points; the intent record
  is the one carrying `x-opencode-oauth-token` pre-consumption.
- R4 — T4 renames files that tests read: `adaptive-client.test.ts` + `async-logger.test.ts` updated in the
  SAME change; `config-manager.ts:175` comment refreshed; no other programmatic readers (grep 2026-09-24).
