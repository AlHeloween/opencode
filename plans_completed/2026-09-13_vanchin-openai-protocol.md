<!-- intention: Vanchin PayGo uses a generic OpenAI-compatible request shape with inherited Coding Plan behavior -> Vanchin PayGo requests use the official OpenAI protocol with only the documented host and request fields -->

# Vanchin OpenAI protocol alignment

state: COMPLETE
scope: `packages/opencode/src/provider/transform.ts`, `packages/opencode/src/cli/cmd/tui/component/dialog-streamlake-vanchin-state.ts`, focused provider tests, documentation

## Grounded contract

The official Chinese OpenAI-protocol page, `https://www.streamlake.com/document/WANQING/mq6k66r6xgqwnfbd8t`, specifies an account inference endpoint ID (`ep-…`) in `model`; `enable_thinking` as the model-dependent reasoning flag; and request `modalities` only for Qwen-Omni audio output. Its public hostname spelling is replaced by the user-authoritative Vanchin host only in requests: `https://vanchin.streamlake.ai/api/gateway/v1/endpoints`.

`Provider.providerOptions()` previously applied legacy `chat_template_kwargs.preserve_thinking` to every URL containing `streamlake|vanchin`. The correction limits that Coding-plan-specific behavior to `/api/gateway/coding/v1`, so it cannot leak into the PayGo endpoint. Custom model `options` merge into `Provider.Model.options` and unknown OpenAI-compatible options are spread into the request body.

## Contract

- PayGo requests retain only the Vanchin host and ordinary OpenAI-compatible path construction.
- A reasoning profile sends `enable_thinking: true`; non-reasoning profiles send no reasoning toggle.
- PayGo does not receive the legacy coding-template option.
- No request `modalities` field is emitted for generic image/video understanding profiles; the official protocol reserves it for Qwen-Omni audio output.
- No DeepSeek surface changes.

## Tasks

| Task | Bound surface | Oracle |
|---|---|---|
| T1 `[COMPLETION]` Narrow legacy template behavior to coding URLs | provider transform | focused provider-options test proves the PayGo URL emits no template field |
| T2 `[COMPLETION]` Add documented reasoning option to profiles | Vanchin state helper | state test confirms `enable_thinking` for the reasoning profile |
| T3 `[COMPLETION]` Record and verify protocol | docs and progress | focused state and provider-options tests pass |

## Smoke tests

- `cd packages/opencode && bun test test/tui/dialog-streamlake-vanchin-state.test.ts`
- `cd packages/opencode && bun test test/provider/transform.test.ts --test-name-pattern "keeps Vanchin PayGo requests free"`

## Rollback

Remove only the Vanchin-specific profile option and PayGo URL branch. Do not modify user configuration, credentials, or unrelated provider transforms.
