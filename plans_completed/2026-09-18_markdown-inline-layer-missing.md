<!-- intention: markdown inline markup renders raw in the TUI -> emphasis, inline code and link syntax are styled and their markers concealed -->

# Markdown inline layer — fixed and verified; the cache it exposed still violates portability

```yaml
status: FIXED — verified in the built product (v10.0.1005) on 2026-09-18. See "Resolution".
  COMPLETED 2026-09-22: every item landed (inline layer, infoStringMap aliases, portability fix 4/4);
  the last acceptance — a full `bun test` for the home-purity guard — is SUPERSEDED by the standing
  prohibition (owner, 2026-09-22: full suite never runs; AGENTS.md § Full package test suite), and the
  home-purity evidence on record is the rebuilt-binary smoke above, not a suite run.
raised: 2026-09-18 by Alexander, from the built binary
cost: ~10 rebuilds and most of a day, largely wasted — see "How this was investigated badly"
```

## Resolution — verified in the built product (2026-09-18, v10.0.1005)

The inline layer works in the binary. Verified by driving the built product
directly through cmd_runner — not a harness:

- Repro: `cmd_runner start --cwd <worktree> -- dist\bin\opencode.exe --log-level DEBUG`,
  then send `markdown test: **bold** and `code` done` into the prompt.
- Stored message (`part` row, session `ses_f4e0db194ffehQzM1pVpU8hndh`):
  `markdown test: **bold** and `code` done` — markers present on the wire.
- Render (ConPTY text): `markdown test: bold and code done` — every marker
  concealed. Sent bytes 39 + CRLF = 41 (`in.log`), so the input was not mangled.
- Worker log (`*_log_system_internal.jsonl`, service `tree-sitter.worker`):
  - `Loaded from cache: …/opentui/tree-sitter/queries/markdown-649d86c8.scm` — markdown highlights
  - `Loaded from cache: …/opentui/tree-sitter/queries/markdown-7e62eaf5.scm` — markdown injections
  - `Loading from local path: B:\~BUN\root\tree-sitter-markdown_inline-*.wasm`
  - `Loading from local path: B:\~BUN\root\highlights-*.scm`
  Nothing else requests `markdown_inline`; its load IS the injection running.
  No `bug:` lines — nothing failed.

Working combination: the mapping (`4966c01d74`) plus a loadable
`markdown_inline` entry; the final build also dropped the redundant URL-based
entry (`836961d588`), so the grammar resolves to OpenTUI's bundled, offline-safe
assets. Which single change turned it is not isolated here — the current binary
is what is proven.

### Why the original next step as written could not have answered anything

`tui/worker.ts:17` calls `Log.init({ print })` with no `logLevel`; the default
is INFO and the instrumentation routes the worker's breadcrumbs at `debug` —
filtered. The failure mode this hunt chased (a skipped injection with no
`targetLanguage`) emits nothing at any level. So "read the log" alone can only
ever show `bug:` lines. The lever is the main process: `--log-level DEBUG`.
(`/settings → Logging → logLevel` advertised the same setting and nothing
consumed it — fixed 2026-09-18: the TUI re-inits `Log` from `config.logLevel`
after its bootstrap config fetch; `tui/worker.ts` now honors `--log-level`;
the CLI flag still wins.)

## Still open — the same override dropped `infoStringMap` (caught live)

Alexander's session (v10.0.1005) logged, at WARN — visible without DEBUG
because warnings pass the INFO floor — at 00:39:52:

    bug: No parser found for injection language: ts

A fenced block whose info string is a short alias (`ts`, `js`, `jsx`, `tsx`,
`md`) falls back to the literal name, and no such filetype is registered:
opencode's markdown entry carries `injectionMapping.nodeTypes` only.
OpenTUI's default entry also carried `infoStringMap` (ts→typescript,
js→javascript, …), and `addDefaultParsers` replaces the whole entry — the same
replace-not-merge defect as the injection mapping, one field over. Fences with
canonical names (`yaml`, `python`) are unaffected; alias fences lose
highlighting.

Fixed 2026-09-18: `infoStringMap` restored in `packages/opencode/parsers-config.ts`
(mirrors OpenTUI's default map), pinned by the new test "markdown maps short
info-string aliases to canonical filetypes"; the target-resolution invariant now
covers `infoStringMap` too — `bun test test/util/parsers-config.test.ts` 5/5.
A deep merge in `addDefaultParsers` remains the structural follow-up.

### `bat`'s query URL is dead upstream (found by the fetch)

`https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/batch/highlights.scm`
returns 404 — nvim-treesitter has no batch query, and the `tree-sitter-batch`
npm package ships none either. The runtime 404ed identically, so nothing
regresses; the entry stays as the documented dead case (allowlisted in the
embed test) until a maintained batch query appears or the entry is dropped.

## Symptom (Exact, from the binary)

`**Сырой URL:**` renders with its asterisks visible and no bold. Inline
backticks around `` `webfetch` `` likewise visible and unstyled. Meanwhile:

- list markers `1.` `2.` are coloured — the markdown BLOCK grammar works
- a ```yaml fenced block is fully syntax-coloured — fenced injection works
- links are underlined — that is our own `addMarkdownLinkHighlights`, not a grammar

So: block layer fine, fenced-code injection fine, **inline layer absent**.

## What is proven

- The compiled grammar IS in the binary: `tree_sitter_markdown_inline` appears 6×,
  `strong_emphasis` / `emphasis_delimiter` 3× each, 79 wasm headers. Probe
  validated against controls.
- `markdown_inline` IS registered — by OpenTUI's own defaults.
  `registerDefaultParsers` (client.ts:339) registers every default whose filetype
  is not overridden, and opencode does not override it.
- Its highlights query WAS downloaded: `markdown_inline-27af876a.scm`, 2098 bytes,
  cached 08:03 under `~/.local/share/opentui/tree-sitter/queries`.
- That query conceals `emphasis_delimiter` identically to OpenTUI's bundled copy.
- The one-shot path used by `CodeRenderable` DOES process injections and DOES
  pass the mapping (parser.worker.ts:852-864).

By reading, the chain is complete. The binary disagrees.

## The one defect found and fixed

`addDefaultParsers` REPLACES an entry by filetype rather than merging it.
opencode overrides `markdown`, and its entry carried no `injectionMapping`, so
OpenTUI's mapping — `inline → markdown_inline` — was dropped. Without it
`targetLanguage` stays undefined and the injection is skipped **silently**.

Fixed in `4966c01d74`, asserted in `test/util/parsers-config.test.ts`.
**Verified in the built product on 2026-09-18 — see "Resolution".** The mapping
alone was not the whole story: the final build carries both the mapping and a
loadable `markdown_inline` entry.

## The instrument that was missing all along

The worker reports every failure via `emit("worker:log", ...)`. **Only tests
ever subscribed.** In the product the event had no listener, so "No parser found
for injection language", "Failed to fetch highlight query" and "Failed to create
queries" were all discarded. The subsystem had zero observability.

Routed into the log in `5403c823cb`.

**Executed 2026-09-18 — see "Resolution".** The rebuild (v10.0.1005) shipped and
the lines were read at `--log-level DEBUG`: the injection runs, `markdown_inline`
loads from the embedded assets, markers conceal. The decision tree is kept for
the record; both branches are settled by the Resolution run.

- lines present, naming markdown_inline → loading fails, fix the loader
- no lines at all → the injection is never requested, so the mapping still is
  not reaching the worker; inspect what `resolveFiletypeParser` sends over
  `postMessage`

## Reverted as harmful

`ed774a2954` added a `markdown_inline` entry to parsers-config. It was
unnecessary — the default was already registered — and it REPLACED a bundled,
offline-safe query with one fetched from GitHub at runtime. Reverted; a test now
pins that it must not come back.

## Architectural defects found on the way (partially fixed — see Fix below)

1. **103 MB of compiled grammars are embedded; 72 KB of `.scm` queries are
   downloaded at runtime** from raw.githubusercontent and cached. First use of a
   language without network = no highlighting. 13 registered languages have no
   cached query yet, `zig` among them.
2. That cache lives in `~/.local/share/opentui/`, outside the portable
   `{worktree}/.opencode/data` scheme AGENTS.md requires.

Confirmed live 2026-09-18, same diagnostic run as the Resolution:
`Loaded from cache: C:\Users\Alexander\.local\share\opentui\tree-sitter\queries\markdown-649d86c8.scm`.

The mechanism, so none of it is re-derived:

- `data-paths.ts` (opentui): `globalDataPath = (XDG_DATA_HOME || os.homedir()/.local/share)/opentui`.
  The product never sets `XDG_DATA_HOME`; only the test preload redirects it.
- `parser.worker.ts` `initialize()` mkdirs `{dataPath}/tree-sitter/{languages,queries}`
  on every TUI run — empty home dirs appear even when nothing downloads.
- `download-utils.ts` is cache-first: a `readFile` hit skips the network, so a
  stale cache persists indefinitely (the July 13 markdown queries are still the
  ones loaded today).

Second directory, checked as asked: `~/.local/share/opencode` holds two EMPTY
subdirectories — `log/` and `repos/` — hidden from `list`/`glob` by their
ignore rules (found via `os.listdir` after `rmdir` refused). Created
2026-09-17 17:44:01 — during the revert-crossing/routing test window (test file
written 17:43:10, committed 17:46/17:47). No current writer found in the repo:
greps leave only the home-purity sentinel list, a stale comment in
`config-manager.ts`, and desktop-electron's linux-only path. The home-purity
guard lists it as a HARD-FAIL sentinel. Alexander deletes the directory
himself — logs belong under `{worktree}/.opencode/data/log`, not here.

Fix (authorized 2026-09-18; status per item):

1. [x] **Redirect the tree-sitter data path into the worktree** — `OPENTUI_DATA_HOME`
   registered in `data-paths.ts` (our fork) as a base override; `thread.ts` and
   `attach.ts` set it to `{worktree}/.opencode/data/cache` before the app module
   loads. Test: "OPENTUI_DATA_HOME overrides the base data directory" — 5/5 pass.
2. [x] **Embed the queries** — `script/fetch-queries.ts` fetches every query URL
   into `assets/queries/<filetype>-<kind>-<n>.scm` (30 files) and generates
   `src/util/wasm-embedded-queries.ts` (URL -> asset map); `resolvedParsers` in
   the TUI rewrites query URLs to embedded paths, and `src/assets.d.ts` declares
   `*.scm` (without it tsgo hangs on the unresolved file imports — 12+ min,
   3.3 GB; declared, exit 0 in seconds). Needs the shared rebuild.
3. [x] Guard: `.local/share/opentui` added to home-purity SENTINELS.
4. [x] Cleanup: both home directories were removed by Alexander and were not
   recreated by the rebuilt binary; the stale worktree query cache (4 files) is
   deleted too. The full `bun test` run in `packages/opencode` is the last
   acceptance item.

## Smoke Tests — portability fix (2026-09-18)

- `bun test src/lib/data-paths.test.ts` (opentui core) — override honored. [x] 5/5
- `bun test test/util/parsers-config.test.ts` (opencode) — aliases mapped +
  every query URL embedded. [x] 6/6
- `bun typecheck` (opencode) — [x] exit 0.
- Smoke on the rebuilt binary (v10.0.1006, cmd_runner, `--log-level DEBUG`) — [x]:
  (a) no writes under `~/.local/share/opentui` — the directory is gone and was not
      recreated; the cache lands in `{worktree}/.opencode/data/cache/opentui/tree-sitter/`
      and the log reads `Loaded from cache: D:\zPython\opencode\.opencode\data\cache\opentui\…`;
  (b) a ```ts fence loaded `tree-sitter-typescript` from the embedded root and
      logged no `No parser found for injection language: ts`;
  (c) `--log-level DEBUG` produced the tree-sitter breadcrumbs.
- Embed smoke on the rebuilt binary (v10.0.1007, cmd_runner, `--log-level DEBUG`) — [x]:
  the log shows `Loading from local path: B:\~BUN\root\markdown-highlights-0-*.scm`
  and `…markdown-injections-0-*.scm` — queries read from the binary, no
  `Loaded from cache` line at all. The stale pre-embed cache files under
  `{worktree}/.opencode/data/cache/opentui/tree-sitter/queries/` were removed.
- Full `bun test` in `packages/opencode` — home-purity guard green. **[x] superseded 2026-09-22**: the
  full suite is prohibited (AGENTS.md § Full package test suite — measured 18 min, `bytes_written: 0`,
  ~5 GB); the home-purity property stays covered by the [x] rebuilt-binary smokes above (the two home
  directories were removed and not recreated), and a targeted re-check is the `aa/zz-home-purity` pair
  around whatever set needs it.

## How this was investigated badly — the actual lesson

Six patch-and-rebuild cycles, each costing Alexander a build, each justified by a
green harness. Three compounding errors:

1. **A green test harness was repeatedly treated as evidence about the binary.**
   They differ exactly where the defect lived. Every "measured false" claim made
   from the harness was worthless.
2. **Nobody asked whether the subsystem could report its own failure.** It could,
   and had been, into an event with no listener. That check costs one grep and
   would have ended this in minutes.
3. **codegraph was not used until Alexander said so.** One call surfaced
   `registerDefaultParsers`, the replace-not-merge semantics and the one-shot
   injection path together — more than six rebuilds produced.

Standing correction: for a defect that reproduces only in the built product,
**instrument the product first**. Do not patch against a harness that cannot
reproduce it.

## Also landed today, unrelated and verified

- `08067e5` Textarea resize — one field answering two questions; 4 tests closed,
  both directions mutation-tested.
- `c83ee3b4` mermaid scale anchored to the terminal cell — 22× spread in apparent
  text size collapsed to constant; **confirmed visually by Alexander**.
- `0d4d875963` model picker — cursor anchored to a value, row-height predicate
  shared, footer no longer crushes the name, unpublished price no longer shown
  as zero.
- `e8f1416834` style-level oracle for markdown, which asserts attributes and
  colour instead of characters.
- `a7c9b75e04` + `578a849f3e` composition of the two styling sources. Correct and
  tested, but it did NOT address the reported symptom — do not credit it with the
  fix if the inline layer comes back.
