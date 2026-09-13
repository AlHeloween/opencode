<!-- intention: StreamLake Vanchin is only a hand-authored custom provider -> StreamLake Vanchin is a first-class Pay-as-you-go provider option in TUI with secure key setup and truthful endpoint-model selection -->

# StreamLake Vanchin provider onboarding

state: COMPLETE
scope: `packages/opencode/src/provider/provider-sync.ts`, provider model loading/discovery, CLI TUI provider dialog, focused provider/TUI tests, provider documentation

## Grounded state

`bin/opencode.jsonc` defines `smit-glm-5.3-flash` as a custom OpenAI-compatible provider and manually supplies one opaque `ep-…` model ID with limits. `Provider.list()` only creates custom models declared in `provider.models`; omitted capabilities resolve to defaults and generic custom providers are not remotely discovered.

The Pay-as-you-go gateway accepts endpoint IDs as `model`, but authenticated `GET` probes against `/api/gateway/v1/models`, `/endpoints`, `/endpoints/models`, and endpoint-detail variants return HTTP 400. The official [Vanchin model list](https://www.streamlake.com/document/WANQING/mdrax1ixkgpgh1ms1na) lists model-specific context, output caps, Function Call, reasoning, image, and video capabilities. The official quickstart says the Vanchin console’s endpoint detail page identifies the deployed model. Therefore a provider setup must bind a user-selected endpoint ID to its deployed official catalog profile; it cannot claim that OpenAI-compatible metadata was fetched from the gateway.

## Contract

- The TUI exposes `StreamLake Vanchin` as a provider option; it is not represented by a user-specific provider ID.
- It uses the Pay-as-you-go gateway, never a Coding Plan path or a KAT profile.
- Connecting through the TUI stores an API key through existing auth storage; no secret is written to source/config or emitted in logs.
- Existing `STREAMLAKE_API_KEY` environment configuration remains usable as a runtime credential source, but TUI setup prefers secure auth storage.
- Setup collects the account endpoint ID, then shows only the bundled snapshot of active official Vanchin chat profiles. The selected profile supplies context/output limits, reasoning, Function Call, and text/image/video input metadata; no modality field is typed or guessed.
- Existing user config and unrelated work remain unchanged.

## Tasks

| Task | Bound surface | Oracle |
|---|---|---|
| T1 `[COMPLETION]` Probe authenticated Vanchin catalog safely | disposable probe only | endpoint list/detail GET responses reduced to status only; all six tested paths return HTTP 400 |
| T2 `[COMPLETION]` Register StreamLake Vanchin | provider source and bundled registry pipeline | focused registry test shows canonical provider ID, PayGo API URL, key binding, and visible model entry |
| T3 `[COMPLETION]` Carry official model metadata to the endpoint profile | Vanchin catalog snapshot and state tests | selected model profile supplies only documented limits/capabilities; no raw modality prompt remains |
| T4 `[COMPLETION]` Prove static TUI connection flow | provider dialog + focused tests | state oracle passes and the dialog transpiles; terminal renderer exited before visual capture, recorded as an Unknown residual |
| T5 `[COMPLETION]` Record and verify | docs, plan, progress records | focused tests, static TUI transpile, official source read, and gateway shape-only smoke recorded |

## Smoke tests

Baseline: `cd packages/opencode && bun test test/provider/provider-sync.test.ts test/provider/provider.test.ts`.

Post-change: provider source and Vanchin catalog/state tests; transpile the TUI dialog. The live smoke performs authenticated endpoint metadata reads only; output is reduced to HTTP status and property names.

## Risks / rollback

- Endpoint IDs are account-specific. Never bundle a fabricated `ep-*` model.
- Gateway metadata GETs are unsupported on the tested Pay-as-you-go paths. Model profile metadata comes from the official catalog snapshot, and setup requires the console’s deployed-model identity.
- The catalog includes retired and out-of-scope rows. Do not reintroduce them to the provider picker.
- Rollback: revert the provider source and discovery binding as one plan-bound change; do not rewrite user configuration.
