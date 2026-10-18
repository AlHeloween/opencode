import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { displayHealth, memberKey, validateChain } from "@/provider/model-chain/chain"
import { chainHealthState } from "@/provider/model-chain/health-registry"
import { loadChain, saveChain } from "@/provider/model-chain/store"
import { Authorization } from "./auth"
import * as Log from "@opencode-ai/core/util/log"
import { isListMember, readGlobalRecents } from "@/session/global-recents"

const log = Log.create({ service: "chain" })

const root = "/chain"

export const ChainPaths = {
  get: `${root}/:scope/:agent`,
  set: `${root}/:scope/:agent`,
}

const ChainMemberSchema = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.optional(Schema.String),
}).annotate({ identifier: "ChainMember" })

const ChainHealthSchema = Schema.Struct({
  key: Schema.String,
  status: Schema.String,
  reason: Schema.optional(Schema.String),
}).annotate({ identifier: "ChainHealth" })

const ChainGetResult = Schema.Struct({
  scope: Schema.String,
  agent: Schema.String,
  members: Schema.Array(ChainMemberSchema),
  health: Schema.Array(ChainHealthSchema),
}).annotate({ identifier: "ChainGetResult" })

const ChainSetInput = Schema.Struct({
  members: Schema.Array(ChainMemberSchema),
}).annotate({ identifier: "ChainSetInput" })

export const ChainApi = HttpApi.make("chain")
  .add(
    HttpApiGroup.make("chain")
      .add(
        HttpApiEndpoint.get("get", `${root}/:scope/:agent`, {
          params: Schema.Struct({ scope: Schema.String, agent: Schema.String }),
          success: ChainGetResult,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chain.get",
            summary: "Get model chain",
            description:
              "Read ONE layer's explicit model chain (primary + backups) with per-member health. No parent is consulted.",
          }),
        ),
        HttpApiEndpoint.put("set", `${root}/:scope/:agent`, {
          params: Schema.Struct({ scope: Schema.String, agent: Schema.String }),
          payload: ChainSetInput,
          success: ChainGetResult,
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chain.set",
            summary: "Set model chain",
            description:
              "Replace ONE layer's explicit model chain. The same route the TUI dialog and the web form share.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "chain",
          description: "Explicit model chains (primary + backups) with failover health.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

function view(scope: string, agent: string) {
  const members = loadChain(scope, agent) ?? []
  const health = chainHealthState()
  return {
    scope,
    agent,
    members,
    health: members.map((member) => {
      const entry = health.get(memberKey(member))
      return {
        key: memberKey(member),
        status: displayHealth(member, health),
        ...(entry?.reason ? { reason: entry.reason } : {}),
      }
    }),
  }
}

export const chainHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const get = Effect.fn("ChainHttpApi.get")(function* (ctx: {
      params: { scope: string; agent: string }
    }) {
      return view(ctx.params.scope, ctx.params.agent)
    })

    const set = Effect.fn("ChainHttpApi.set")(function* (ctx: {
      params: { scope: string; agent: string }
      payload: { members: ReadonlyArray<{ providerID: string; modelID: string; variant?: string }> }
    }) {
      const members = validateChain(ctx.payload.members)
      if (members.length === 0) return yield* Effect.fail(new HttpApiError.BadRequest({}))
      // t87 decision 2: write-gated AND use-gated. Existing out-of-list rows are
      // kept (history, never deleted); only the write of a new one is refused.
      const writeRecents = yield* Effect.tryPromise({
        try: () => readGlobalRecents(),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (writeRecents !== undefined) {
        const refused = members.filter((member) => !isListMember(member, writeRecents))
        if (refused.length > 0) {
          log.warn("bug: chain write not in global recents", {
            scope: ctx.params.scope,
            agent: ctx.params.agent,
            refused: refused.map((member) => `${member.providerID}/${member.modelID}`),
          })
          return yield* Effect.fail(new HttpApiError.BadRequest({}))
        }
      }
      saveChain(ctx.params.scope, ctx.params.agent, members)
      return view(ctx.params.scope, ctx.params.agent)
    })

    return HttpApiBuilder.group(ChainApi, "chain", (handlers) => handlers.handle("get", get).handle("set", set))
  }),
)
