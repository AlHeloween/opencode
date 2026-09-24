<!-- intention: provider transport attempts h3 first, downgrades to h2 on failure, reaches h1 only as a last resort; the choice is visible and selectable in the TUI -->
# H3-first provider transport + TUI protocol selection

Status: COMPLETED (2026-09-24, closed by owner). Branch: `Local_Development`.

## Proven (runtime evidence)

- ✓ Transport chain h3 → h2 → h1 with per-origin negative h3 cache: unit tests 6 pass / 48 expect; live smoke `experiments/2026-09-24_deepseek-transport/smoke-auto-h3-first.mjs` (first call 1221 ms with h3 probe, second 111 ms without; `__gatewayLastProtocol = h2`); owner's own log: `configured:"auto", using:"h3", chain:"h3>h2>h1"` then `fallback h3→h2 (tls_error)` then `first_chunk 54 ms`.
- ✓ Probes: `api.deepseek.com` h2-only (h3 fast-fail 46 ms, no alt-svc, CloudFront DNS `alpn=h2`); `api.openai.com` h3 live (positive control). `/v3` does not exist on deepseek (404 with a live key; unversioned base_url).
- ✓ Diagram font = terminal face **Consolas** for ALL diagram types; metrics and raster share one face (WASM `registerFont` + resvg `fontFiles` + `themeVariables.fontFamily`); size anchored to the terminal cell. Owner confirmed live: «Диаграмма тоже нарисовалась как надо».
- ✓ Perf: resvg 440–550 ms → 7–10 ms per diagram (double font-scan + probe removed); burst 8 diagrams 8145 → 3157 ms; embedded OFL Cascadia Mono (BunFS) is the fallback.
- ✓ Attachments: lossy pass only on overflow; an already-fitting image is lossless-or-untouched (pixel-identity test `test/attachment/image-normalize.test.ts`, 2 pass).
- ✓ Sidebar row never blank: `deepseek · OpenAI · auto (protocol)` observed live by the owner.

## Residual (NOT closed — carried out of this plan)

- **Sidebar FACT is not proven**: only the `auto` fallback was observed; the last factual protocol (`h2`) never appeared in the UI. The `globalThis.__gatewayLastProtocol` channel is unconfirmed (server-side write vs TUI plugin read). Next step: carry the fact in session data the sidebar already reads.
- **T3 live read-back**: the Protocol picker writes `options.protocol` and is covered by unit tests, but a live selection from the TUI dialog changing the transport was never observed end to end.
- Sweep leftovers (owner's call): media-symbols temp-file path, request-diff async write.

## Tasks

- [x] T1 — fallback chain h3→h2→h1 (`protocolChain` + `shouldDowngrade`; h3 leaves on any transport error, incl. tls_error from QUIC handshake).
- [x] T2 — `auto` default + negative h3 cache (TTL 30 min, bounded 5 s probe).
- [~] T3 — TUI protocol editor: code + tests + typecheck green; **live transport change not observed** (residual).
- [~] T4 — honest sidebar row: renders and never blanks (owner-observed); **factual protocol never shown** (residual).
- [x] T5 — probe scripts + triage of the wider sweep (gateway dumps gated, media-symbols fallback-only, sixel legacy).
- [x] Build — smoke passed; binary rebuilt & promoted by the owner (bin == dist).
