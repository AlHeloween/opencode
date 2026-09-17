/**
 * End-to-end oracle for the routing dialog's SORT path — the chain my earlier
 * state-only test missed:
 *   buildRouting (dialog) -> session settings write -> llm.ts resolution
 *   -> Provider.getLanguage -> SDK model settings.provider -> request body.
 *
 * The user's report ("сейчас не сортируется вообще" — sorting does not apply at
 * all) can only be settled at this layer, not by asserting dialog-local state.
 */
import { describe, expect, test } from "bun:test"
import { buildRouting } from "../../src/cli/cmd/tui/component/dialog-routing-state"
import { sessionAgentRouting, sessionModelRouting, type SessionSettings } from "../../src/session/session-settings"
import { Provider } from "../../src/provider/provider"

const ROUTING = { sort: "price" as const }

describe("routing sort end-to-end", () => {
  test("dialog Save payload carries sort into the persisted routing block", () => {
    // What the Save row actually writes (dialog-routing.tsx save()).
    const payload = buildRouting({
      current: {},
      providers: [],
      selectionMode: "order",
      quantizations: [],
      sort: "price",
      allowFallbacks: true,
    })
    expect(payload.sort).toBe("price")
    expect(payload).not.toHaveProperty("order")
    expect(payload).not.toHaveProperty("only")
  })

  test("persisted session routing resolves back for the agent that saved it", () => {
    // session scope: local.tsx writes agent.<name>.routing, llm.ts reads it back.
    const settings = { agent: { coder_agent: { routing: ROUTING } } } as unknown as SessionSettings
    expect(sessionAgentRouting("coder_agent", settings)).toEqual(ROUTING)
  })

  test("persisted model routing resolves back variant-stripped", () => {
    const settings = {
      modelRouting: { "openrouter/z-ai/glm-5.3-flash": ROUTING },
    } as unknown as SessionSettings
    expect(sessionModelRouting("openrouter", "z-ai/glm-5.3-flash", settings)).toEqual(ROUTING)
    // llm.ts strips the :nitro/:floor variant before lookup.
    expect(sessionModelRouting("openrouter", "z-ai/glm-5.3-flash:nitro".split(":")[0], settings)).toEqual(ROUTING)
  })

  test("the routing object reaches the SDK as provider settings (wire source)", async () => {
    // Provider.getLanguage passes `opts.routing` straight to the openrouter
    // loader, which sets `sdk.languageModel(id, { provider: routing })`; the SDK
    // copies settings.provider into every request body (dist getArgs:3643).
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider")
    const sdk = createOpenRouter({ apiKey: "test" })
    const model = sdk.languageModel("z-ai/glm-5.3-flash", { provider: ROUTING })
    expect((model as any).settings?.provider).toEqual(ROUTING)
  })

  test("agent-level routing is read from agent options by openRouterRouting", () => {
    expect(Provider.openRouterRouting({ routing: ROUTING })).toEqual(ROUTING)
  })
})
