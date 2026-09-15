# Configuration C - what it weighs

| parameter | value |
|---|---|
| stream | kernel as one JSON string |
| characters (raw kernel) | 31,336 |
| characters (JSON string, escapes included) | **31,848** |
| layout | continuous, every row filled to 160 cols |
| font | consola em14 - advance 8 px, ink 13 px, line pitch 15 px |
| page | 1280 x 1260 px = 1,612,800 px |
| cells per page | 160 x 84 = 13,440 |

## Actual files on disk

| page | characters | WebP | PNG (for comparison) | B/char | fill |
|---:|---:|---:|---:|---:|---:|
| 1 | 13,440 | 126,852 | 187,443 | 9.44 | 92% |
| 2 | 13,440 | 120,018 | 191,189 | 8.93 | 92% |
| 3 | 4,968 | 47,310 | 72,938 | 9.52 | 34% |
| **total** | **31,848** | **294,180** | **451,570** | **9.24** | |

## Cost

| metric | value |
|---|---|
| pages | 3 |
| WebP total | **294,180 bytes (287 KiB)** |
| PNG total (same pages) | 451,570 bytes (441 KiB) |
| WebP vs PNG | **0.65x** |
| per page (average) | 98,060 bytes |
| bytes per character | 9.24 |
| share of the 48 MiB request body | **0.584%** |

## Tokens

| metric | value |
|---|---|
| images | 3 |
| tokens (measured 963/image) | **2,889** |
| the same kernel as text | ~8,953 |
| ratio | **3.10x cheaper as images** |

## Completeness check

- characters placed across pages: **31,848**
- JSON stream length: 31,848
- ALL PLACED
