# Page sizes: the numbers actually used

Read back from the recorded result files:

- `kernel-weight.txt`: page: 1280x1260 px (1.61M px, within the 1.62M budget)
- `columns-pdf-results.txt`: (missing: columns-pdf-results.txt)
- `webp-results.txt`: page: 1280x1260 (1.61M px) rows=84 capacity=13440 drawn=10045 ink=185086 px (18.43 px/glyph)
- `grid-pages-results.txt`: model=deepseek-flash canvas=1280x1280 (at the 1,638,400 px budget point, no server rescale)

## The page we settled on

| property | value |
|---|---|
| size | **1280 x 1260 px** |
| area | **1,612,800 px** |
| budget point (tokens stop growing) | 1,638,400 px |
| share of budget | 98% |
| cell | adv 8 px x pitch 15 px = 120 px/char |
| capacity | **13,440 characters** |
| tokens | ~1024 (the cap) |

## Live test: is the budget per image or per request?

test page: 1280x1260 px, 6038 bytes as WebP-lossless, capacity 13,440 chars

| images attached | prompt_tokens | delta per image |
|---:|---:|---:|
| 1 | 973 |  |
| 2 | 1936 | 963 |
| 3 | 2899 | 963 |
| 4 | 3862 | 963 |

### interpretation

Both models fit: cost ~= 973 (fixed prompt) + 963 x images.
So **each image is billed separately** - the budget is PER IMAGE, not shared.

## What that means for the layout question

| arrangement | pixel budget | capacity | tokens |
|---|---:|---:|---:|
| 1 image, 4 panels on it | 1,612,800 px TOTAL | 13,440 chars (shared) -> 3,360 per panel | ~1024 |
| 4 separate images | 6,451,200 px TOTAL | 53,760 chars | ~4096 |

The kernel is 31,336 characters.

- as 4 panels on ONE image: each panel would hold 3,360 chars, so 4 panels = 13,440 chars at 4x too dense to read (measured: unreadable)
- as 4 SEPARATE images: 53,760 chars of capacity for ~4096 tokens - this is
  the arrangement that was measured working, and it is what 'four pages' meant

