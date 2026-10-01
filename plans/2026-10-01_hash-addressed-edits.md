<!-- intention: `read` prints a line number and nothing else, so `edit` must be told WHAT a slice says — and because a model's anchor drifts in whitespace and indentation, the tool answers with a ten-stage fuzzy cascade whose loosest step forgives half of the middle lines, silently. That one path produced three separate defects in a single day: a promise of atomicity that was never implemented, a stage that matched and said nothing, and an address mode that demanded a parameter it then discarded. -> `read` prints a CHAINED hash per line, so an address says what the FILE is rather than where a line is; ONE tool `edit` takes `edits: [...]`, resolves every entry against the original content and only then applies, and no fuzzy stage exists. A wrong hash does not land approximately — it does not land at all. -->
# Hash-addressed edits — one `edit`, a chained address, no cascade

- **plan_id:** 2026-10-01_hash-addressed-edits
- **revision:** 2
- **state:** ACTIVE
- **owner decision (2026-10-01), verbatim:** «если мы читаем пофигу что: мы можем реализовать короткий инкерементальный xxH3 хеш который будем писать на против строки, потом текст - для правки нужен хеш старта хеш конца и чем заменяем - все. 1. Read. 2. Edit. 3. Mutiedit. Никакого fuzzy search и прочей лабуды.»
- **owner decision, second round, verbatim:** «**Цепочкой чтобы четко знать что за файл** - multiedit в начале определяет куда - и только потом правит, а не исправление, потом еще исправление, потом еще. **Edit/multiedit упраздняются есть только edit** - список изменений как массив и все. Чистая работа - если неправильно вбиты хеши - не работает - правильно - работает на лету. Погоняй в начале тесты потом просто замени соответствующие тесты. И все - закрываем вопрос раз и навсегда.»

## The three decisions, and why the chained form was the one I argued against and then withdrew

I objected to a chained hash because I assumed `multiedit` applied its entries one after another: entry 1 changes lines above entry 2, the chain shifts, entry 2's address dies. **The owner's own design removes the premise** — resolve EVERY address against the ORIGINAL content first, apply afterwards — so the chain never has to survive an intermediate state. The objection was right about a naive design and wrong about this one.

And the chained form buys what a positional one cannot: the address pins **the file**, not a coordinate. `h(a)` carries the whole prefix, so ANY change above the addressed span is caught, not just a change inside it. That is «четко знать что за файл», and it is why CHAINED is now the decision rather than the fallback.

## Grounded before planning (read in the tree, not recalled)

- **The primitive exists and is already linked.** `Bun.hash.xxHash64(body, CCH_SEED)` — `src/plugin/anthropic.ts:361`; `Bun.hash(...)` — `src/session/llm.ts:104,131,162`, `src/session/message-v2.ts:1065`. **xxHash3 appears NOWHERE in `packages/opencode/src`** → the runtime has xxHash64, and for an address the difference is immaterial: use what is already there, add no dependency.
- **The seam is one line.** `src/tool/read.ts:415` — `output += file.raw.map((line, i) => \`${i + file.offset}: ${line}\`).join("\n")`. `lines()` (`read.ts:478`) already carries the ABSOLUTE 1-based number, so the chain is computable there without the window affecting it — and it must not: the same line hashes the same whether it was read alone or as part of a 500-line window, or no address survives a second read.
- **A hash of the line's CONTENT alone is not an address — measured today.** `experiments/2026-10-01_edit-range-verify/dup-lines.txt` has IDENTICAL lines at 2 and 4; the content path refused them as «Found multiple matches for oldString». The chain separates them by construction (their prefixes differ), which a content hash cannot.

## The address

```
h(0) = seed
h(i) = trunc32(xxHash64(h(i-1) ‖ "\u0000" ‖ line(i)))
```

`read` prints it before the text: `470  3f19c2ea: <text>`. 32 bits, 8 lowercase hex, because the address is a *pair* and the chain already carries position and history — the hash only has to catch substitution. ~10 bytes per line (~20 KB on a 2000-line read) against the tokens currently spent re-typing anchors; the owner asked for «короткий» and this is that.

An edit entry is `{ fromHash, toHash, newString }`: `fromHash` is the hash of the line BEFORE the span (or the seed for line 1), `toHash` the hash of the span's last line. Together they name the span AND assert the whole file above it.

**Cost — settled, do not re-open it.** xxHash64 runs at ~30 GB/s (owner, 2026-10-01) against the sha256
332 MB/s already in this project's own table (AGENTS.md § Hashing is NEVER the suspect, which forbids
re-litigating the question by benchmark). And `lines()` **already** streams the whole file — it tallies lines
past the window to report the true total for the pager — so the chain adds NO I/O on top of what a read
already pays.

What it must not add is WORK: only the lines up to the window's end are chained, because no printed address
depends on a later line. That is not a speed question — it is that a fast hash multiplied by work nobody reads
is still work nobody reads.

## Why this ends the plague: CRLF, and the mandatory re-read

`oldString` fails for a reason that has nothing to do with a model's attention: the bytes a caller types back
are almost never the bytes on disk. Line endings are the common case — a CRLF file, an editor that rewrites,
a read that normalises — and **the fuzzy cascade exists to forgive exactly that**, silently, which is how a
caller ends up holding a file it did not describe.

The chain removes the CLASS instead of forgiving it. **The hash is computed over the line's text WITH ITS
TERMINATOR EXCLUDED** — the same string `read` prints — chained through the running hash, so:

- a CRLF file and an LF file hash their lines IDENTICALLY, and an address survives an ending rewrite;
- nothing is ever compared by re-typing, so there is no string left to drift;
- a stale address cannot fall back on a guess, because guessing is no longer implemented.

**Re-reading is therefore MANDATORY — by construction, not by instruction** (owner, 2026-10-01: «вопрос
перечитай теперь обязательный. Потому что не зная хеша - не отредактируешь»). There is no path from «I think
the file says …» to a write: the address exists only in the output of a read that actually happened, and
`read.txt` must say so.

## Tasks

- [x] ✓ **H0 — baseline, FIRST (owner's order) — and the form of the command is part of the result.** The FILE
      form works; the DIRECTORY form does not, both measured 2026-10-01:
      `bun test test/tool/edit-exact.test.ts test/tool/multiedit.test.ts` → **27 pass / 0 fail**
      (`20261001T043327Z_ccf4e679`, exit 0, 10.2 s), while `bun test test/tool/` produced a run whose own
      `state.json` read `running` with **`bytes_written: 0`** and whose process reported
      **`cpu_delta_seconds=0`, `rss_mb=64`** after four minutes. Three readers, three answers — `jobwait` said
      `done` — and only the process's own CPU told the truth. The baseline is therefore taken from named FILES,
      and the directory form is recorded as a tool-state finding rather than a path to retry.
- [x] ✓ **H1 — the chain, defined once. DONE (commit `4a768738da`).**
      `chainHash(previous, line)` = `trunc32(xxHash64(previous ‖ "\u0000" ‖ line))` seeded at 0, plus
      `hashLabel` / `parseHash`, exported from `read.ts` and from nowhere else — `edit` must never grow a
      second spelling of the address. 32 bits, 8 lowercase hex. Typecheck exit 0 (`20261001T043453Z_44a6f951`).
- [ ] **H2 — `read` prints it** at `read.ts:415` — **text half DONE** (commit `4a768738da`), two halves OPEN:
      - **Hex dumps get an address too** (owner, 2026-10-01: «Для бинарника тоже самое») — otherwise `edit` has
        no address for a binary file at all. Directory listings stay unchanged: they have no lines to write.
      - **A long line needs a POSITION marker** (owner, 2026-10-01: «если в файле очень длинные строки то у тебя
        должен быть перенос строк. Для определения позиции»). Today a line over `MAX_LINE_LENGTH` is clipped
        with `MAX_LINE_SUFFIX`, which loses WHERE IN THE LINE the reader is. The address is already exact for
        such a line — the hash is taken over the FULL text before clipping — so what is missing is the visual
        cue, not the address.
      The window (`offset`/`limit`) must not change a hash — asserted, because the whole scheme dies quietly if
      it does.
- [ ] **H3 — ONE tool: `edit` takes `edits: [...]`.** Each entry `{ fromHash, toHash?, newString }` (`toHash` absent = a single line). `multiedit` is unregistered as a tool and its description is retired; its atomicity — resolve against a buffer, write once, say «NOTHING was written» on failure — becomes `edit`'s own property, which the list makes structural rather than compensating.
- [x] ✓ **H4 — resolve ALL, then apply. DONE (commit `660c370578`).** The chain is computed
      once over the ORIGINAL content; `fromHash` names the line BEFORE the span (the seed `00000000` names the
      state before line 1), `toHash` its last line, and an absent `toHash` means a single line. Refusals: an
      address not in the file, a malformed hash naming its ENTRY, an inverted range, past the end, and two
      entries claiming one line — that last one is a refusal, not a merge decision, because «last writer wins»
      is the silent outcome this design removes. Application is bottom-up so a replacement cannot move a span
      that has not been applied yet. Oracles: green **26 pass / 0 fail / 33 expect** (`20261001T045124Z_8c7741c6`);
      typecheck exit 0 (`20261001T045036Z_0b9e616f`). **My own expectation was wrong** — I read `fromHash: h[2]`
      as «line 2» when it is «the line after line 2» — and the TEST moved, with its provenance, not the contract.
      **Fallibility by MUTATION, and it names the mechanism:** applying the resolved spans top-down instead of
      bottom-up (`[...ordered].reverse()` → `ordered`) gave **25 pass / 1 fail** (`20261001T045158Z_86f4f438`),
      failing exactly «ALL entries resolve BEFORE any is applied» — and the diff shows WHY: a span computed
      against the ORIGINAL content landed on lines the earlier edit had already shifted. Restored: green
      **26 pass / 0 fail** (`20261001T045218Z_1e2c8f1c`), with `edit.ts` absent from `git status`, i.e. byte-identical
      to HEAD.
- [ ] **H5 — the cascade is CUT in the same change, not after it.** With the tool merged and hash-only there is nowhere for a fuzzy stage to live: `oldString` and the ten stages go, and `edit.txt` / `multiedit.txt` (retired) lose the stage vocabulary with them. The tests that pinned the stages are **replaced, not adjusted** — superseded with provenance, per the owner's «просто замени соответствующие тесты».
- [ ] **File creation survives.** A hash cannot address lines that do not exist: creating a file (today `oldString: ""`) needs an explicit form, named in the description, and it must not become a back door that skips resolution.

## Smoke Tests

- **Baseline before any edit:** `bun test test/tool/` — counts recorded in H0.
- **Predicted red:** a hash-addressed edit whose file changed since the read is REFUSED — red before the guard exists.
- **Predicted green after:** the unchanged file edits exactly the named lines; and on `dup-lines.txt` an address replaces Line 4 and ONLY Line 4 while Line 2 — identical text — is untouched. That second half is the whole point: it is what a content anchor cannot do, and it is the case that failed live an hour ago.
- **The layer:** at least one case decodes `Parameters` — the schema `tool/tool.ts:115` compiles per tool. F6's lesson, paid an hour ago: a suite that only calls helpers stayed green while the schema every caller crosses demanded a parameter the code discarded.
- **Fallibility:** mutate the hash comparison to always-true → the stale-address case MUST go red.
- **Live, after a promotion:** read a scratch file, edit by hash, read back. A claim about a binary is verified by DRIVING it: the running runtime (10.0.1168) behaved as PRE-F4 on 2026-10-01, and `dist/bin/opencode.exe` 10.0.1169 (compiled 12:21:58, staged 12:22:04) is not yet promoted — promotion is the owner's procedure.
- Never the whole package suite (AGENTS.md § Full package test suite).

## Risks

- **The chain makes the WHOLE file part of the address.** That is the point, and it is also the cost: an edit anywhere above invalidates every address below. Accepted by the owner's decision, and contained by resolve-then-apply inside one call.
- **A cheaper hash would not be safer.** The chain's strength comes from the pair plus history, not from the width; if 32 bits ever proves too few, the lever is width, never a fuzzy fallback.
- **`read` grows by ~10 bytes per line.** If it matters, the honest lever is a `read` flag — not a weaker address.

## Residual (named, not lost)

- **Backups can now carry a PROVABLE state** (owner, 2026-10-01: «для бэкапов — мы теперь можем четко сохранять
  хеши — тогда rollback будет доказуемым без гессинга»). The chain's FINAL value over a file is a whole-file
  digest: a backup can record it and a rollback can be CHECKED against it — an oracle instead of a resemblance.
  Two things must be settled before it is built, and this plan deliberately does not settle them:
  **WIDTH** — 32 bits exists for the ADDRESS, where position pins the rest; a backup proof needs the full 64, or
  a collision reports «same file» in silence, which is the green-looking wrong verdict this project fears most;
  **the SECOND SOURCE** — fossil already hashes content, so a chain digest beside it is a second spelling of one
  fact unless it IS that computation. «Two spellings of one mapping» is a defect this project has paid for
  twice, so the choice is: it replaces the check, or it is declared an additional witness with its own scope.
- `multiedit` as a module: unregistered from the tool catalog (as `applypatch` was), and its own tests move to `edit` rather than being deleted.
- The `from`/`to`/`expect` text-guard address (F4/F6) becomes redundant once hashes ship. Removing it is a separate decision — it is not needed for this plan, and it is not silently kept either.
