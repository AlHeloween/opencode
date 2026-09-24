<!-- intention: gateway diagnostics show one copy of the request body (captured after rewrites, pretty-printed) and lose aborted/error responses -> three separated capture points per exchange: what we intended to send, what went onto the wire, what came off the wire, each verbatim -->
# Gateway three-point wire capture

Status: DRAFT (2026-09-24). Branch: `Local_Development`.

**Implementer: NOT Claude.** Owner ruling, 2026-09-24, verbatim: «заводи план и не делай, тебе нельзя
работать с проводом». This plan is diagnosis + contract only; the transport/capture code
(`packages/opencode/src/provider/gateway/**`) is edited by the owner or an identity the owner names.

## Design (owner's model — the three folders already exist, their CONTENT is wrong)

| folder | meaning (owner, 2026-09-24) | capture point it needs |
|---|---|---|
| `per-request/` | what we INTENDED to send | `wrapFetch` entry, BEFORE any rewrite |
| `raw-wire/` | what WENT ONTO the wire | inside the transport call, the exact string/headers handed to h1/h2/h3 |
| `per-response/` | what CAME OFF the wire | streamed as bytes arrive, before coalescing, incl. aborts and errors |

## Findings (evidence, 2026-09-24, `.opencode/data/gateway/`, 6 exchanges)

- ✓ (Python compare of parsed JSON, 6/6) `per-request/*.json` and `raw-wire/*.json` carry IDENTICAL `body`
  and `headers`; the only difference is the wrapper keys `id`/`timestamp`/`type`. The two points are one copy.
- ✓ (code read) Both are taken from the same `init.body` AFTER `rewriteReasoningContent`
  (`adaptive-client.ts:370`) and `applyTemporaryDataAcquisition` (`:416`), and after `x-opencode-*`
  headers are consumed (`:400-420`). The pre-rewrite intent is never recorded.
- ✓ (code read) `raw-wire/` is written BEFORE the transport (`:673`), body passed through `tryParseJSON`
  + pretty-print, headers through `wireHeaders`. It is not the bytes the transport sent; transport-added
  headers (`host`, `content-length`, `accept-encoding`) are invisible. ~ (not measured) which headers each
  transport adds.
- ✓ (gateway.log + files) Exchanges `16596021…` and `893a8583…` logged `gateway.stream.first_chunk`
  (ttft 51/52 ms) but no `gateway.request.end` and no `per-response/` files. ~ (code read, not reproduced)
  mechanism: the response body is buffered and written only in the TransformStream `flush()`
  (`:929`), which does not run on cancel/abort/error.
- ✓ (code read) Error bodies are never written: h3 5xx throws and discards the body (`:772`); h2
  `TransportError` carries `body` but `errorEntry` (`:874`) records only category/message.
- ✓ (code read) Response capture sits AFTER `CoalescingTransform` (`:896`): chunk boundaries and arrival
  times are lost.
- ~ (code read, not observed live) `sensitiveRegex` matches the substring `token`, so rate-limit response
  headers like `x-ratelimit-remaining-tokens` would be dropped from `per-response/`.
- ✓ (file names) The three files of one exchange carry three different time stamps (`<epoch-ms>_req_<id>`,
  ISO at send, ISO at end) and do not sort together.

## Tasks

- [ ] T1 — `per-request/` = intent: snapshot `init.body` (verbatim string) and incoming headers at
  `wrapFetch` entry, before `:369`. No parse, no pretty.
- [ ] T2 — `raw-wire/` = sent: record the exact body string and final header set at the transport seam
  (h3 `fetch`, `H2.request`/`H2.requestStream`, `H1.request`), byte-for-byte; one record per ATTEMPT, so an
  h3→h2 fallback shows both attempts. Pretty/diff views are derived from this file, never instead of it.
- [ ] T3 — `per-response/` = received: status + ALL headers on arrival; body appended in `transform`
  BEFORE `CoalescingTransform`; terminal state recorded as `complete | aborted | error`. Error bodies
  (h3 5xx, h2 `TransportError.body`, non-2xx) written too.
- [ ] T4 — one exchange key: the same `<ISO-start>-<requestId>` prefix on all three files.
- [ ] T5 — header masking: replace secret VALUES, keep the NAME; narrow the `token` pattern so rate-limit
  headers survive. **Open decision (owner):** mask as `***` vs keep today's full removal.
- [ ] T6 — docs: record the three-point contract in `docs/` next to the gateway logging description.

## Smoke Tests

Baseline (before any edit) — expected to show the defect:
- S1: for one DeepSeek tool-call turn, `per-request` body == `raw-wire` body (today: equal, 6/6).
- S2: abort a streaming turn mid-response → no `per-response/` file (today: observed for 2/6).

Post-change:
- S1': same turn → `per-request` body ≠ `raw-wire` body (the reasoning rewrite at `:370` must show);
  sha256 of the `raw-wire` body == sha256 of the string handed to the transport.
- S2': aborted stream → `per-response/` exists with the partial body and state `aborted`.
- S3: forced error response (e.g. invalid model on a live provider) → its body is on disk.
- S4: h3→h2 fallback → two `raw-wire` attempt records, one `per-response`.
- S5: capture is read-only — outgoing body bytes identical with logging on vs off (KV-cache prefix).

## Claims

| id | claim | falsifier | status |
|---|---|---|---|
| C1 | per-request and raw-wire are one copy | any exchange where bodies differ | ✓ Exact (6/6 compare) |
| C2 | aborted streams lose the response | a partial per-response after an abort | ~ Inferred (effect observed, mechanism from code) |
| C3 | error bodies are never persisted | an error body in any gateway file | ~ Inferred (code) |

## Risks

- R1 (critical) — capture must not alter what is sent or delay the stream: the tee is read-only, and a
  write failure must not break the request (log `bug:` and continue). Guard: S5.
- R2 — disk: request bodies are ~0.3–2.5 MB each; three points triple that. All capture stays behind
  `gateway.logging.enabled` + `perRequest`, as today.
- R3 — secrets: T2 records the real header set; masking (T5) must apply before the first byte hits disk.
