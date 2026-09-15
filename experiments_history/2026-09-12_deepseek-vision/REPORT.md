# DeepSeek vision + image economics — measured, not assumed (2026-09-12)

Model under test: **`deepseek-flash`** (DeepSeek-V4.1-Flash), live `api.deepseek.com`,
`thinking` explicit in every call. Key read from `DEEPSEEK_API_KEY` / `bin/auth.json`,
never printed.

Everything below is [Exact] from a live wire probe unless marked otherwise. Raw
result files sit next to this report; images used are archived under `images/`.

## 0. The premise this tested, and how it fared

The working premise was: *"compress the image as JPEG as hard as text stays
readable — a big compression ratio — send that for work; keep only a reference in
the pipeline."*

Two of its three parts are **right**, and one is **wrong for a reason that
matters**:

| Part of the premise | Verdict |
|---|---|
| Store a reference, don't re-inject the picture into the pipeline | **Correct, and already partly implemented** (`deliver-once`, `processor.ts:520`) |
| JPEG-compress hard to save cost | **Correct for bytes, wrong for tokens** |
| Compression is the lever that makes images cheap | **Wrong** — resolution is the lever; tokens cap at ~1024/image |

## 1. `deepseek-flash` accepts images (P0)

```
status=200  answer='VISION-OK'  prompt_tokens=197
```

Images go in as `image_url` with a `data:` URL, standard OpenAI-compatible shape.
Documented formats: JPEG, PNG, GIF, WebP — **detected from content, not filename
or declared MIME**. Images in `system`/`assistant` messages are a 400; `user` only.

## 2. Tokens track DIMENSIONS, not bytes (P1/D/C) — the central result

Vendor doc (`vision-doc.txt:64-70`): every image is resized to roughly a
1300×1300-equivalent pixel count before inference, giving **an upper bound of
~1024 tokens per image** — "a 2000×2000 image and a 5000×5000 image consume the
same number of tokens".

Measured on the wire:

| variant | bytes | prompt_tokens | image tokens | transcription exact |
|---|---:|---:|---:|---:|
| PNG 2000² (lossless) | 113 268 | 1043 | 994 | 36/36 · 100% |
| JPEG q95 2000² | **303 300** | 1043 | 994 | 36/36 · 100% |
| JPEG q75 2000² | 190 395 | 1043 | 994 | 36/36 · 100% |
| JPEG q50 2000² | 156 614 | 1043 | 994 | 36/36 · 100% |
| JPEG q30 2000² | 135 386 | 1043 | 994 | 36/36 · 100% |
| JPEG q15 2000² | 112 056 | 1043 | 994 | 36/36 · 100% |
| JPEG q05 2000² | **88 378** | 1043 | 994 | 36/36 · 100% |
| JPEG q75 1300² | 101 433 | 1043 | 994 | 36/36 · 100% |

**PNG (113 KB) and JPEG q95 (303 KB) cost exactly the same 994 image tokens.**
A 3.4× byte difference, zero token difference. Dropping q95→q05 saves **71% of
bytes and 0 tokens**.

Corollary: hard JPEG compression is a *bandwidth / request-body* optimisation
(48 MiB body limit, 32 MiB per image), **not** a token optimisation.

## 3. Where readability actually breaks: DENSITY, not compression (D)

2000×2000 canvas of 3-digit numbers, JPEG q85, varying grid size. Scoring is
positional against a known ground truth (no fuzzy match).

| grid | numbers | JPEG q85 bytes | prompt_tokens | exact |
|---:|---:|---:|---:|---:|
| 6 | 36 | 237 657 | 1043 | 36/36 · 100% |
| 10 | 100 | 314 966 | 1043 | 100/100 · 100% |
| 14 | 196 | 416 808 | 1043 | 196/196 · 100% |
| 20 | 400 | 509 244 | 1043 | 400/400 · 100% |
| **26** | **676** | 608 965 | 1043 | **676/676 · 100%** |
| 32 | 1024 | 711 571 | 1044 | **440/1024 · 43%** |

The cliff is between 676 and 1024 numbers on one 2000² canvas — i.e. between
~77 px and ~62 px per cell. **Notably it is a recognition failure, not a
token-budget failure: prompt_tokens stayed at ~1043 in both cases.**

At the readable density (grid 26), compression still does not matter:

| variant | bytes | prompt_tokens | exact |
|---|---:|---:|---:|
| PNG lossless | 216 148 | 1043 | 676/676 · 100% |
| JPEG q75 | 500 482 | 1043 | 675/676 · 99.9% |
| JPEG q30 | 297 938 | 1043 | 676/676 · 100% |
| JPEG q05 | **147 435** | 1043 | **676/676 · 100%** |
| JPEG q75 → 1000 px | 194 832 | **651** | 676/676 · 100% |
| JPEG q75 → 512 px | 73 943 | **233** | **44/676 · 6.5%** |

**Resizing to 1000 px halves the tokens (1043 → 651) with zero accuracy loss**;
resizing to 512 px destroys the text (6.5%). So the correct lever is
**downscale-to-need**, and 512 (what `detail:"low"` does) is too aggressive for
dense text.

## 4. `detail` levels (P2)

| detail | prompt_tokens (2000² JPEG q90) |
|---|---:|
| `low` (downscale to 512×512) | **201** |
| `high` / `original` / omitted | **1011** |

`low` costs ~5× less but is the same 512-px path that scored **6.5%** on dense
text. Use `low` for "what is in this picture", never for reading a document.

## 5. The 2000×2000 number canvas → sum (S) — the requested end-to-end test

676 numbers (grid 26), JPEG q75, **500 482 bytes**, `thinking: enabled`:

```
true  : count=676  sum=376296
model : COUNT: 676   SUM: 376296
sum_correct = True   delta = 0
```

**Exact.** 676 three-digit numbers read from one compressed JPEG and summed
correctly.

One operational trap found on the way: the first attempt used
`max_tokens: 4000` and returned **`reasoning_tokens: 4000` with empty content** —
thinking consumed the whole budget. At `max_tokens: 32000` the same request
answered in 15 395 completion tokens (15 384 of them reasoning). **A vision task
with thinking enabled needs a large output budget, or the answer never lands.**

## 6. Prompt cache works on images (P4)

Same image, same prefix, three identical calls:

| attempt | prompt_tokens | cache_hit | cache_miss |
|---:|---:|---:|---:|
| 1 | 1318 | 0 | 1318 |
| 2 | 1318 | **1152** | 166 |
| 3 | 1318 | **1152** | 166 |

The image block is cached like text — a repeated image is nearly free after the
first call. This supports the "keep a reference, re-read on demand" premise: the
re-read is a cache hit, not a full re-bill.

## 7. What this means for the requested design

1. **Reference-not-payload is the right call** — and the repo already does it:
   `processor.ts:520-589` (deliver-once) turns tool media into one real user
   part with a stable ID and marks the tool part `mediaDelivered`, so it is not
   re-serialized every turn. Measured cache behaviour (§6) means a deliberate
   re-read later is cheap.
2. **The `images/` archive is justified** — but for *provenance and re-read*,
   not for pipeline economy. Store the original plus the derived variant used.
3. **Do not sell hard JPEG as a token saving.** Correct framing: JPEG ≈ q30–q50
   for the *bytes* (request-body limits, transfer), and **resolution is the token
   dial** (`1043 → 651 → 233`).
4. **`detail: low` is not a safe default** for document/screenshot work: it is
   the 512-px path that scored 6.5% on dense text. Pick resolution from the task
   (e.g. ≤1000 px for dense text, `low` for scene description).
5. **Budget thinking on vision tasks** — or the answer is empty (§5).

## 8. Repo gap found while grounding (not fixed here — observation only)

`attachment/capability.ts:87-92` declares `@ai-sdk/deepseek` as
`image: "describe"`, and `deepseek-v4-pro` is `attachment: false` /
`modalities.input: ["text"]` in `.opencode/data/cache/models.json`. But the
catalog **does** declare `deepseek-flash` and `deepseek-v4-flash` as
`attachment: true`, `modalities.input: ["text","image"]` — while the npm-level
capability matrix still routes them to `describe`.

That matrix is keyed on `model.api.npm`, and since the T3 change
(`resolveNpm` → `@ai-sdk/deepseek` for the whole family), both `deepseek-flash`
and `deepseek-v4-pro` share `npm = @ai-sdk/deepseek`. So one npm key cannot
distinguish "flash takes images" from "pro does not". `getCapability()` has **no
callers** in `packages/opencode/src` (only self-exports), so nothing acts on it
today — but if it is ever wired up, it will under-report DeepSeek vision.

Not acted on: it needs its own authorization and is not part of what was asked.

## 9. Files

| file | what |
|---|---|
| `fetch_vision_doc.py` / `vision-doc.txt` | the vendor doc, saved and reduced to text (my source for the token rule) |
| `probe-vision-deepseek.py` | P0 acceptance, P1 resolution→tokens, P2 detail, P3 quality, P4 cache |
| `probe-compression-ladder.py` | first compression ladder (36 numbers; too easy — kept for provenance) |
| `probe-density-sum.py` | density ladder + compression-at-density + sum |
| `probe-sum-only.py` | standalone sum probe, budget/thinking parameterised |
| `ladder-results.txt`, `density-results.txt`, `sum-results.txt`, `probe-results.txt` | raw outputs |
| `images/` | 21 archived JPEG/PNG variants actually sent |

## 10. Caveats

- Single sample per configuration. Transcription at 100% for grids ≤26 is a clean
  result, but 43% at grid 32 is one measurement, not a curve.
- One canvas family (3-digit numbers, white background, monospace). Charts,
  handwriting, or low-contrast scans will break earlier than grid 26.
- `q05` at 100% is surprising and worth a second look before trusting it as a
  default: the model may be reading structure rather than pixels. It does not
  change the headline (bytes ≠ tokens), but do not treat q05 as "safe for any
  image".
- Token counts include prompt text; image tokens were isolated with a text-only
  baseline (49 tokens) where that mattered.
