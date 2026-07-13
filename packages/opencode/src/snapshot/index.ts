import { Effect, Layer, Context, Schema } from "effect"
import { withStatics } from "@/util/schema"
import { zod } from "@/util/effect-zod"

export const Patch = Schema.Struct({
  hash: Schema.String,
  files: Schema.mutable(Schema.Array(Schema.String)),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Patch = typeof Patch.Type

export const FileDiff = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
})
  .annotate({ identifier: "SnapshotFileDiff" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type FileDiff = typeof FileDiff.Type

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly cleanup: () => Effect.Effect<void>
  readonly track: (files?: string[]) => Effect.Effect<string | undefined>
  readonly opId: () => Effect.Effect<string | undefined>
  readonly opRestore: (opId: string) => Effect.Effect<void>
  readonly patch: (hash: string) => Effect.Effect<Patch>
  readonly restore: (snapshot: string) => Effect.Effect<void>
  readonly revert: (patches: Patch[]) => Effect.Effect<void>
  readonly diff: (hash: string) => Effect.Effect<string>
  readonly diffFull: (from: string, to: string) => Effect.Effect<FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Snapshot") {}

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.die(
    new Error("Snapshot.Service layer not provided. Use SnapshotFossil.defaultLayer instead."),
  ),
)

export * as Snapshot from "./index"
