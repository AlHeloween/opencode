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

/** Lightweight structural impact summary from codegraph analysis. */
export const ImpactSummary = Schema.Struct({
  /** Commit hashes compared */
  from: Schema.String,
  to: Schema.String,
  /** Files changed in this range */
  changedFiles: Schema.Number,
  /** Symbol counts by kind, e.g. {"function": 5, "class": 3} */
  symbolCountByKind: Schema.Record(Schema.String, Schema.Number),
  /** Top symbols touched (name + kind, max 10) */
  topSymbols: Schema.mutable(Schema.Array(Schema.String)),
  /** Files outside the change set that reference changed symbols */
  impactedFiles: Schema.mutable(Schema.Array(Schema.String)),
  /** Total cross-file caller references found */
  callerCount: Schema.Number,
})
  .annotate({ identifier: "SnapshotImpactSummary" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ImpactSummary = typeof ImpactSummary.Type

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly cleanup: () => Effect.Effect<void>
  readonly track: (files?: string[]) => Effect.Effect<string | undefined>
  /** Current snapshot hash for undo/rollback */
  readonly checkpoint: () => Effect.Effect<string | undefined>
  /** Restore working copy to a previous checkpoint */
  readonly checkout: (checkpoint: string) => Effect.Effect<void>
  /** @deprecated — use checkpoint() */
  readonly opId: () => Effect.Effect<string | undefined>
  /** @deprecated — use checkout() */
  readonly opRestore: (opId: string) => Effect.Effect<void>
  readonly patch: (hash: string) => Effect.Effect<Patch>
  readonly restore: (snapshot: string) => Effect.Effect<void>
  readonly revert: (patches: Patch[]) => Effect.Effect<void>
  readonly diff: (hash: string) => Effect.Effect<string>
  /** Optional `paths` scopes the fossil range to selected files (absolute or worktree-relative). */
  readonly diffFull: (from: string, to: string, paths?: readonly string[]) => Effect.Effect<FileDiff[]>
  /**
   * Structural impact between two snapshots via CodeGraph MCP only.
   * Hard-fails if MCP unavailable or index missing — never soft-returns empty success.
   */
  readonly impact: (from: string, to: string) => Effect.Effect<ImpactSummary>
  /**
   * Read the sym tag from the current fossil checkout.
   * Hard-fails if tag/MCP metadata missing — never soft-returns undefined success.
   */
  readonly lastImpact: () => Effect.Effect<ImpactSummary>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Snapshot") {}

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.die(
    new Error("Snapshot.Service layer not provided. Use SnapshotFossil.defaultLayer instead."),
  ),
)

export * as Snapshot from "./index"
