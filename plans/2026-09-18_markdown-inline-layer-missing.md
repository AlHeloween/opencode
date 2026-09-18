<!-- intention: markdown inline markup renders raw in the TUI -> emphasis, inline code and link syntax are styled and their markers concealed -->

# Markdown inline layer — open, with the cause narrowed and the instrument finally installed

```yaml
status: NOT fixed. Cause narrowed to one of two places; observability added so the next run answers it.
raised: 2026-09-18 by Alexander, from the built binary
cost: ~10 rebuilds and most of a day, largely wasted — see "How this was investigated badly"
```

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
**Whether this alone fixes the symptom is UNVERIFIED** — the rebuild after it
showed no change.

## The instrument that was missing all along

The worker reports every failure via `emit("worker:log", ...)`. **Only tests
ever subscribed.** In the product the event had no listener, so "No parser found
for injection language", "Failed to fetch highlight query" and "Failed to create
queries" were all discarded. The subsystem had zero observability.

Routed into the log in `5403c823cb`.

**Next step is one rebuild and reading `tree-sitter.worker` lines from
`.opencode/data/log`.** Not another patch.

- lines present, naming markdown_inline → loading fails, fix the loader
- no lines at all → the injection is never requested, so the mapping still is
  not reaching the worker; inspect what `resolveFiletypeParser` sends over
  `postMessage`

## Reverted as harmful

`ed774a2954` added a `markdown_inline` entry to parsers-config. It was
unnecessary — the default was already registered — and it REPLACED a bundled,
offline-safe query with one fetched from GitHub at runtime. Reverted; a test now
pins that it must not come back.

## Architectural defects found on the way (not fixed)

1. **103 MB of compiled grammars are embedded; 72 KB of `.scm` queries are
   downloaded at runtime** from raw.githubusercontent and cached. First use of a
   language without network = no highlighting. 13 registered languages have no
   cached query yet, `zig` among them.
2. That cache lives in `~/.local/share/opentui/`, outside the portable
   `{worktree}/.opencode/data` scheme AGENTS.md requires.

Fix: fetch the queries at build time, embed them like the grammars, point the
config at local keys, keep the URLs only as the update source.

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
