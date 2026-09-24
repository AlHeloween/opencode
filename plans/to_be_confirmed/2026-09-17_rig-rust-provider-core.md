<!-- intention: provider truth duplicated between our code and a patch on someone else's dist -> one owned provider/runtime boundary, or a recorded decision not to move -->

# Rig (Rust) as a provider/agent core — OPTION, requires deep verification

```yaml
status: option, unverified — do NOT act on this without the probe below
raised: 2026-09-17
raised_by: Alexander
scope: packages/opencode/src/provider/**, session/llm.ts, the native boundary
smoke: N/A (nothing is being changed; this file records an option and its falsifier)
```

## Why it came up

Not from a defect in the AI SDK. From a structural observation made while tracing
the provider path on 2026-09-17: **every vendor fact the Vercel AI SDK encodes
internally, we have had to duplicate on our side, with no mechanism keeping the
copies in sync.**

The concrete instance: `@ai-sdk/deepseek` decides V4-ness inside
`convertToDeepSeekChatMessages` with `modelId.includes("deepseek-v4")`. The
2026-09-10 release ships as plain `deepseek-flash` (DeepSeek-V4.1-Flash), which
contains neither token. We therefore hold the predicate twice:

| Copy | Where | Guarded? |
|---|---|---|
| ours | `provider/transform.ts:561` — `id.includes("v4") \|\| id.includes("deepseek-flash")` | yes, tested + provenance comment |
| theirs | `patches/@ai-sdk%2Fdeepseek@3.0.26.patch` on `dist/index.js` | **no** |

The patch key is version-exact. A bump to `3.0.27` stops applying it, our tests
stay green because they test *our* copy, and the symptom is "the model behaves
oddly" rather than a red test. **That silent failure is worth an oracle on the
patch regardless of whether Rig is ever adopted** — see Residual.

## What Rig is (read 2026-09-17, github.com/0xPlaygrounds/rig)

| | |
|---|---|
| Version / releases | `0.42.0`, 633 releases, 239 contributors, 99.9% Rust |
| Split | `rig-core` = provider contracts; `rig-agent` = builder, streaming, tool registry, **serializable `AgentRun` state machine** |
| Providers | 20+ under one interface |
| Other | GenAI semantic conventions, WASM (no WASI), 10+ vector stores |
| Users | VT Code (Rust terminal coding agent), Con, ilert, Neon, Nethermind |

## The single thing worth probing — and it is not the provider layer

`rig-agent`'s **serializable `AgentRun`**. Everything `docs/kernel-amendment.md`
records under "a month is not one run" is about state living outside the model —
`plans/`, `_progress_log.md`, fossil leaves, checkpoints, m\*. A serializable run
state machine is that primitive as a built-in, and it is the one thing here that
cannot be bought anywhere else.

**Falsifier (one hour, read-only, no migration):** is the serialization *total* —
can a run be reconstructed on another machine, under a different model — or is it
a checkpoint of a subset? Total → Rig is interesting on this merit alone,
independent of whether any provider call ever moves to Rust. Subset → the topic
closes and we stay as we are.

Status of the claim above: **Inferred** — taken from their README. GitHub code
search needs an account; the crate source was not read.

## Why this is NOT a migration proposal

1. **Declared churn is the wrong property for our target.** The README leads with
   "Here be dragons… future updates will contain breaking changes", at 633
   releases. Our stated goal is unattended runs of a day to a month across
   hundreds of sessions. Taking library-announced breaking churn onto the layer
   that touches every request trades a known cost (an occasional dist patch) for
   an unbounded one (continuous migration).
2. **Vendor truth changes language, not location.** Rig will hold its own
   internal vendor predicates in Rust, with the same reach problem — and Cargo's
   patch story is *worse* than bun's `patchedDependencies`: a fork or a vendored
   path override, not a patch file.
3. **`docs/reasoning-round-trip-contract.md` does not transfer.** DeepSeek 400s
   on tool turns without `reasoning_content`; OpenRouter strips reasoning fields
   entirely; Z.AI documents only `reasoning_content`; OpenRouter relays upstream
   errors un-normalised. No framework carries this. Moving means re-establishing
   it against Rig's mappings, i.e. re-running the wire probes per vendor.
4. **`streamText` is not the defect.** Nothing found on 2026-09-17 argues for
   replacing the agent loop. Same verdict as the zig core: leave the engine,
   harden the boundary.

## Points genuinely in favour, recorded so they are not lost

- `rig-core` / `rig-agent` separation means adapters are usable without their
  loop — not all-or-nothing. We reached the same split by hand.
- Rust makes the napi-rs bridge coherent, and Rust is already in the repo
  (Tauri, `cargo run -p specta-bindings`).
- **Rust is the better host for the gateway than Bun.** Measured 2026-09-17: our
  Novita h3 path rides Bun's *experimental* pinned-protocol fetch, while HTTP/3
  in Rust (quinn/reqwest) is production-grade. See the provider-reach postulate
  in AGENTS.md.

## Residual — do these irrespective of Rig

- [ ] Oracle on the deepseek patch: a test driving the SDK's own
      `convertToDeepSeekChatMessages` with `deepseek-flash`, so a version bump
      that drops the patch goes red instead of degrading silently.
- [ ] Decide where provider truth lives. Two unsynchronised copies is the actual
      defect; it is independent of which framework holds one of them.
