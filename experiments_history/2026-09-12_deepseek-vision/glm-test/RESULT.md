model:        z-ai/glm-5.3-flash
provider pin: only=["z-ai"], allow_fallbacks=false

## Step 1 - smoke
- status 200, provider Z.AI, tokens 142
- answer: GLM-VISION-OK
- reads images through the pinned endpoint: **true**

## Step 2 - symbol map
- map: 132 files, 260663 chars, ~78277 tokens as text
- rendered 20 pages, 990950 B, 19260 tokens as images
- ratio: 4.06x

target file: `index.ts` (2 symbols, on page 1)

| arm | images | tokens | provider | symbols named | of 2 |
|---|---:|---:|---|---:|---:|
| A page1 only | 1 | 2124 | Z.AI | 0 | 0% |
| B pages 1-4 | 4 | 8340 | Z.AI | 0 | 0% |
| C all pages | 20 | 41492 | Z.AI | 0 | 0% |

### truth
```
index.ts 1
/session/composer 1
```

## Raw answers

### A page1 only

```

```

### B pages 1-4

```

```

### C all pages

```

```

