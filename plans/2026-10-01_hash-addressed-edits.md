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
- [x] ✓ **H2 — `read` prints it — BOTH halves DONE.** The text half landed in `4a768738da`; the byte-row
      address and the long-line wrap in the commit that carries this box ✓
      - **Hex rows carry an address** (owner, 2026-10-01: «Для бинарника тоже самое») ✓ `formatHexDump` chains
        the row's BYTES with the SAME `chainHash` the text path uses, printed between the offset and the hex:
        `00000020  3f19c2ea  48 65 6c 6c 6f …  |Hello|` ✓ Directory listings stay unchanged: they have no lines.
        **Two things had to change before the address could mean anything, and both are asserted:** rows are
        aligned to the FILE, never to `offset` — they used to begin wherever the caller pointed, so a row's
        content, and therefore its address, depended on the WINDOW, and an address that moves with the call is
        a rendering of the call rather than of the file — and the chain runs from byte ZERO over the rows a
        window does NOT return, because a hash carries its whole prefix ✓ `limit` therefore pages by whole
        ROWS: a page advancing by a byte count would re-show the row it stopped inside, for ever ✓
      - **Bytes reach a string chain losslessly.** `latin1`, the 1:1 byte↔code-point map — what «binary» MEANS
        rather than a rendering of it ✓ **Qualified BEFORE the code was built on it**, and the qualification
        earned its keep: the first probe printed faithfulness `false`, and that verdict was about a DEGENERATE
        FIXTURE (a sawtooth whose top byte repeats far sooner than the sample — 28 340 windows of the same
        bytes), not about latin1; with a real generator, 28 340 of 28 340 rows are distinct ✓ The same probe
        shows a latin1 string does NOT hash to what the raw byte view does, so a text address and a hex address
        over one file live in DIFFERENT spaces and can never resolve for one another ✓ Cost: **77.4 ms per MiB**
        of prefix (`experiments/2026-10-01_hex-address/qualify.mjs`) — the price of window-independence, as a
        number instead of a worry.
      - **A long line is WRAPPED, not clipped** (owner, 2026-10-01: «если в файле очень длинные строки то у
        тебя должен быть перенос строк. Для определения позиции») ✓ The suffix this replaced — «… (line
        truncated to 2000 chars)» — answers «how much did I lose», and he asked a DIFFERENT question: WHERE the
        reader is ✓ Chunks after the first carry `↳+<charOffset>: `, the line's ADDRESS stays on its first
        chunk, and running out of the whole output budget SAYS SO instead of truncating in silence (the old
        form always showed the first 2000 characters; the new one must never show less) ✓ The hash is still
        taken over the FULL text, before any wrapping, so the address is exact for such a line ✓
      **The window must not change a hash — asserted on both paths** (`read-address.test.ts`: four byte-row cases
      plus the wrap) ✓ and the MUTATION is measured, not asserted: `alignedStart = start` (rows following the
      caller's pointer) gives **two** named reds in the pure suite (`read-address.test.ts:141` — the row at
      0x20 no longer exists; `:160` — `offsetStart` became 5), and green again after `restore` ✓ The first
      version of that case used `offset: 33`, which IS a row boundary — it would have passed either way, which
      is the «a test that can silently assert nothing» class, caught by re-reading my own case before trusting
      it ✓
      **Оракулы:** чистый сьют **11 pass / 0 fail / 32 expect** `20261001T052102Z_66d5d559` (exit 0) ✓
      `bun typecheck` exit 0 — proven by the `&&` chain reaching `echo` in `20261001T051633Z_600ef7f0` ✓
      **Остаток, названный:** `edit` адресует ТОЛЬКО текстовые строки — адрес hex-строки печатается для
      ЧТЕНИЯ и повторной проверки, и `read.txt` теперь говорит ровно это, не обещая большего ✓ (бокс H7 ниже)
- [ ] **H7 — вторая половина «для бинарника тоже самое»: `edit` обязан УМЕТЬ применить адрес строки.** Сейчас
      `read` его печатает, а `edit` резолвит текстовые строки (`resolveEdits` делит по `\n`) ⇒ у бинарника
      адрес есть, а применить его нечем ✓ Это решение ВЛАДЕЛЬЦА, не моё — «чем заменяем» — ибо три ответа не
      эквивалентны:
      1. **hex-текст**: `newString` — то, что печатает `read --hex` (`48 65 6c`), декодируется в байты; совпадает
         с тем, что читатель видит, и отказывает всему, что не hex (никакой молчаливой переинтерпретации);
      2. **latin1-текст**: `newString` — байты замены как символы; принимает что угодно, то есть ровно тот
         класс, ради которого каскад и был снят;
      3. **base64**: однозначен для любых байтов, но в выводе `read` нет base64 ⇒ перекладывает на вызывающего
         преобразование, которого адрес не требует.
      Любой выбор решает заодно, как `edit` ОПОЗНАЁТ бинарник (флаг, или провал UTF-8-декодирования) — а
      неверная догадка здесь это ПУТЬ ЗАПИСИ, поэтому это бокс, а не рефлекс ✓
- [ ] **H8 — цель плана говорит «and no fuzzy stage exists», а 560 строк его всё ещё существуют.** `edit.ts`
      по-прежнему ЭКСПОРТИРУЕТ десять ступеней `Replacer` (`SimpleReplacer` … `ContextAwareReplacer`,
      `:649`–`:1106`), `replaceWithStage` (`:1165`), `replace` (`:1212`) и `replaceRange` (`:176`) — замерено
      2026-10-01: **в `src/` ни одного вызова** ✓ `replaceRange`/`replaceWithStage` встречаются только в своих
      определениях, `replaceWithStage` зовётся только из `replace`, а `[^.\w]replace\(` даёт определение
      `edit.ts:1212` и два посторонних метода диалога (`dialog.tsx:122`, `api.tsx:300`). Единственный
      потребитель всего этого — `test/tool/edit-exact.test.ts`, и три его блока зелёные, но **упасть на
      продукте не могут**: тест и мёртвый код держат друг друга ✓ Это «тест, который молча ничего не
      утверждает» в чистейшем виде ✓
      **Это ОДНА правка, а не две** (AGENTS: когда поведение переезжает, его сьют переезжает в той же правке):
      снять мёртвые экспорты И эти три блока вместе ✓ Оракул живого пути уже стоит на месте (`resolveEdits`
      + случаи схемы, которые остаются ✓), поэтому резать можно ✓ — но **не снимать сначала тесты** ✗: иначе
      мёртвый код останется вообще без наблюдателя ✗
      Оракул: названные файлы C2 зелёные после + `bun typecheck` exit 0 + удаление видно одним связным коммитом.
- [x] ✓ **H3 — ONE tool: `edit` takes `edits: [...]`. DONE (commit `815cf266b6`).** `multiedit` is UNREGISTERED
      from the catalog (`registry.ts`, 4 sites ✓) and turned INTO a module that declares itself retired, rather
      than deleted — the constitution blocks deleting files from the shell ✓, and a module that says so is
      better than a silent absence ✓ Its real property («nothing is written unless every entry resolves» ✓) did
      not die with it: it became `edit`'s own, structural via `resolveEdits` ✓ The old flat fields
      (`oldString`/`newString`/`replaceAll`/`exact`/`from`/`to`/`expect` ✓) are gone ✓ And the TUI's inline edit
      row rendered `replaceAll` ✓ — it now reports the number of changes ✓
      **Blast radius, mine:** the first typecheck found **35 errors across 5 files** ✗ — including the TUI and
      three test files ✓ AGENTS.md says to ask codegraph what an edit touches BEFORE it ✓ I did not ✓ and this is
      the price that rule was written about ✓ Recorded, not smoothed ✓
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
- [x] ✓ **H5 — the cascade is CUT from the editing path. DONE (commit `815cf266b6`).** The tool can no longer
      reach a fuzzy stage at all: `oldString` and the ten stages left `Parameters`, `edit.txt` was rewritten for
      the address, and `multiedit.txt` (retired) carries a banner ✓ The tests that pinned the stages are
      **replaced, not adjusted**, with their names written down in `edit.test.ts`'s header ✓✓
      **Residue, named rather than hidden:** the cascade FUNCTIONS still exist as dead exports in `edit.ts`, kept
      because the pure suites still exercise the helpers directly ✓ Removing them is a separate reduction that
      must take those cases with it ✓ — it is not needed for this plan ✓ and it is not silently kept either ✓
- [x] ✓ **File creation survives. DONE (commit `815cf266b6`).** `content` CREATES and is refused when the file
      already exists — the address path cannot name lines that are not there, so the two shapes are kept apart on
      purpose ✓ It is not a back door: it never reaches `resolveEdits` ✓ and `edits` + `content` together are a
      refusal ✓ The door was in fact the FIRST thing my own test caught: I had made `edits` a REQUIRED field,
      which quietly killed creation ✓ — the schema now has it optional and the guard names both doors ✓


- [x] ✓ **H6 — ONE call for EVERY file: the batch. DONE (commit `a9fbb11313`).** Owner, 2026-10-01: «ты когда
      файлы читаешь - ты уже видишь хеши, потом разовый edit на все измения и все, никаких степов все выверено
      - раз и все» · «Что одно изменение что пачка» ✓ `edit` takes `files: [{ filePath, edits?, content? }]` and
      NOTHING else: the entry type IS the shape the tool took for one file, so one change is a list of one and
      there is no second spelling of «a change to a file» to keep in step ✓
      **Three phases, and the ORDER is the property** ✓ (1) resolve every entry of every file, writing nothing —
      every address checked against the content AS IT WAS READ, so no entry has to survive an intermediate state;
      (2) ask for every file; (3) write every file, each as it was verified ✓ Asking at write time would have let
      a denial land after an earlier file was already written — a partial apply, the one outcome the list exists
      to make impossible ✓
      `withFileLocks` holds EVERY lock for the whole operation, in canonical order ✓ — with the resolve outside
      the hold, a concurrent edit could land between the read and the write and be silently overwritten, which is
      the exact failure an address exists to prevent ✓ It is the semaphore this file already took per file, held
      once for the set, not a new mechanism ✓
      **`filediffs` (a LIST) replaces `diff` + `filediff`** ✓ — ONE key for «what did this call change», from
      `edit` AND `write`, because a consumer that has to choose between two spellings of one question has already
      lost the answer ✓ Consumers: `processor` (changedFiles adds EVERY file — reading the first would silently
      drop the rest from the snapshot ✓), `summary`, `run.ts`, the TUI renderer (one diff block per file ✓),
      `write.ts` ✓
      **Two shapes are still READ and are labelled HISTORY, not alternatives** ✓ (`metadata.filediff` one file,
      `results[].filediff` multiedit): a stored record does not migrate and NO new part can produce either, so a
      reader that ignored them would drop the edits of every range written before now ✓ Pinned by fixtures that
      say so ✓
      **Оракулы:** typecheck exit 0 `20261001T050848Z_810e0140`; **57 pass / 0 fail** `20261001T050848Z_177c57f9`;
      снимок схемы переснят и **проверен контролем** — **54 pass / 0 fail, 15 снимков, ни одного не добавлено**
      `20261001T050955Z_a6405c94` ✓
      **Остаток по `multiedit` назван:** строка осталась в deny-списках `agent.ts` (×5) и в защитных множествах
      (`constitution`, `processor`, `dsml-normalizer`) — **инертна**, ибо инструмент нельзя вызвать, и оставлена
      нарочно; а мёртвый рендер в TUI **снят** ✓ и ложная проза сводки (`write/edit/multiedit filediff`) —
      исправлена ✓

## H9 — encodings, endings and the span's edges (review 2026-10-01, revision 3)

A review of `read`/`edit` found the chain itself sound on LF/CRLF, and the surface AROUND it wrong — every
item below was reproduced by `experiments/2026-10-01_chain-review/probe.ts` (predictions written before the
run, 7/7 matched, control case green):

- ✓ BOM: `read` decodes with `Buffer.toString("utf8")` and keeps U+FEFF in line 1 (`read.ts:548`), `edit`
  strips it (`util/bom.ts:19`) ⇒ every address of a BOM file is refused.
- ✓ ANSI (cp1251, the Delphi IDE default): every path decodes UTF-8 only ⇒ an edit of an ASCII line turned
  the untouched Cyrillic bytes `cff0e8e2e5f2` into U+FFFD — the whole file destroyed by an edit elsewhere.
- ✓ `newString: ""` leaves a blank line (`"".split("\n")` is `[""]`); a trailing `\n` adds one; appending
  after the last line is refused (no final `\n`) or eats the final newline (with one).
- read only: `detectLineEnding` says CRLF on the FIRST `\r\n` (mixed files); `edit` does not refuse binary
  files (`00000000` resolves in ANY file); `withFileLocks` sorts raw paths while `lock()` keys resolved
  ones; `edit.txt:40` still promises the removed Unicode normalisation.

**Owner decisions (2026-10-01), verbatim:**
- «инструмент дубовый - от хеша - до хеша вставляем что отправил агент, безусловно надо анализ какие ендинги
  отправил агент, а какие у файла и поправить если файл текстовый, чтобы не было микширования тоже самое с
  кодировкой.»
- «c crlf эндингами, если их не соблюдать то нативный дельфи парсер начнет плеваться»
- ANSI: «надо сконвертить файл в utf-8 bom c crlf - и закрыть вопрос. Это решается в момент сохранения и агент
  получает уведомление.» and «Обратное кодирование в cp1251 сносит все мультиязычные темы» ⇒ ANSI is DECODED,
  never ENCODED: there is no ANSI encoder in the tree.
- trailing terminator: «Надо просто проверить как было в оригинале и не выдумывать. Обычно есть.»
- Delphi / new files: «UTF-8 c BOM crlf - сам эндинг можно проверить у файла, если это дельфи файл то надо об
  этом напомнить агенту, если есть различия, сканнер сущностей дельфи заточен под UTF-8 BOM CRLF, это кстати
  исправит ошибки если они были сделаны ранее.»
- UTF-16: «Конечно. Это тоже критично для мультиязыковых систем.»

**The contract:**
1. ONE codec for `read`, `edit` and `write` (`src/util/text-codec.ts`): BOM first (UTF-8, UTF-16 LE/BE),
   then a NUL byte or the binary heuristic ⇒ binary, then strict UTF-8, else ANSI in the host code page (ACP
   read from the registry once; no ACP ⇒ refusal, never a guessed literal). `read` and `edit` hash the SAME
   decoded text, BOM excluded, so an address resolves in every supported encoding.
2. The span is whole lines WITH their terminators. `newString` is split into lines; ONE trailing terminator
   belongs to its last line and is dropped; `""` is zero lines (deletion). The replacement's last line takes
   the terminator the ORIGINAL span's last line had (none only at an unterminated EOF); every other new line
   takes the file's ending. `toHash` equal to `fromHash` names the EMPTY span after that line: an insertion,
   which is also how a line is appended at the end.
3. File ending = the MAJORITY ending of the file (no mixing introduced); the agent's endings are rewritten
   to it.
4. Encoding out: the file's own (UTF-8, UTF-8 BOM, UTF-16 LE/BE with BOM). ANSI ⇒ UTF-8 BOM + CRLF.
   Delphi (`.pas .dpr .dpk .inc .dfm .dproj`) ⇒ ALWAYS UTF-8 BOM + CRLF over the WHOLE file, new or existing.
   Any conversion is NAMED in the tool output (from → to), and the pre-edit backup holds the original bytes.
5. New non-Delphi files (`content`, `write`): as the agent sent them.
6. Binary ⇒ `edit` refuses (H7 stays the owner's open box for hex edits).

**Risk (named, not hidden):** an ANSI file is decoded in the HOST code page. A file in another code page
(e.g. GBK on a 1251 host) decodes to garbage and the conversion would make it permanent; bytes cannot settle
the code page. Containment: the backup, the named conversion in the output, and the whole-file diff.

Baseline before any edit: pure `read-address` + `edit-exact` **37 pass / 0 fail**; `edit.test.ts` **9 / 0**;
`write.test.ts` **18 / 0**. Tool qualified first: Bun 1.4.2 `TextDecoder` decodes `windows-1251` («Привет»),
`gbk`, `shift_jis`, `euc-kr`, `big5`, `utf-16le/be`; strict UTF-8 throws; `isUtf8` from `node:buffer` works;
`writeWithDirs` takes `Uint8Array`; host ACP = 1251 (registry).

- [x] ✓ **H9a — codec** `src/util/text-codec.ts` + `test/util/text-codec.test.ts`: red before (module absent),
      **11 pass / 0 fail** after. `encode` takes `TextEncoding`, which has no ANSI member — the «never write
      ANSI» rule is a type, not a test. The binary heuristic MOVED here from `read` (one definition for both).
- [x] ✓ **H9b — `read`**: `lines()` streams UTF-8 (BOM stripped) and hands anything else to the codec whole;
      the window logic is ONE function for both paths. 5 new cases red before (BOM, UTF-16 LE, UTF-16 BE,
      cp1251, a non-UTF-8 byte PAST the window), **16 pass / 0 fail** after. Mutation — validate only inside
      the window — gave exactly the past-the-window case red (15/1), restored.
- [x] ✓ **H9c — `resolveEdits`** on terminated lines: 9 new cases red before (the inverted-range guard green,
      as it must stay), **36 / 0** after. A defect of MY first version was caught by re-reading it, not by the
      suite: appending to a one-line file with no break glued the lines (`??` where `||` was needed) — a test
      was added red first («a» + «c» → «ac»), then fixed. Mutation — take the final terminator from the agent
      instead of the original — **7 red**, restored.
- [x] ✓ **H9d — write path**: `edit` and `write` decode through the codec, write `TextCodec.encode`, sync after
      the formatter with `TextCodec.syncFile` (replaces `Bom.syncFile`, which re-read every file as UTF-8),
      back up the BYTES as read, refuse binary files, order locks by RESOLVED path, and NAME every conversion
      in the output. `detectLineEnding`/`convertToLineEnding` deleted (no consumer; the first was the
      first-CRLF defect). Byte read-back cases: `edit.test.ts` 5 red before → **16 / 0**; `write.test.ts`
      3 red before → **21 / 0**. Mutation — `fit` forgets the forced CRLF — **3 red** (ANSI, Delphi edit, new
      Delphi), restored. `bun typecheck` **exit 0**. Schema snapshot: exactly `edit` moved, two description
      lines in the diff; control run **15 snapshots, none added**. `edit.txt`/`write.txt`/`read.txt` say what
      the code does; the false «Unicode normalization» promise is gone.

**Residual:** `applypatch` / `src/patch` still decode UTF-8 only — INERT, the tool is not in the registry.
Not changed: a second spelling of this codec in a module nobody can call would be work nobody reads.

## Smoke Tests

- **Baseline before any edit:** `bun test test/tool/` — counts recorded in H0.
- **Predicted red:** a hash-addressed edit whose file changed since the read is REFUSED — red before the guard exists.
- **Predicted green after:** the unchanged file edits exactly the named lines; and on `dup-lines.txt` an address replaces Line 4 and ONLY Line 4 while Line 2 — identical text — is untouched. That second half is the whole point: it is what a content anchor cannot do, and it is the case that failed live an hour ago.
- **The layer:** at least one case decodes `Parameters` — the schema `tool/tool.ts:115` compiles per tool. F6's lesson, paid an hour ago: a suite that only calls helpers stayed green while the schema every caller crosses demanded a parameter the code discarded.
- **Fallibility:** mutate the hash comparison to always-true → the stale-address case MUST go red.
- **Live, after a promotion:** read a scratch file, edit by hash, read back; and `read --hex` a small binary twice at two different `offset`s, confirming the SAME row prints the SAME address. A claim about a binary is verified by DRIVING it: the running runtime (10.0.1168) behaved as PRE-F4 on 2026-10-01, and `dist/bin/opencode.exe` 10.0.1169 (compiled 12:21:58, staged 12:22:04) is not yet promoted — promotion is the owner's procedure.
- **The integration half is OWED, and the reason is measured rather than assumed:** `read.test.ts` produced ONE
  verdict today (`40 pass / 1 fail`, 41 tests, 64.7 s, `20261001T051356Z_91a08082` — and that run predates every
  edit below it, so it certifies NONE of them) and then STALLED on four consecutive attempts
  (`20261001T051903Z_ae7becc6`, `20261001T051957Z_12b3f9f8`, `20261001T052033Z_9d948336`,
  `20261001T052102Z_6eb9f011`), each printing the banner and nothing else.
  **Attribution is INDETERMINATE, and convenience does not excuse the rule:** the one PASS is before this change
  and the failures are after it, which by itself points AT the change — so it is recorded as ours, never as
  inherited. What the logs DO show is where it stops: the banner alone, before ANY of the three cases changed
  here runs (the first is the offset case, well past the top of the file), so the hang sits UPSTREAM of the
  edits. That is a narrowing, not a clearance ✓ `bun test` on this host stalls intermittently with a banner-only
  log and no progress signal, and the countermeasure that has worked is `cmd_runner stop` plus a retry.
  The properties those three cases assert are therefore proven at the PURE layer (`read-address.test.ts`: green,
  and measured fallible by mutation), which is the doctrine both files already carry — and the integration case
  for the byte-row address stays in `read.test.ts` as the OWED half.
- **The owed integration half — PAID (H9, 2026-10-01):** `bun test test/tool/read.test.ts` → **42 pass / 0 fail**,
  exit 0, 15.4 s (`experiments/2026-10-01_chain-review/read-integration.log`), after every H2 and H9 change to
  `read`. No stall this run; the stall class above stays recorded, not cleared.
- **A tool-state finding with no address, recorded so it is not paid twice:** a `cmd`-launched run puts its log
  under `C:\WINDOWS\logs\cmd_runner\`, because the wrapper's CWD is the one it was GIVEN, not the worktree. That
  session cannot even be stopped afterwards (`Unknown run_id`) — an orphan conhost nobody can name. A
  `run`-launched run lands in the project's own `logs/cmd_runner/` and IS readable; the canon is to launch from
  the worktree root and pass `--cwd` for the package.
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
