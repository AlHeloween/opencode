# Debugging and measurement paradigm (moved from AGENTS.md, 2026-10-13)

The rules stay in AGENTS.md (§ Debugging Paradigm, § Hashing is NEVER the suspect, § Granularity); this file is the record — the owner's statements, the measurements, and the causes already excluded by measurement.

## Debugging Paradigm — read state before adding a log (2026-09-19)

Owner, 2026-09-19: «раньше можно было работать грепом и всё было ок, сейчас у нас codegraph и
этого мало, трёхъярусные смоки… дебаг неудобен, **логи приходится прописывать на каждом углу
вместо того чтобы прочитать state**.»

**Measured before writing it down:** `packages/opencode/src` carries **924** `log.(debug|info|warn|
error)` call sites and **124** `bug:` markers — roughly 1.5 logs per source file. That is 924
pre-committed hypotheses about what will go wrong.

**And the evidence that they do not cover the real one — all from 2026-09-19:**

| what was found | how it was found |
|---|---|
| `jobs.db` had no `pid` column | reading state |
| fossil leaves missing after a boundary | reading state (`snapshot.fsl`) |
| window is 236 280 / 23 %, not "exhausted" | reading state (`checkstate`) |
| **`{state}/model.json` is written by THREE modules** | **no log exists at all** |

The last row is the verdict on the approach: the only genuine lost-update race in the inventory is
logged **nowhere**, because nobody anticipated a *silent* write. Logs cover the anticipated; readable
state answers questions nobody asked. That is precisely «читать state вместо логов».

**Corollary — logging is not a fix.** «Every catch must log» still stands (a silent `catch {}` is a
bug), but it is a floor, not a licence: the 124 `bug:` markers are 124 defects wearing a log. Most of
them should be **removed by deleting the catch**, not kept as a written-down shrug. A `bug:` marker
that survives a release is an unfixed defect with a receipt.

## Hashing is NEVER the suspect — measured, do not re-litigate (2026-09-29)

Owner, 2026-09-29, verbatim: «пропиши в agents.md таким злостным образом чтобы больше ни один умник
не говорил про хеш». Written because a search cycle was spent on "maybe SHA-256 is slow" while a
20–36 s stall was on the table — and the answer was one smoke away.

| operation | data | time | throughput |
|---|---|---|---|
| `sha256`, one buffer, one digest | 100 MB | **301.1 ms** | **332 MB/s** |
| `sha256`, streamed in 64 KB chunks | 100 MB | 292.4 ms | 342 MB/s |
| `sha256`, 582 separate blocks (our block-map shape) | 100 MB | 296.1 ms | 338 MB/s |
| `JSON.stringify` | 134.3 MB | 158.9 ms | 845 MB/s |
| `sha256` of that JSON string | 134.3 MB | 469.1 ms | 286 MB/s |

Instrument: `experiments/2026-09-29_fossil-boundary-cost/sha256_100mb.mjs` — bun + `node:crypto`, the
runtime the product actually ships. Run `20260929T172314Z_b55137cf`. **Re-run it only if the HOST or
the runtime changed, and then update this table** — re-running it to re-argue the question is the
churn this section exists to stop.

**The arithmetic that ends the argument.** At 332 MB/s a stall of 20 s needs **≈6.6 GB** hashed; 36 s
needs **≈12 GB**. This repository's entire session store is 9.7 MB of part JSON and 1.09 MB of text —
hashing all of it costs **≈29 ms**, three orders of magnitude below the stall. And "but it hashes
every block" is already in the table: 582 blocks of our block map measured 296 ms at TEN TIMES our
data volume. There is no version of "the hash is the bottleneck" that survives these two lines.

**The general rule this section is really about:** **a stall of seconds over megabytes is a WAIT, not
a count.** Throughput work scales with the data; a wait does not. When the data is small and the stall
is large, the cause is a lock, a socket, a timeout, an MCP handshake, a plugin, or a branch that
sleeps — never a loop over data that small. Reach for a phase timer, not for the primitive.

**Also excluded in the same hunt, each by measurement — do not re-suspect these either:**
fossil at the turn boundary (`changes` 0.144 s, `addremove -n` tree walk 0.644 s over 10,913 tracked
files); the status-note plan scan (`planFiles` + `collectPlanState` + `planDebt` + `criticalRisks` =
~10 ms); the status-note window functions (`couplingFindings` 7.0 ms, `statusMarks` 0.3 ms,
`statusVector` 0.1 ms, `JSON.parse` of 9.7 MB = 44 ms); the checkpoint disk path (`decryptBaseline`
of 0.94 MB = 5.8 ms, `JSON.parse` of 950 117 chars = 11.3 ms, `reusablePrefixLength` over 588
messages = 0.1 ms); the provider itself (`ttftMs` 51 ms). Full numbers and probes in
`experiments/2026-09-29_fossil-boundary-cost/`.

## Granularity — the owner's statement (2026-09-29)

Owner, 2026-09-29, verbatim: «Fossil кстати тоже, мы его четко вызываем только для снапшота и он
гранулирован началом хода, и все ну и перед undo чтобы можно было сделать redo. Тулы должны работать
сами. Как говорится можно успеть секунда в секунду - только вопрос - ради чего, средний ход 10 минут,
64к токенов это 20 минут. Вот тут опять вспоминается Lean and DISAS.»
