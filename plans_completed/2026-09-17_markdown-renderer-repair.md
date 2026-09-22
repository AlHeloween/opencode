<!-- intention: markdown renderer mis-renders links and ignores option changes, with 7 red tests nobody runs -> the seven tests pass against fixed code, with our local features and the graphics output path intact -->

# Markdown renderer repair — 7 red tests, fixes available upstream

```yaml
status: diagnosed, safety boundary established, implementation not started
raised: 2026-09-17 (Alexander: "У нас серьезные проблемы с markdown rendering")
scope: packages/opentui/packages/core/src/renderables/Markdown.ts
parts_source: external/opentui-0.5.11/packages/core/src/renderables/Markdown.ts
```

## Smoke Tests

- Baseline [Exact]: `cd packages/opentui/packages/core && bun test src/renderables/__tests__/Markdown.test.ts`
  → **7 fail**. Plus `Code`/`CodeRenderable` 7 in the adjacent suites.
- Post-fix oracle: the same command green, **snapshots unchanged**.
- Non-regression, mandatory: `bun test src/tests/image-renderable.test.ts
  src/tests/renderer.image-protocol.test.ts src/tests/renderer.kitty-flags.test.ts`
  → must stay 27 pass / 0 fail.

## THE TEMPTING WRONG MOVE — do not

`bun test --update-snapshots` turns all seven green in a second and records the
defect as the contract. The recorded values are **correct**, and that is not a
judgement call: upstream 0.5.11 asserts the identical expected values —
`Check out this link(https://example.com` and `# Heading 1` / `## Heading 2`.
Same contract, independently. **The code is wrong, the snapshots are right.**

## The seven, in two families

**A — an option change does not take effect** (4)

| Test | Symptom |
|---|---|
| `headings with conceal=false show markers` | `conceal=false` ignored, `#` stripped anyway |
| `conceal change updates rendered content` | changing conceal does not re-render |
| `block type change creates new renderable` | renderable reuse/recreate broken |
| `theme switching (syntaxStyle change)` | theme change does not propagate |

**B — incomplete / inline constructs mis-parse** (3)

| Test | Symptom |
|---|---|
| `incomplete link (no closing paren)` | raw brackets **and** a duplicated URL |
| `default block mode still coalesces ordinary markdown blocks` | 2 renderables where 1 expected — blocks split |
| `custom renderNode returning null uses default` | a line vanishes from output |

Family B is the one that bites during streaming: every link and every block
passes through an incomplete state on the way in.

## Root cause found so far

**`addMarkdownLinkHighlights` does not exist in our copy at all.** The whole
link-highlight post-processing pass is upstream-only (`Markdown.ts:734-789`
there) — no `bracketConceals`, no `normalizeMarkdownLinkTarget`, no
`string.special.url` branch. Upstream has two `_conceal` consumption sites we
lack, the decisive one being

```ts
if (!this._conceal || content[destinationStart - 1] !== "(" || content[destinationStart - 2] !== "]") continue
```

i.e. conceal of a link *destination*, keyed on the `](` that precedes it.

### The interaction risk — read before porting

The duplicated URL is **not** simply a missing conceal. It is our local
`detectLinks` feature rendering the URL it found, while the raw markdown stays
visible because the upstream conceal pass is absent. Port the pass naively and
either our linkifier double-renders, or its output gets concealed away. The two
must be reconciled deliberately, and `incomplete link` is the oracle for it.

## Safety boundary — measured, not assumed

Mermaid and the graphics output path **cannot** be affected by changes confined
to `Markdown.ts`:

| Evidence | Meaning |
|---|---|
| `routes/session/index.tsx:2120` — `<Match when={segment().type === "mermaid"}><MediaMermaid/>` | mermaid segments are routed away *above* the renderer and never reach `<markdown>` |
| our `Markdown.ts` contains no `sixel`/`kitty`/`graphics`/`PixelBuffer` reference | the output port lives in `renderer.ts` / `Image.ts`, not here |
| `markdown-parser.ts` is byte-identical to upstream (0 hunks) | the parser is not the divergence and must not be touched |

Do not touch: `Image.ts`, `renderer.ts` raster/sixel paths, the `media-*`
components in opencode.

## PRESERVE — ours-only, a wholesale copy deletes these

54 lines exist only in our copy. Real local features among them:

| Ours | Why it matters |
|---|---|
| `codeWrapMode?: "none" \| "char" \| "word"`, default `"none"` | comment is explicit: *"code must not reflow"* |
| `detectLinks` + `_linkifyMarkdownChunks` (`../lib/detect-links.js`) | bare URLs become clickable |
| `CodeRenderable` / `OnChunksCallback` import | our own Code renderable integration |

Upstream has 231 lines we lack; ours has 54 they lack; 48 hunks total. **Take
named hunks for named tests. Never copy the file.**

## Measured 2026-09-18 — the blocking conflict

**`shouldRenderSeparately` is the crux, and our version of it is load-bearing.**

```diff
-  ... || token.type === "hr" || token.type === "heading" || token.type === "list"   // ours
+  ... || token.type === "hr"                                                        // upstream
```

Ours was set deliberately by `3b07819193` (2026-07-15), which *changed* it from
the upstream form. No rationale was recorded — that commit is a one-line subject
bundling six unrelated items, and it is the same commit that introduced the
audio FFI stubs now known to make 72 tests assert nothing. So the patch is an
expedient of unknown intent, but it is **not** inert.

Experiment: removed it, ran the full 5149-test suite.

| | Result |
|---|---|
| Total | 88 → **94** failures |
| Fixed (3) | `headings with conceal=false show markers`, `default block mode still coalesces ordinary markdown blocks`, `block type change creates new renderable` |
| Broken (9) | `headings h1 through h3`, four × `headings and … keep exactly one separator row`, `complex markdown document`, `trailing blank lines do not add spacing`, `streaming-like content with partial code block`, `no tables returns original content` |

So the local patch buys **correct heading separator rows** and pays with
**conceal and block coalescing**. Upstream has both, therefore upstream gets its
spacing from somewhere else. Reverted; the patch stays until that somewhere is
found.

### Ruled out as the difference — all byte-identical to upstream

- `getInterBlockMargin` and `applyInterBlockMargin`
- tree-sitter assets: `markdown/highlights.scm`, `markdown/injections.scm`,
  `markdown_inline/highlights.scm` (`diff -q` same, both contain `markup.link.url`)
- `Code.ts` conceal handling (21 hunks between the copies, none touching conceal)

### CORRECTED 2026-09-18 — the patch only flips which value conceal is stuck at

My reading of the nine broken tests as "spacing" was wrong. Ran
`headings h1 through h3` (byte-identical to upstream's copy) with the patch
removed and read the diff: it fails on **markers**, not separator rows.

| Configuration | Heading path | Behaviour |
|---|---|---|
| with our patch | structured | conceal effectively always **ON** |
| without it (upstream form) | markdown `CodeRenderable` | conceal effectively always **OFF** |

`conceal` is honoured in **neither**. The patch does not fix or break anything —
it chooses which constant the flag is stuck at, and each choice satisfies one
set of tests and fails the other. That is why 3 fix and 9 break: it is one
defect seen from two sides, not a trade-off between two features.

### Also ruled out, byte-identical to upstream

- the coalesced block assembly region (`markdownRaw` accumulation) — `diff` of
  ours `1165-1215` against upstream `1242-1292` returns **identical**
- `internalBlockMode` and its `"coalesced"` default
- `markdown/highlights.scm` — and it *does* conceal the markers
  (`(atx_h1_marker) @conceal` + `(#set! conceal "")`), so the query is not the gap
- the nine "broken" tests all exist upstream, and `headings h1 through h3` is
  byte-identical to theirs, so our tests were not tuned to the patch either

### Where it actually lives

The conceal predicate is applied by the **tree-sitter pipeline**, and that is
where our copy diverges — 8 files differ from 0.5.11:

| File | Ours | Upstream | Hunks |
|---|---|---|---|
| `client.ts` | 847 | 858 | 5 |
| `parser.worker.ts` | 1098 | 1101 | 6 |
| `types.ts` | 132 | 132 | 2 |
| `default-parsers.ts` | 133 | 103 | 1 |
| `parsers-config.ts` | 81 | 81 | 1 |

### 2026-09-18, second pass — the conceal data is correct all the way down

Probed the actual values rather than comparing more files. With our patch
removed, so headings take the `CodeRenderable` path:

```
PROBE/hl   conceal:true
           ["# Heading 1\n", "markup.heading.1", null]
           ["#",             "conceal",          ""]      ← correct
           ["Heading 1",     "spell",            null]
PROBE/styled  {"concealEnabled": true, "enabled": true}   ← correct
```

So: the query emits the conceal capture, the worker turns `#set! conceal ""`
into `meta.conceal`, the highlight reaches `onHighlight` intact, and
`concealEnabled` is true at styling time. The consumer logic is right too — in
`tree-sitter-styled-text.ts`, `meta.conceal === ""` makes `replacementText`
falsy, so the segment is simply not pushed, which IS concealment.

**Every input to concealment is correct, and the output still shows `#`.**

### Everything now ruled out by measurement

| Candidate | Verdict |
|---|---|
| `markdown/highlights.scm` and the other two assets | byte-identical; do conceal the markers |
| conceal predicate extraction (`parser.worker.ts`) | identical logic |
| `tree-sitter-styled-text.ts` | 6 hunks, all additive `ranges` tracking; conceal untouched |
| `default-parsers.ts` | restructured generated file, same markdown assets |
| `getInterBlockMargin`, block assembly, `internalBlockMode` | byte-identical |
| `Code.ts` conceal handling | no conceal-related hunks |
| the nine "spacing" tests | exist upstream, `headings h1 through h3` byte-identical to theirs |

### Next cut — the only remaining question

Which text actually reaches the buffer. Concealment happens while building
styled chunks, so if the renderable draws the **unstyled** content instead, the
markers survive regardless of everything above. The diff shows exactly that
knob differing:

```diff
-      drawUnstyledText: true,                                        // ours
+      drawUnstyledText: !this._streaming,                            // upstream
-    renderable.drawUnstyledText = this._streaming || initialStyledText !== undefined
+    renderable.drawUnstyledText = initialStyledText !== undefined
-    renderable.streaming = this._streaming
+    renderable.streaming = true
```

Trace which of styled vs unstyled text lands in the buffer for a heading, then
compare `drawUnstyledText` / `streaming` handling in `Code.ts`. That is the next
and, on current evidence, last hop.

## ROOT CAUSE — found 2026-09-18. Two stacked local workarounds.

Probed the styled output itself: for a heading, `styledTextFromHighlights`
returns `["Heading 1", "\n", "\n"]` — **the `#` is correctly concealed**. It
never reaches the screen.

`Code.ts:448` is why, and upstream has no such branch (it unconditionally does
`this.textBuffer.setStyledText(new StyledText(chunks))`):

```ts
// Preserve initialStyledText for markdown and ansi — tree-sitter's markdown
// grammar doesn't capture strong/em/codespan inline formatting, so its output
// would overwrite rich styled text with structural-only highlights.
if (!(this._initialStyledText && (filetype === "markdown" || filetype === "ansi"))) {
  this.textBuffer.setStyledText(new StyledText(chunks))
}
```

When the filetype is markdown and an `initialStyledText` exists, tree-sitter's
styled text — the one carrying the conceal — is **discarded**. What wins is the
chunk-built `initialStyledText`, which conceals inline markers (`**`, `*`,
`` ` ``) because `renderInlineToken` handles them, and knows nothing about
heading markers, which are block-level and exist only in tree-sitter's output.

### The stack, in order

1. **Workaround A** (`Code.ts:448`): tree-sitter's markdown highlights lost
   strong/em/codespan, rendering inline formatting black and white. Fix: let
   `initialStyledText` win permanently for markdown. **Cost: heading conceal.**
2. **Workaround B** (`shouldRenderSeparately` + heading/list, `3b07819193`):
   headings now showed their `#`. Fix: route headings out of the markdown
   `CodeRenderable` entirely, into the structured path, which conceals by using
   `token.text`. **Cost: `conceal=false` is ignored, and blocks stop coalescing.**

Each workaround repairs the previous one's damage and adds its own. That is why
removing B alone makes things worse — it exposes A.

### What the real fix has to do

Keep the rich inline styling **and** apply tree-sitter's conceal. Either merge
the two styled texts rather than choosing between them, or teach the chunk path
to conceal block-level markers so `initialStyledText` is complete on its own.
Once that holds, both workarounds can be removed and all seven tests should
resolve together — including `default block mode still coalesces` and
`block type change creates new renderable`, which are B's collateral.

Do not remove B before A is fixed. The 88→94 experiment already measured that.

## Method

1. Port `addMarkdownLinkHighlights`, reconciled with `detectLinks`. Oracle:
   `incomplete link (no closing paren)`.
2. Then family A one test at a time, each with its own test as the oracle.
3. Re-run the graphics trio after every step.
4. Only when green: give the package a `test:ci` so it stays green — that, and
   not the fix, is what stops the next regression. Nothing runs this package
   today, which is how 88 failures accumulated unseen.
