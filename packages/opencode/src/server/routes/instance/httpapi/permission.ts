import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { SessionID } from "@/session/schema"
import { AppRuntime } from "@/effect/app-runtime"
import * as InstanceState from "@/effect/instance-state"
import { Instance } from "@/project/instance"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"

const root = "/permission"

const ReplyQuery = Schema.Struct({
  sessionID: Schema.optional(SessionID),
})

export const PermissionApi = HttpApi.make("permission")
  .add(
    HttpApiGroup.make("permission")
      .add(
        HttpApiEndpoint.get("list", root, {
          success: Schema.Array(Permission.Request),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.list",
            summary: "List pending permissions",
            description: "Get all pending permission requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
          params: { requestID: PermissionID },
          query: ReplyQuery,
          payload: Permission.ReplyBody,
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.reply",
            summary: "Respond to permission request",
            description: "Approve or deny a permission request from the AI assistant.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "permission",
          description: "Experimental HttpApi permission routes.",
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

export const permissionHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () => AppRuntime.runPromise(Permission.Service.use((svc) => svc.list()))),
      )
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionID }
      query: typeof ReplyQuery.Type
      payload: Permission.ReplyBody
    }) {
      const instance = yield* InstanceState.context
      const sessionID = ctx.query.sessionID
        ? Schema.decodeSync(SessionID)(ctx.query.sessionID)
        : undefined
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Permission.Service.use((svc) =>
              svc.reply({
                requestID: ctx.params.requestID,
                sessionID,
                reply: ctx.payload.reply,
                message: ctx.payload.message,
              }),
            ),
          ),
        ),
      )
      return true
    })

    return HttpApiBuilder.group(PermissionApi, "permission", (handlers) =>
      handlers.handle("list", list).handle("reply", reply),
    )
  }),
).pipe(Layer.provide(Permission.defaultLayer))
