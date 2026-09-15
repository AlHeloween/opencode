# FAILED configuration: 8x8 dense packing

**Verdict: unreadable. The model reports the page as blank.**

This is the highest compression ratio measured for text-as-pixels, and it does not work.
Saved so the claim is checkable rather than remembered.

## The configuration

| parameter | value |
|---|---|
| cell width | 8 px |
| line pitch | 9 px (1 px gap) |
| ink height | 6 px |
| columns | 100 chars |
| rows drawn | 225 |
| characters on page | 22500 |
| canvas | 800 x 2025 px = 1620000 px |
| pixels per character | 72 |
| PNG size | 8975 bytes |
| tokens (image) | ~1024 (measured plateau; independent of pitch) |
| text equivalent | 22500 chars / 3.5 = ~6429 tokens |
| **compression ratio** | **6.28x** |

## What the model said (verbatim, 3 questions, same image)

Those three questions pass at ink 24 px: gate set == {G0..G9} (exactly), gate count == 10,
PLAN_MODE may not mutate.

| pitch | answer to "list every gate identifier" |
|---|---|
| 9 | "The image contains no text or gate identifiers." |
| 10 | "The image contains no text or gate identifiers. It is a blank page with a faint, scattered dot pattern." |
| 11 | "The image contains no text or gate identifiers; it is a blank, dotted background." |
| 12 | "The image contains no text or discernible content." |
| 14 | "The image contains no text or gate identifiers; it is completely blank." |
| 16 | "The image has been processed to extract the text. However, no text was found in the provided image." |

The `PLAN_MODE no mutate` question returned NO on every variant INCLUDING this one - it is a
yes/no question whose expected answer is "NO", so a blank image also "passes" it. It is
NOT evidence of reading; it is recorded here as an oracle defect.

## Control (same content, read successfully)

ink 24 px, pitch 30, 40 columns, 60 rows -> the model returned
`G0 G1 G2 G3 G4 G5 G6 G7 G8 G9`, gate set exactly {0..9}.

So the questions are answerable, the content is present, and the glyphs are correct.
The variable that decides readability is **ink height**, not line pitch: at constant ink 6 px
every pitch from 9 to 16 px failed.

## Files

| file | what |
|---|---|
| `failed-8x8-dense.png` | the failing page, exactly as sent |
| `control-24px.png` | the same document at ink 24 px, which was read correctly |
| `zoom-comparison.png` | left: failing crop at 8x; right: control crop - glyphs compared at matched apparent size |
| `RECORD.md` | this file |

## Consequence for the project

The useful window is bounded from below by ink height, not by packing efficiency:

| ink | readable? | chars/page at 8 px pitch |
|---|---|---|
| 6 px | NO (measured here) | 22500 |
| 24 px | YES (control) | ~2 000 |
| between | unmeasured | - |

Until the ink-height threshold is measured, no compression figure above 1x should be
promised: every dense configuration tested so far either fails to read or has never been
measured with the variables separated.
