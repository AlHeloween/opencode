<!-- intention: 72 audio tests exercise JS stubs that return -1, so they test nothing and fail -> the per-stream audio symbols are bound to the real native implementation and the tests exercise it -->

# OpenTUI audio-stream tests: 72 failures, all against JS stubs

```yaml
status: root cause found, fix not attempted — parked for a targeted session
raised: 2026-09-17
scope: packages/opentui/packages/core/src/zig.ts, src/tests/audio-stream.test.ts
```

## Smoke Tests

- Baseline [Exact]: `cd packages/opentui/packages/core && bun test` → 5038 pass,
  23 skip, **88 fail**, 3 failed snapshots, 172 files. Captured 2026-09-17.
- Audio subset [Exact]: `bun test src/tests/audio-stream.test.ts` → every
  failure is `AudioStreamError: Audio stream create failed: -1` thrown from
  `audio.ts:968` (`createNativeStream`).
- Control [Exact]: `bun test src/tests/audio.test.ts` → **19 pass / 1 fail**, so
  the engine, the default group and the non-stream symbols all work.
- Post-fix oracle: the same three commands, with the audio-stream suite green
  **without any test being weakened, skipped or re-scoped**.

## Root cause

`src/zig.ts:1596` — the per-stream audio symbols are **commented out of the FFI
symbol table** and replaced by JS stubs that return `-1` / `null`:

```
// Per-stream audio symbols — not in pre-built DLL, provided as JS stubs
// audioCreateStream, audioWriteStream, audioEndStream, audioRestartStream,
// audioSetStreamVolume, audioSetStreamPan, audioSetStreamGroup,
// audioGetStreamStats, audioCloseStream
```

So all 72 tests have been exercising a stub, never the native code. They do not
merely fail — **they assert nothing about the product.**

The premise of the stubs ("not in pre-built DLL") is stale. The zig side
implements and exports them:

| Symbol | Export |
|---|---|
| `audioCreateStream` | `src/zig/lib.zig:418` |
| `audioWriteStream` | `:427` |
| `audioEndStream` | `:437` |
| `audioGetStreamStats` | `:462` |
| `audioCloseStream` | `:467` |

with the implementation in `src/zig/audio.zig` (`createStream` at `:1315`).

## Hypotheses disproven by measurement — do not retry these

1. **Stale native library.** Rebuilt with `bun run build:native` (exit 0, DLL
   re-dated). Result: **identical 88 failures, identical failure set.** The
   rebuild is not the fix.
2. **No audio device.** The engine inits with `config.noDevice = MA_TRUE`
   (`audio.zig:1057`) — no device required. And `audio.test.ts` passes 19.
3. **`autoStart: false`** (which `audio-stream.test.ts` uses everywhere while
   `audio.test.ts` does not). Probed both ways directly against the binding:
   **both return `-1`**, engine handle valid and non-zero in both.
4. **Option/struct drift.** Checked on paper and all five `err_invalid` branches
   of `createStream` are satisfied: `max_probe_bytes` = 1 MB; format `Mp3:1` /
   `Flac:2` matching zig exactly; 2000 ms → 96 000 frames against a native cap
   of ~268 M; `groupId` 0 with the default group created during engine init;
   struct layout 8 fields in the same order on both sides, caller passing all
   eight. None of this is the cause — the call never reaches native.

## Open question the fix turns on

**Does the built DLL actually export these symbols?** Unresolved. Two attempts
with `strings` on the DLL returned zero matches — but so did the control
symbols `audioPlay` and `audioStartMixer`, which demonstrably work. The
instrument cannot read the PE export table; the result says nothing about the
symbols.

Cheap decisive falsifier: declare `audioCreateStream` in the FFI table and run
one test. `dlopen` fails loudly on an unresolved symbol, so the answer arrives
in one run either way.

## Fix shape

1. Settle the export question with the falsifier above.
2. Declare the nine symbols in the FFI table with signatures matching the zig
   exports, and delete the stubs.
3. Re-run. Any test that then fails on *behaviour* is a genuine finding and gets
   handled on its merits — that is the point of binding the real implementation.

**Constraint, stated by Alexander 2026-09-17:** tests must stop failing *and*
must stop letting dubious things pass. Green obtained by skipping, weakening an
assertion or narrowing a scope does not count. A suite of 72 tests against a
stub returning `-1` is exactly the failure mode being ruled out.

## Related

Nothing runs this package: `packages/opentui/packages/core` declares no
`test:ci`, and CI runs `bun turbo test:ci`. That is how 88 accumulated. Arming
the gate belongs *after* triage — a gate that is red on day one teaches people
to ignore it.

Remaining non-audio failures, untriaged: `Code` 7, `Textarea` 4, borrowed
pointer (FFI) 3, markdown/conceal ~3.
