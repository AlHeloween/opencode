# Gateway three-point capture

What we were asked to send, what went onto the wire, and what came off it —
three points, one exchange key, each stored VERBATIM (parse/pretty are derived
views, never the record).

Setting: `gateway.logging.enabled` + `gateway.logging.perRequest` (see the
auto-generated `gateway.jsonc` header). Off by default.

## The three points

| folder | meaning | captured at |
|---|---|---|
| `per-request/` | what we INTENDED to send | `wrapFetch` entry, BEFORE the reasoning rewrite and credential/TDA consumption |
| `raw-wire/` | what WENT ONTO the wire | inside the transport seam — h3 before its `fetch`, h2 before `session.request` (pseudo-header set included), h1 before its `fetch` |
| `per-response/` | what CAME OFF the wire | streamed as bytes arrive, BEFORE the coalescer; terminal state recorded even when the stream is aborted or errors |

## One exchange key

Every point of one exchange shares `<ISO-start>-<requestId>`:

- `per-request/<key>.json` (+ derived `<key>.diff`)
- `raw-wire/<key>-attempt<N>.json` (+ derived `<key>-attempt<N>.diff`)
- `per-response/<key>-attempt<N>.json` / `.md` / `.raw.txt`

`N` counts transport attempts whose hand-off actually happened — an h3→h2
fallback leaves one record per attempt that reached its seam. A rung that
fails BEFORE its seam sent nothing and leaves no record (nothing went onto a
wire). `ISO-start` is UTC (`toISOString()` with `:`/`.` → `-`), so the files of
one exchange sort together.

## What each file stores

- **intent** — `body` = the VERBATIM incoming string; `headers` = the incoming
  set BEFORE credential consumption (names kept, `x-opencode-*` included — the
  record shows what we were handed, not what survived).
- **wire** — `body` = the exact string handed to the transport; `headers` =
  the final set at the seam. Transport-added headers (`host`,
  `content-length`, `accept-encoding`) belong to the transport itself and are
  not visible here.
- **response** — `status` + arrival headers; `.raw.txt` = the exact bytes as
  they arrived (pre-coalesce); `.json` = metadata + the assembled message;
  `state` = `complete | aborted | error`. Aborted and errored streams keep
  everything that had arrived; provider error bodies (h3 5xx, h2 transport
  errors) are stored too.

## Masking

Sensitive header VALUES are masked as `***`; the NAME is kept, so a reader can
see that a header was present (`authorization: "***"` answers "was there
auth?" where removal cannot). The `token` pattern matches a whole word only —
rate-limit headers such as `x-ratelimit-remaining-tokens` survive. Masking
applies to all three points before anything reaches disk.

## Derived views

`.diff` files are DERIVED from the verbatim records, never stored instead of
them: the raw-wire diff carries the wire-shape integrity report plus the
two-level pseudo-diff against the previous wire body; the per-request diff is
a line diff between consecutive intent bodies.

## Provenance

Introduced by `plans/2026-09-24_gateway-three-point-capture.md` (owner
decisions 2026-09-24: mask `***` / keep names; implementer hand-off away from
Anthropic). Pre-change state, measured on 21 exchanges: the per-request and
raw-wire files carried one IDENTICAL copy of the post-rewrite body, and
cancelled streams lost their response entirely (four observed exchanges).
