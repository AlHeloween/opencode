## 1. Empty content: finish_reason diagnosis

- max_tokens=256: status=200 finish=length prompt=2108 completion=256 content=0 chars reasoning=1023 chars
- max_tokens=1024: status=200 finish=stop prompt=2108 completion=507 content=86 chars reasoning=1957 chars
  text: index.ts | session-context-breakdown.test.ts | session-context-breakdown.ts | user | assistant
- max_tokens=4096: status=200 finish=stop prompt=2108 completion=497 content=225 chars reasoning=1701 chars
  text: Here are the first five symbol names I can read from the top of the symbol map: |  | 1. index.ts | 2. session-context-breakdown-test.ts | 3. session-context-breakdown.t

### with reasoning disabled
- status=400 finish=? prompt=undefined completion=undefined content=0
  error: {"error":{"message":"Reasoning is mandatory for this endpoint and cannot be disabled.","code":400,"metadata":{"provider_name":null}}}

## 2. Image token scaling: does the vendor cap the price per image?

The same rendered page is resized so the *content* is identical and only the pixel count
changes. On DeepSeek tokens stop growing at ~1.64M px because the server normalises to a
fixed budget; if GLM keeps charging, the economics are vendor-specific.

| canvas | pixels | png/webp bytes | prompt_tokens | vs 1280 |
|---:|---:|---:|---:|---:|
| 640 | 403200 | 34118 | 550 | 1.00x |
| 896 | 790272 | 96142 | 1045 | 1.90x |
| 1280 | 1612800 | 61056 | 2091 | 3.80x |
| 1536 | 2322432 | 159726 | 2991 | 5.44x |
| 1792 | 3161088 | 206328 | 4053 | 7.37x |
| 2048 | 4128768 | 257156 | 5349 | 9.73x |

## 3. Several pages at once: is the cost per image or per request?

| images | prompt_tokens | delta |
|---:|---:|---:|
| 1 | 2091 | - |
| 2 | 4163 | 2072 |
| 3 | 6235 | 2072 |
| 4 | 8307 | 2072 |
