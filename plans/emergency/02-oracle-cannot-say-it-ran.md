# 02 — the oracle cannot say that it ran, so its silence is unreadable

<!-- intention: the TUI has no durable client trace at the point where a post-undo transcript goes
     blank, and the previous reporter skipped healthy ids before it could record liveness -> an
     event-driven, bounded client trace distinguishes event arrival, stored rows and listed rows;
     actual terminal visibility is checked against a separate captured frame -->

**Status: OPEN — product-level liveness was not delivered by `5a87a8baa9`.**

✗ `index.tsx:344,353-355` returns on empty held and skips every id already listed before calling
`report()`. A healthy session therefore cannot write the purported `alive` line. The reporter-only
suite (`20260927T151151Z_a3c71056`, 11 pass) did not exercise this caller. `seen.size === 1` is
not a one-shot latch: repeated calls with the same id can append multiple `alive` records. The
three silent `catch {}` blocks also conceal the writer's failure. Preserve the historical analysis
below as the record of the failed approach, not as acceptance.

## Replacement task and Smoke Tests

- [ ] Observe the real `Session` state on transition: event arrival ids, held message ids, listed
      message ids, and revert cursor; persist a bounded, content-free JSONL trace under the existing
      `tui-divergence/<pid>.jsonl`. An initial empty snapshot is a known observation, NOT a pass;
      a healthy arrival must produce a later snapshot and no hidden finding. `listed` means the
      transcript's computed list, not pixels actually painted by OpenTUI.
- [x] Classify arrived+held+not-listed (unless legitimately reverted), arrived+not-held, and
      healthy listed states without conflating them. Append only on transitions, not every reactive
      render or on a timer. Make write errors visible through the existing client logging surface
      without throwing into Solid. No prompt/part text or credentials in the trace.
      Evidence: `20260927T153853Z_dc6fa802` (15 pass / 0 fail; missing-store, hidden,
      exemption, dedup, bounded ids and failed-write callback); typecheck
      `20260927T153759Z_948e8442` exit 0. The earlier parallel run
      `20260927T153759Z_1eaf93b8` printed 15 pass but exited -1; it is not the stamp.
- [ ] Prove the real caller feeds the instrument on an empty initial store AND on a healthy id;
      focused test reads the artifact back and forces the hidden and missing-store alternatives.
      Only a live `cmd_runner` frame plus the corresponding trace can verify actual rendered pixels.

Baseline oracle: old `bun test test/tui/divergence.test.ts` from `packages/opencode` passed
11/0 (`20260927T153247Z_241ffd82`) despite the blind caller. The new interface went RED on
missing `inspectTranscript` (`20260927T153416Z_a49e30f1`). Post-change focused tests passed
15/0 (`20260927T153853Z_dc6fa802`), typecheck exit 0, candidate build/stage
`20260927T153946Z_138f87fa` exit 0 (10.0.1145). Live candidate run
`20260927T154251Z_7ef28765`, PID 7276, emitted an empty initial snapshot, then 2 hydrated
listed messages, then a confirmed undo transition (`revertID`, `listedCount: 0`) at
`experiments/2026-09-27_empty-transcript/.opencode/data/tui-divergence/7276.jsonl:1-4`.
The run had **zero new arrivals**; healthy live arrival and an actual terminal-pixel observation
remain UNPROVEN. No `bin/` mutation or launch.

## Historical approach (refuted at the caller)

## The defect, with its address

`packages/opencode/src/cli/cmd/tui/util/divergence-reporter.ts`

- `createDivergenceReporter` calls `mkdirSync` in its constructor (`:42-44`) — so **the directory's
  existence proves the reporter was constructed**, and nothing more.
- `report()` (`:48-56`) writes **only when `findDivergence` returns a record**. A healthy run writes
  nothing at all.

So:

| observable | what it could mean |
|---|---|
| no directory | never constructed |
| **directory, empty file** | **??? — ran and agreed, OR was never fed** |

**Measured today, live:** the directory existed and the file was empty, and **I could not tell which
world I was in.** I then built four theories in a row — stale artifact, module init order,
`initFromWorktree`, a relative `undefined` path — and killed each with an instrument rather than a
story. `findstr /M` proved `tui-divergence` IS in the shipped binary; `Global.Path` is a getter over
`process.cwd()`, so the path was right from the start.

**The instrument's own docstring already states the requirement it does not meet.**
`divergence.ts:46-52`:

> «a fired oracle with an empty ARRIVED is itself the finding, and the trace records `arrived: []`
> so a reader can tell «nothing arrived» from «nothing was checked»»

The trace only exists if a divergence is found. **So «nothing was checked» is not representable**,
which is exactly the promise the header makes.

## The capability EXISTS and nothing calls it

`DivergenceReporter.seen` is documented as *"Ids the reporter has seen, so a caller can tell 'never
fired' from 'no input'"* (`:16`). Measured across the tree, there are exactly three real call sites:

| where | what |
|---|---|
| `routes/session/index.tsx:355` | `divergenceReporter.report({...})` — **the only production use, and it never reads `seen`** |
| `test/tui/divergence.test.ts:91` | `reporter.path` |
| `test/tui/divergence.test.ts:108` | `[...reporter.seen]` — **a test proves the signal, and no product code reads it** |

**A rule that names the form changes behaviour; a capability that exists and is used by nobody does
not.** Same line as the `marks:` counter experiment: the sibling `sv:` line names the REQUIRED FORM
in its failure branch and went from 2 misses to 0; the one that named only the consequence sat at
NONE for 121 of 125 replies.

## The fix, in one line of behaviour

**On the first event, append one `{kind:"alive", seen, arrived, drawn}` record.** Then:

- file absent → never constructed
- file with `alive` and no `hidden` → **it ran and agreed** ← *today unrepresentable*
- file with `hidden` → the bug, with an address

Put it in the REPORTER, not in `findDivergence` — that one is deliberately a pure function over
sets, and a liveness side-channel there would be the wrong owner. Do not add a heartbeat timer: the
event is the honest trigger, and a tick every N ms is a log recording what state already shows.

**Keep the `try {} catch {}`.** A reporter that throws inside the TUI's event subscription takes
the session down, and a debugger that can break the thing it observes is worse than none. The
liveness record narrows the window enormously — it proves the WRITER works, not just the
constructor.

**Oracle:** a test that feeds one HEALTHY event and asserts the file contains exactly one `alive`
line and zero `hidden` lines. That assertion is impossible today, which is why it is the oracle
rather than a description.
