<!-- intention: `read --hex` prints a chained address for every byte row, but `edit` resolves text lines only, so a binary file can be addressed and not changed -> `edit` applies a hex-row address with a replacement format the owner chose, and binary detection on the write path is a declared rule rather than a guess -->

# Hex-row addresses in `edit` — the second half of «для бинарника тоже самое»

- **plan_id:** 2026-10-01_hex-address-edit
- **revision:** 1
- **state:** POSTPONED (2026-10-01) — split out of `plans_completed/2026-10-01_hash-addressed-edits.md` (box H7)
  so that plan could close; no work is in flight.
- **Lift signal:** the owner chooses the replacement format (one of the three below, or another) — that choice is
  a WRITE-PATH decision, so it is his, not a reflex.
- **smoke:** N/A until the format is chosen — then a byte read-back test: a row edited by its address, every
  other byte identical, and a stale row address refused.

```yaml
Keywords: hex-address 0.32, binary-edit 0.26, replacement-format 0.20, write-path-decision 0.14, byte-readback 0.08
Semantic dominant: A binary file already has row addresses in read; edit must be able to apply one, in a replacement format the owner chooses.
md5: 4c8e1f27a90b6d35e2f17a8c0d4b9e63
prev-md5: 00000000000000000000000000000000
parent-goal-md5: d99945d67a57440775f414e816c78773
```

## What exists (H2, H9 — read in code)

- `read` with `hex: true` prints `<offset>  <address>  <hex>  |<ascii>|`; the address is `chainHash` over the
  row's bytes as latin1, chained from byte zero, rows aligned to the FILE (`src/tool/read.ts`, `formatHexDump`).
- `edit` refuses a binary file outright (`TextCodec.decode` → `binary`, H9) — the seed address resolves in any
  file, so the guard has to be the tool's.

## The decision this plan waits for — «чем заменяем»

1. **hex text** — `newString` is what `read --hex` prints (`48 65 6c`), decoded to bytes; it matches what the
   reader sees and refuses anything that is not hex (no silent reinterpretation).
2. **latin1 text** — `newString` is the replacement bytes as characters; accepts anything, which is exactly the
   class the fuzzy cascade was removed for.
3. **base64** — unambiguous for any bytes, but `read` prints no base64, so it moves a conversion onto the caller
   that the address does not need.

Any choice also settles how `edit` RECOGNISES a binary target (a flag, or the codec's `binary` verdict) — a wrong
guess there is a write path.

## Tasks

- [ ] **X1 — the format, chosen by the owner.**
- [ ] **X2 — `edit` resolves a hex-row address and writes bytes** — red-first byte read-back test, refusal of a
      stale row address, every other byte identical.
