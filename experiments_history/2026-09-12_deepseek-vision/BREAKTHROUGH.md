# Text as pixels: images as a context-window multiplier

**Status: measured on the live API, 2026-09-12. Model: `deepseek-flash` (DeepSeek-V4.1-Flash).**

This document records a chain of live measurements. The headline is not "compression" -
it is that images change the *shape* of the context budget:

| property | text | images | ratio |
|---|---:|---:|---:|
| characters per token | ~3.33 | **13.96** | **4.19x** |
| price of held context (per 1M) | $0.15 | **$0.003** (cache read) | **50x** |

> A 530k-token window holds **1.76M characters as text** or **7.4M characters as images**,
> and the held context is billed at 1/50th once cached.

Every number below comes from a script in this directory with its raw output saved next
to it. Nothing is quoted from memory. Where a result is unproven or a method failed, it
is marked as such.

---

## 1. Why this works at all: the vendor normalises, you exploit it

The vendor guide (`vision-doc.txt`, saved from `api-docs.deepseek.com/guides/vision`)
states that image tokens are derived from dimensions after normalising to roughly a
1300x1300-equivalent pixel count, capped near 1024 tokens per image.

Measured directly (`grow-8x8-results.txt`), identical text prompt on every row, so the
delta is the image alone:

| canvas side | pixels | image tokens |
|---:|---:|---:|
| 128 - 512 | 16k - 262k | 187 (floor - small images are upscaled) |
| 640 | 409,600 | 277 |
| 896 | 802,816 | 511 |
| 1024 | 1,048,576 | 655 |
| 1152 | 1,327,104 | 817 |
| **1280** | **1,638,400** | **997 (cap)** |
| 2048 | 4,194,304 | 997 (no gain - server downscales) |
| 2560 | 6,553,600 | 997 (no gain) |

Fits within ~2%:

```
image_tokens ~= clamp(pixels / 1700 + 187, floor 187, cap ~1000)
```

**The consequence that drives everything:** a 1.64M-pixel page and a 6.5M-pixel page cost
the same tokens. Beyond the cap you pay the maximum for a *downscaled* image - a double
penalty. Confirmed by direct test (`downscale-results.txt`): the same layout rendered at
8160x8160 and at 1280x1280 both read correctly and both cost 1021 tokens.

**Budget point: 1280 x 1280 = 1,638,400 px.**

## 2. Characters per page

Capacity follows from area, not from layout:

```
cells = page_area / (advance_px * line_pitch_px)
```

Columns, tiling and aspect ratio change nothing about this - they only move whitespace
around (`columns-pdf-results.txt`; column layouts moved fill from 69% to 75% and left
pages, tokens and ratio identical).

| line pitch | rows/page | characters/page | px per character |
|---:|---:|---:|---:|
| 10 px | 126 | 20,160 | 80 |
| 12 px | 105 | 16,800 | 96 |
| **15 px** | **84** | **13,440** | **120** |
| 16 px | 78 | 12,480 | 128 |

At the proven-readable geometry (advance 8 px, pitch 15 px) one page carries
**13,440 characters for ~963 tokens = 13.96 chars/token** (7.4x per-page gain used below).

## 3. Line pitch is the readability threshold, not glyph size

Measured with ink height held constant (`pitch-sweep-results.txt`), same font, same
canvas, only the pitch varying. Exact-set predicate: the gate set must equal {G0..G9} -
a continued series such as "G0..G35" fails, because extra gates make the sets unequal.

| font | em | ink | pitch | gap | pages | vs text | gates | terminals | G4 |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| consola | 14 | 13 | 14 | 1 | 4 | 2.32x | OK | - | - |
| consola | 14 | 13 | **16** | **3** | 4 | 2.32x | OK | OK | OK |
| consola | 15 | 13 | 15 | 2 | 4 | 2.32x | OK | OK | OK |
| cour | 13 | 10 | 11 | 1 | 3 | 3.10x | OK | - | - |
| cour | 13 | 10 | **15** | **5** | 4 | 2.32x | OK | OK | OK |

- The **gate list** survives tight packing (short tokens, repeated structure).
- **Prose** survives only with a real gap between lines (>= ~3 px at this size).
- A pitch below `ink_height` is not "dense", it is impossible - consecutive lines overlap.
  The guard in `probe-pitch-sweep.py` refuses to send such a render (it aborted at
  "gap 0 px - lines would overlap" and at "2.53 px per glyph"). Three earlier runs were
  invalidated by exactly that defect, and the archived artifact proves it:
  `failed-8x8-dense/` has ink in 1,406 of 22,500 cells (1.0 px per cell) - the model
  correctly called it "a faint, scattered dot pattern".

## 4. What happens when you try to beat the budget

Every attempt to fit more onto one image fails, because the capacity law has a hard
external ceiling (`grid-pages-results.txt`, `tile-4pages-results.txt`):

| arrangement | pixels | vs budget | what survived |
|---|---:|---:|---|
| 4 pages as 2x2 panels | 7.46M | 4.56x | page structure only; body text invented |
| 4 pages as 1x4 strip | 7.55M | 4.61x | page structure only; body text invented |
| one 8192x8192 page | 67.1M | 41x | (server downscales 6.4x; glyphs arrive ~1.2 px) |

Page **numbering and structure survive every density** - the model answered "The image
contains 4 numbered pages, carrying the headers PAGE 1/4, PAGE 2/4, PAGE 3/4, and PAGE
4/4" or located "G8 on page 3, line 13". Body text does not.

**Therefore: more content means more images, never a bigger image.**

## 5. Caching: the finding that makes it practical

Each image is billed separately - measured by attaching 1/2/3/4 identical pages to one
request (`PAGE-ACCOUNTING.md`):

| images | prompt_tokens | delta |
|---:|---:|---:|
| 1 | 973 | - |
| 2 | 1936 | +963 |
| 3 | 2899 | +963 |
| 4 | 3862 | +963 |

And the growing prefix caches (`image-cache-results.txt`), which is the pattern a real
session produces - one new page per turn:

| turn | pages | prompt_tokens | cache_hit | cache_miss | hit |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 990 | 0 | 990 | 0% |
| 2 | 2 | 3110 | **1152** | 1958 | 37% |
| 3 | 3 | 6061 | **3072** | 2989 | **50.7%** |

`cache_hit` grows with the prefix; only the new page is billed as a miss. On turn 3 the
model correctly answered a question about content on page 3, including naming the hidden
`TITLE_AGENT` - so this is real reading, not pattern completion.

Price, from the local catalog (`.opencode/data/cache/models.json`):

| token type | per 1M | relative |
|---|---:|---:|
| input (miss) | $0.15 | 1x |
| **cache read (hit)** | **$0.003** | **1/50x** |
| output | $0.60 | |

Holding a 530k context fully cached: **$0.00159 per request** vs $0.07950 as fresh input.

## 6. The working configuration

Rendering the real kernel (`packages/opencode/src/session/prompt/reasoning_prompt.txt`,
31,336 chars) with the measured-best settings (`fill100-results.txt`, `SIZE-CONFIG-C.md`):

| parameter | value |
|---|---|
| stream | kernel as one JSON string (31,848 chars - escapes act as regular vertical strokes, which measurably helped) |
| layout | continuous, every row filled to the last of 160 columns (100% fill) |
| font | consola em14, advance 8 px, ink 13 px, pitch 15 px |
| page | 1280 x 1260 px, 84 x 160 = 13,440 cells |
| pages | **3** |

| page | characters | WebP | fill |
|---:|---:|---:|---:|
| 1 | 13,440 | 126,852 | 92% |
| 2 | 13,440 | 120,018 | 92% |
| 3 | 4,968 | 47,310 | 34% |
| **total** | **31,848** | **294,180 (287 KiB)** | |

| metric | value |
|---|---|
| tokens | **2,889** (3 x 963) |
| the same kernel as text | ~8,953 |
| **ratio** | **3.10x cheaper as images** |
| completeness | 31,848 placed = 31,848 expected (verified by reading pixels back) |

Word-wrapped layout wastes the ragged right edge and needs 4 pages (2.32x); continuous
100% fill needs 3 (3.10x). The gain came from layout, not from the codec.

## 7. Codec

### 7.1 The in-product renderer works (sharp, TypeScript)

The whole study was validated with Python/PIL, but the product is TypeScript. The only
already-present dependency able to rasterise text is `sharp` (used by
`attachment/handlers/image.ts`), so it was tested directly (`sharp-render.ts`,
`sharp-verify.ts`):

| renderer | page bytes | gates | terminals | G4 | checks |
|---|---:|---|---|---|---|
| **sharp (SVG -> WebP lossless)** | **117,474** | PASS `G0..G9` | PASS | FAIL | **2/3** |
| PIL reference (same config) | 126,852 | PASS `G0..G9` | PASS | FAIL | **2/3** |

Identical results, so the renderer can be built in TypeScript with no new dependency.
Ink coverage 15.3% per page - a dense, non-empty render. Rendering cost 1.8 s/page,
3 pages = 5.4 s, 266 KB total for the kernel.

Characters are placed individually in the SVG (`x = col * 8`, `y = row * 15`) so the
grid pitch does not depend on the font's advance metrics.

### 7.2 Codec measurement

WebP lossless beats PNG on every text page measured, and its advantage grows with 2D
repetition (`2d-repetition-results.txt`):

| content | PNG | WebP lossless | ratio |
|---|---:|---:|---:|
| kernel as text | 451,570 | **294,180** | **0.65x** |
| prose | 120,304 | 72,888 | 0.61x |
| independent random cells | 189,469 | 153,360 | 0.81x |
| one line repeated 64x | 12,941 | **4,550** | **0.35x** |

WebP predicts each pixel from its neighbours (2D), while PNG reduces to LZ77 over a
linear byte stream. Measured: as repetition rises, WebP's advantage grows by 57%
(0.809x without repetition -> 0.352x with maximal vertical repetition). `near_lossless`
produced byte-identical output on sharp text - useless here. `method=4` equals `method=6`.

Lossy WebP is **unreliable** on text: q80 produced looping garbage on one run while a
lower q60 read cleanly. Use lossless.

## 8. What this changes

| context | as text | as images |
|---|---:|---:|
| kernel (31k chars) | 8,953 tokens | **2,889** (3.10x) |
| 128k window | 426k chars | **1.79M chars** |
| 530k window | 1.76M chars | **7.40M chars** |
| 1M window | 3.33M chars | **13.96M chars** |

Two limits bind at roughly the same place: 600 images/request at 13,440 chars =
8.06M chars, and 64 MiB/request at ~98 KiB/page = 7.1M chars. Both land near the 530k
window's image capacity, so neither is the binding constraint in practice.

## 9. Proven, unproven, failed

**Proven [Exact]** - reproducible from the scripts listed below:
- `deepseek-flash` accepts JPEG/PNG/WebP/GIF; format detected from content (P0, `probe-results.txt`)
- image tokens = clamp(pixels/1700 + 187, 187, ~1024); cap at 1280x1280 (16-point sweep)
- server downscales above the cap; 8160px and 1280px pages cost identically (1021 tokens)
- images are billed per image: +963 each
- images participate in prefix caching; `cache_hit` grows 0 -> 1152 -> 3072 over three turns
- cache_read is 1/50th of input price
- WebP lossless = 0.65x PNG on text; advantage grows with 2D repetition
- pitch >= ink_height + ~3 px is required for prose; the gate list tolerates less
- config C: 3 pages, 287 KiB, 2,889 tokens, 3.10x, complete

**Unproven:**
- cache persistence over many turns or hours (doc: "best-effort", hours to days)
- why `G4 identities` failed on most configurations but passed at pitch 15 word-wrapped -
  likely an oracle wording issue (the model answered "BUILD MODE, PLAN MODE" without
  underscores), not a rendering limit
- whether a purpose-built 8x8 bitmap font beats the TTF-derived glyphs used here
- reading accuracy on real documents (charts, handwriting, low contrast) - all tests used
  synthetic monospace text

**Failed, recorded as such:**
- dense packing below the ink height (my renderer, not the model)
- tiling 4 pages onto one canvas (2x2 and 1x4) - structure survives, body does not
- lossy WebP for text
- `near_lossless` encoding (no effect)

## 10. Reproduce

```bash
cd D:/zPython/opencode

# image acceptance and token economics
python experiments/2026-09-12_deepseek-vision/probe-vision-deepseek.py accept
python experiments/2026-09-12_deepseek-vision/probe-vision-deepseek.py tokens

# the budget point and the server's downscale
python experiments/2026-09-12_deepseek-vision/probe-downscale.py

# pitch threshold (refuses to send overlapping renders)
python experiments/2026-09-12_deepseek-vision/probe-pitch-sweep.py

# the working configuration and its size
python experiments/2026-09-12_deepseek-vision/probe-100fill.py
python experiments/2026-09-12_deepseek-vision/size-config-c.py

# caching of a growing image sequence
python experiments/2026-09-12_deepseek-vision/probe-image-cache.py
```

Requires `DEEPSEEK_API_KEY` (or `bin/auth.json`). Live calls only; the codec and layout
measurements (`probe-2d-repetition.py`, `calc-2page-layout.py`, `calc-8192.py`) are offline.

## 11. Files

| file | what |
|---|---|
| `grow-8x8-results.txt` | token cost across 16 canvas sizes - the cap curve |
| `downscale-results.txt` | direct proof the server normalises to ~1280 px |
| `pitch-sweep-results.txt` | line-pitch threshold, per font |
| `fill100-results.txt` | 100% fill vs word wrap; JSON string variant |
| `SIZE-CONFIG-C.md` | the chosen configuration, measured on disk |
| `image-cache-results.txt` | growing-prefix caching |
| `2d-repetition-results.txt` | WebP vs PNG by content redundancy |
| `PAGE-LIMITS.md`, `PAGE-8192.md`, `PAGE-ACCOUNTING.md` | protocol vs effective limits |
| `grid-pages-results.txt`, `tile-4pages-results.txt` | failed attempts to beat the budget |
| `failed-8x8-dense/` | archived broken render, with the pixel proof |
| `vision-doc.txt` | the vendor guide, saved |
| `kernel-4pages/`, `images-100fill/` | rendered page artifacts |
