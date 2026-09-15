# GLM-5.3-Flash streaming read-back

- model: z-ai/glm-5.3-flash, pinned to "z-ai", allow_fallbacks=false
- max_tokens: 8000, hard timeout: 420s, streaming: yes
- map: 132 files, 260663 chars
biggest file : `message-v2.ts` (174 symbols)
smallest file: `index.ts` (2 symbols)

## Q1 - first 25 symbols of `message-v2.ts` (page 1)

  … 4s: reasoning 3 chars, content 0 chars
  … 20s: reasoning 2772 chars, content 0 chars
  … 36s: reasoning 5737 chars, content 0 chars
  … 51s: reasoning 8488 chars, content 0 chars
  … 67s: reasoning 11067 chars, content 0 chars
  … 83s: reasoning 13920 chars, content 0 chars
  … 100s: reasoning 16869 chars, content 0 chars
  … 115s: reasoning 19887 chars, content 0 chars
  … 131s: reasoning 22526 chars, content 0 chars
  … 146s: reasoning 25298 chars, content 0 chars
  … 162s: reasoning 28338 chars, content 0 chars
  … 177s: reasoning 30583 chars, content 0 chars

**Q1: 0/25 (0%) | finish=length | prompt=2132 completion=8000 | 188s**

```
(empty)
```

truth (first 25):
```
message-v2.ts 1
@/bus/bus-event 1
./schema 2
../project/schema 3
zod 4
@opencode-ai/core/util/error 5
@opencode-ai/core/util/log 6
ai 7
@/lsp/lsp 8
@/snapshot 9
../sync 10
@/storage/db 11
@/storage/storage 12
drizzle-orm 13
drizzle-orm 14
drizzle-orm 15
drizzle-orm 16
drizzle-orm 17
drizzle-orm 18
drizzle-orm 19
drizzle-orm 20
./session.sql 21
@/provider/error 22
@/attachment/registry 23
@/attachment/kind 24
```

## Q2 - all symbols of `index.ts` (pages 1-4 in context)

  … 4s: reasoning 3 chars, content 0 chars
  … 21s: reasoning 2838 chars, content 0 chars
  … 37s: reasoning 5811 chars, content 0 chars
  … 53s: reasoning 9122 chars, content 0 chars
  … 69s: reasoning 12136 chars, content 0 chars
  … 84s: reasoning 15062 chars, content 0 chars
  … 99s: reasoning 17758 chars, content 0 chars
  … 116s: reasoning 21119 chars, content 0 chars
  … 132s: reasoning 24491 chars, content 0 chars

**Q2: 0/2 (0%) | finish=length | prompt=8334 completion=8000 | 147s**

```
(empty)
```

truth:
```
index.ts 1
/session/composer 1
```

## Q3 - exact line of `ToolStateRunning` in `message-v2.ts`

  … 3s: reasoning 3 chars, content 0 chars
  … 20s: reasoning 3156 chars, content 0 chars
  … 36s: reasoning 6082 chars, content 0 chars
  … 51s: reasoning 9592 chars, content 0 chars
  … 66s: reasoning 13185 chars, content 0 chars
  … 81s: reasoning 16272 chars, content 0 chars
  … 97s: reasoning 19498 chars, content 0 chars
  … 112s: reasoning 23052 chars, content 0 chars
  … 127s: reasoning 27092 chars, content 0 chars

**Q3: truth 327, answered "", WRONG | finish=length | 136s**


## Summary

| question | scope | correct | of | pct | finish | prompt tok | completion tok |
|---|---|---:|---:|---:|---|---:|---:|
| Q1 first 25 of message-v2.ts | page 1 | 0 | 25 | 0% | length | 2132 | 8000 |
| Q2 all of index.ts | pages 1-4 | 0 | 2 | 0% | length | 8334 | 8000 |
| Q3 exact line ToolStateRunning | page 1 | 0 | 1 | 0% | length | 2114 | 8000 |
