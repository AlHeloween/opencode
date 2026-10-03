<!-- intention: edit addresses a span by the line BEFORE it and treats fromHash==toHash as an insertion, so a natural reading silently lands one line off or duplicates -> fromHash/toHash name the span's OWN first and last lines; insertion is a separate explicit field -->

# edit: an inclusive span — the address is the lines you change

```yaml
Keywords: edit-address-contract 0.35, inclusive-span 0.25, explicit-insertAfter 0.2, silent-neighbour-landing 0.12, tool-description 0.08
Semantic dominant: The edit tool's hash address names the first and last line being changed, and insertion is its own field, so a model reading the hash beside a line can no longer land one line off or duplicate.
md5: 5c2e8a7f1d9b3046e8a2c5d7f1b9e3a6
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Why (owner, 2026-10-04)

Owner, verbatim: «Непопал в хеш - нефиг редактировать. А вообще модель ошибаться не может - само описание edit
значит кривое.» Decision on the fix: inclusive span (AskUserQuestion, 2026-10-04).

Measured the same day on the ClientSoft robots' sessions (deepseek-flash), read from a copy of
`D:\zPascal\ Projects\ClientSoft\.opencode\data\opencode.db`:

- `tests/viewer_roll/browser_shot.cjs`: `fromHash = toHash = 8b11d464` with `newString` repeating that line plus
  new ones — meant as «replace line X», resolved as «insert after X» → the line stood twice.
- `viewer/frontend/dist/index.html` fragment shader: `fromHash 189107e0 → toHash d85f4522` meant as «this one
  line», resolved as «the line after 189107e0 through d85f4522» = two lines → `vec3 c=...` was deleted, the
  shader stopped compiling.
- `RSMain.pas`, `contract.md`: the same `fromHash = toHash` insert-instead-of-replace.

Both readings were VALID addresses, so nothing was refused: a miss landed silently next door. The contract,
not the model, made the natural reading wrong (`edit.ts:149`, `edit.txt` table).

## The new contract

| You want | entry |
|---|---|
| replace lines A..B | `{ fromHash: hash(A), toHash: hash(B), newString }` |
| replace one line A | `{ fromHash: hash(A), newString }` (or `toHash` = the same hash) |
| delete lines A..B | `{ fromHash: hash(A), toHash: hash(B), newString: "" }` |
| insert after line X | `{ insertAfter: hash(X), newString }` |
| insert before line 1 / into an empty file | `{ insertAfter: "00000000", newString }` |

An entry carries `fromHash` XOR `insertAfter`; both or neither is refused naming the two forms. `00000000` as
`fromHash` is refused (it is no line). Every other refusal stays: unknown hash, inverted range, two entries on
one line, past the end.

## Tasks

- [x] T1 tests re-pinned to the new contract in `test/tool/edit-exact.test.ts` (same sides, none dropped, +4:
      two regressions from the robots' cases, seed-as-fromHash refused, both/neither refused) + `test/tool/edit.test.ts`
      helper. ✓ baseline on the OLD `resolveEdits`: 17 fail / 7 pass (the 7 = refusals that did not move).
- [x] T2 `resolveEdits` + `EditAddress` + schema annotations in `src/tool/edit.ts` (`insertAfter` field)
- [x] T3 `src/tool/edit.txt` table/examples; `src/tool/multiedit.ts`/`.txt` pointer text
- [x] T4 ✓ named tests GREEN: edit-exact 24/24, edit 19/19, multiedit 1/1, parameters 53/53 (snapshot updated:
      only the edit schema, +7/-4), acp/event-subscription 17/17; ✓ `bun typecheck` exit 0; ✓ `_build.ps1` exit 0

## Smoke Tests

- baseline: `bun test test/tool/edit-exact.test.ts` with the re-pinned tests on the OLD code → expected FAIL
  (the inclusive cases land one line off / insert)
- post-change: `bun test test/tool/edit-exact.test.ts`, `test/tool/edit.test.ts`, `test/tool/multiedit.test.ts`,
  `test/tool/parameters.test.ts` → PASS
- `[KV-CACHE RISK]` the tool description is part of the provider tool catalog: one prefix change at the next
  binary, then stable again.

## Closure

- T4 `_build.ps1` exit 0 (`.temp/build_edit_inclusive.log`); ✓ `dist/bin/opencode.exe` (05:27) carries the new
  `insertAfter` description (1 hit) and not the old «The address of the line BEFORE the span» (0 hits).
- Residual: the robots run `bin/opencode.exe`; the contract reaches them only when the owner promotes `dist/`.
