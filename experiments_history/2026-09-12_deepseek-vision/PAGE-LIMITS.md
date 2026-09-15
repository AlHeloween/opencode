# Page size: hard limit vs what we use

## A) Protocol limits (vendor guide, `vision-doc.txt`)

| limit | value |
|---|---|
| max dimension | **8192 px per side** (drops to 4096 px when a request carries >=15 images) |
| request body | 48 MiB |
| single image, base64 / URL | 32 MiB |
| single image, Files API `file_id` | 64 MiB |
| images per request | 600 |
| total per request | 64 MiB (200 MiB with `file_id`) |
| placement | `user` messages only; `system`/`assistant` returns 400 |

So the protocol would accept a page far larger than anything useful. The binding
constraint is not the protocol - it is (B).

## B) Effective limit (measured)

Identical question, growing square canvas, image cost isolated:

| canvas side | pixels | image tokens | note |
|---:|---:|---:|---|
| 128 | 16,384 | 187 |  |
| 192 | 36,864 | 187 |  |
| 256 | 65,536 | 187 |  |
| 384 | 147,456 | 187 |  |
| 512 | 262,144 | 187 | floor (upscaled to ~544x544) |
| 640 | 409,600 | 277 |  |
| 768 | 589,824 | 385 |  |
| 896 | 802,816 | 511 |  |
| 1024 | 1,048,576 | 655 |  |
| 1152 | 1,327,104 | 817 |  |
| 1280 | 1,638,400 | 997 | **cap reached** |
| 1408 | 1,982,464 | 997 | no gain - server downscales |
| 1536 | 2,359,296 | 997 | no gain - server downscales |
| 1792 | 3,211,264 | 997 | no gain - server downscales |
| 2048 | 4,194,304 | 997 | no gain - server downscales |
| 2560 | 6,553,600 | 997 | no gain - server downscales |

Image tokens are clamped to ~1024. The cap is reached at **1280x1280 = 1,638,400 px**;
beyond it tokens stay flat while the server shrinks the image - you pay the maximum
and lose sharpness. That is the double penalty measured in the 2048x2048 and 2560x2560 rows.

Model fits the measurements within ~2%:

```
image_tokens ~= clamp(pixels / 1700 + 187, floor 187, cap ~1000)
```

## What we send

| parameter | value |
|---|---|
| page width | **1280 px** (160 columns x 8 px advance) |
| page height | ~1260 px (rows x pitch, rounding to whole rows) |
| page area | **~1.61M px** |
| share of the cap point | 98% |
| image tokens | ~1032 (the maximum, and no waste) |
| share of the 8192 px side limit | 16% width, 15% height |

The page is deliberately pinned just **under** the cap point: below it the server may
scale slightly up (harmless), above it the server scales down (destroys glyph strokes).

## Capacity at that area

`cells = area / (advance x pitch)`, independent of column count:

| line pitch | rows/page | cells/page | chars |
|---:|---:|---:|---|
| 10 px | 126 | 20,160 | 20,160 |
| 11 px | 115 | 18,400 | 18,400 |
| 12 px | 105 | 16,800 | 16,800 |
| 15 px | 84 | 13,440 | 13,440 |

## Two-number summary

- **Maximum allowed**: 8192 px per side (protocol), but anything above ~1.64M px is
  pointless because tokens cap at 1024 and the server downscales.
- **What we use**: 1280 x ~1260 px = ~1.61M px - the largest page that still gets full
  per-pixel fidelity at the fixed 1024-token price.
