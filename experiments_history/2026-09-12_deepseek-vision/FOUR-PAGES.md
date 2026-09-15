# Does the kernel fit in 4 pages of 1280x1260?

page 1280x1260 px | cell adv=8 pitch=15 | 160 cols x 84 rows = 13,440 cells/page
font consola.ttf em=14

## blank lines KEPT

- reflowed rows: **346**
- characters to place: 30,760
- rows per page: 84 -> pages needed: **5**
- capacity at 4 pages: 53,760 cells
- fill if placed on 4 pages: 57%
- verdict: DOES NOT fit - needs 5

## blank lines DROPPED

- reflowed rows: **277**
- characters to place: 30,760
- rows per page: 84 -> pages needed: **4**
- capacity at 4 pages: 53,760 cells
- fill if placed on 4 pages: 57%
- verdict: FITS in 4

## Render + pixel verification (blank lines dropped)

| page | rows used | chars placed | cells | fill | webp bytes |
|---:|---:|---:|---:|---:|---:|
| 1 | 84 | 10,882 | 13,440 | 74% | 103,256 |
| 2 | 84 | 8,768 | 13,440 | 60% | 84,800 |
| 3 | 84 | 9,538 | 13,440 | 65% | 89,056 |
| 4 | 25 | 1,572 | 13,440 | 11% | 16,342 |

- characters placed: **30,760**
- characters expected: 30,760
- completeness: ALL PLACED
- pages used: 4 (limit checked: 4)

## Weight and cost

| property | value |
|---|---|
| 4 pages, total WebP | **293,454 bytes** (287 KiB) |
| per page | 73,364 bytes |
| tokens | **4,096** (each image billed separately: measured +963/image) |
| same text as tokens | ~8,953 |
| saving | **2.19x** |

