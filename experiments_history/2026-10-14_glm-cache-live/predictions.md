# Live GLM cache probe — predictions recorded BEFORE any live request

Date: 2026-10-14 (UTC morning). Author: Smit (robot-wave t41).
Instrument: `experiments_history/2026-10-14_independent-glm-cache-probe/cache_probe.py`
(sha256 5e3b33650fbbb0b6a3c7d0a4c72428e3d0f0346594705b77d3cbccdee0e9ddef, matches MANIFEST).
Each live run: one new random session affinity, ONE fixed request body, 3 requests
(initial, immediate repeat, one repeat after idle). No retries on network errors.

## Precondition — local qualification

| check | prediction |
|---|---|
| `python -m unittest -v test_cache_probe.py` in the archived probe dir | 15 tests, 0 failures, exit 0 |

## Series design (both series identical except the body's retention field)

- control series: `control.json` (no `prompt_cache_retention`), idle 360 s.
- retention series: `retention.json` (`prompt_cache_retention: "24h"`), idle 360 s.
- idle value source: the ONLY rehearsed template — `dry-run-control/report.json`
  carries `requested_idle_seconds: 360.0`; the plan pins no other value, and the
  envelope (`time_budget_ms=1800000`, 30 min) fits 2×(360 s + requests) but not
  2×(900 s + requests). A 360 s pause cannot discriminate the 24h-retention
  question either way (measured product-side go/GLM TTL-failure point: 43 min miss);
  these runs are diagnostic per the plan ("результаты diagnostic, не предсказанный PASS").

## Predictions (per ordinal, per series — hit / miss / unknown)

| series | ordinal | case | prediction | rationale |
|---|---|---|---|---|
| control | 1 | cold initial | MISS (cached_tokens=0) | key/prefix never sent live before (prior runs were dry-run only) |
| control | 2 | immediate repeat | HIT (cached_tokens>0) | identical bytes, same session affinity, GLM implicit caching, body ~11 KB ≫ min cacheable length |
| control | 3 | after 360 s idle | HIT (cached_tokens>0) | 6 min ≪ the only measured go/GLM TTL-failure pause (43 min miss); Bedrock GLM-5.3 card: retention ≥30 min |
| retention | 1 | cold initial | MISS (cached_tokens=0) | unique prefix/key, never sent |
| retention | 2 | immediate repeat | HIT (cached_tokens>0) | same as control |
| retention | 3 | after 360 s idle | HIT (cached_tokens>0) | 6 min pause; retention field expected neutral at this horizon |

## Explicit non-predictions (Unknown by construction)

- Anything about the 24h retention effect: a 6-minute pause is below any credible
  TTL boundary, so an equality of the two series decides nothing about retention.
- Exact TTL boundaries: forbidden by the instrument's own contract
  (`measured_ttl_seconds=null`; miss alternatives: expiry/eviction/routing).
- Per-request cached_tokens volume beyond >0: server-dependent.

## Divergence handling

Any outcome other than `observed_miss`/`observed_hit` with the predicted sign
(including `unknown` from a 200 without valid usage, or an error with
error_class) is recorded as a divergence against this sheet, not as a pass.

## Budget

Requests: 2 series × 3 = 6 (envelope limit 12). max_tokens=128 per request (cap 128).
Expected wall clock: ~7 min per series (360 s pause + 3 requests), ~15 min total.

## Addendum — updated prediction for the retention series (recorded BEFORE its launch)

Control series observed (report.json, session ses_5380fe108dfd41eeb9aefe61f4f59165):
ordinal 1 MISS (as predicted), ordinal 2 **MISS** (divergence — HIT was predicted).
The instrument stopped per its own contract ("no qualified warm cache for a survival experiment"),
so ordinal 3 never ran. Both responses carried valid usage with `cached_tokens=0` AND
`cache_write_tokens=0` at `prompt_tokens=2617`.

Updated prediction for the retention series (same 2617-token body + `prompt_cache_retention: "24h"`):

| ordinal | case | prediction | rationale |
|---|---|---|---|
| retention | 1 | cold initial | MISS | unique key/prefix; cold by construction |
| retention | 2 | immediate repeat | MISS (updated) | the retention field does not change the body size; control showed no cache write at 2617 prompt_tokens — most probable candidate: prefix below a minimum cacheable length, or the route does not cache this request shape. A HIT here would be a positive divergence showing retention toggles a different cache mode |
| retention | 3 | after 360 s idle | not reachable if ordinal 2 misses | instrument contract |
