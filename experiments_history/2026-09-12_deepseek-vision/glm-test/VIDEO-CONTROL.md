
- cut: 765 lines (9 frames x 85)
- video: 9 frames, 0.54 MiB, 13.5s
- reference: overflow.ts 3 frames -> 2/2 OK, batch3 9 frames -> 2/2 OK, full map 85 frames -> 0/4
- every target below was DERIVED from the cut, so it is provably inside the video

## frame 1: the line number shown for the symbol user in session-context-breakdown.test.ts

- truth: `5`  (map: session-context-breakdown.test.ts -> fn user at line 5)
- answered: `53`
- **WRONG** | prompt 24005 reasoning 819 | 15s

## frame 1: the line number shown for the symbol SessionContextBreakdownKey in session-context-breakdown.ts

- truth: `3`  (map: session-context-breakdown.ts -> ty SessionContextBreakdownKey at line 3)
- answered: `1*`
- **WRONG** | prompt 24008 reasoning 3021 | 42s

## frame 1: the line number shown for the symbol luxon in session-context-format.ts

- truth: `1`  (map: session-context-format.ts -> imp luxon at line 1)
- answered: `15`
- **WRONG** | prompt 24004 reasoning 3830 | 35s

## frame 1: the line number shown for the symbol assistant in session-context-metrics.test.ts

- truth: `5`  (map: session-context-metrics.test.ts -> fn assistant at line 5)
- answered: `30`
- **WRONG** | prompt 24005 reasoning 8061 | 137s

## frame 1: the line number shown for the symbol Provider in session-context-metrics.ts

- truth: `3`  (map: session-context-metrics.ts -> ty Provider at line 3)
- answered: `46`
- **WRONG** | prompt 24004 reasoning 4617 | 58s

## frame 1: the line number shown for the symbol BREAKDOWN_COLOR in session-context-tab.tsx

- truth: `21`  (map: session-context-tab.tsx -> c BREAKDOWN_COLOR at line 21)
- answered: `21`
- **CORRECT** | prompt 24006 reasoning 766 | 22s

## Summary

| frame | question | truth | answer | result |
|---:|---|---|---|---|
| 1 | the line number shown for the symbol user in session-context-breakdown.test.ts | 5 | 53 | MISS |
| 1 | the line number shown for the symbol SessionContextBreakdownKey in session-context-breakdown.ts | 3 | 1* | MISS |
| 1 | the line number shown for the symbol luxon in session-context-format.ts | 1 | 15 | MISS |
| 1 | the line number shown for the symbol assistant in session-context-metrics.test.ts | 5 | 30 | MISS |
| 1 | the line number shown for the symbol Provider in session-context-metrics.ts | 3 | 46 | MISS |
| 1 | the line number shown for the symbol BREAKDOWN_COLOR in session-context-tab.tsx | 21 | 21 | OK |

**1/6 correct at 9 frames**

Verdict: video reads symbol-map content; the 85-frame map exceeded what the provider samples.
