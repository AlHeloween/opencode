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
  /**
   * THREE LISTS, THREE QUESTIONS — kept apart because a reader cannot tell them apart once
   * merged, and each is blind to something the others see.
   *
   * - `transcript` — files the session's TOOLS touched. Sees reads, which leave no other trace;
   *   blind to any writer that was not a tool in this session.
   * - `snapshot` — files the undo/redo anchors say changed between the range's boundaries. Sees
   *   everything committed in the range from any writer; blind to uncommitted working-copy edits,
   *   and absent entirely when the repo has no snapshot anchors.
   * - `mtime` — files the CodeGraph index says were WRITTEN while the range ran. Sees the
   *   working copy directly, so it catches a user edit, a formatter, or another agent's work that
   *   left neither an anchor nor a tool entry; blind to a file whose mtime has since moved, because
   *   the index holds the CURRENT mtime and not a history.
   *
   * Optional because rows written before this field existed must still parse.
   */
  sources: Schema.optional(
    Schema.Struct({
      // mutable, like `topSymbols` above: the producer builds these with a spread and a Set, and a
      // readonly array would make every caller that composes one fail on the type alone.
      transcript: Schema.mutable(Schema.Array(Schema.String)),
      snapshot: Schema.mutable(Schema.Array(Schema.String)),
      mtime: Schema.mutable(Schema.Array(Schema.String)),
    }),
  ),
})
  .annotate({ identifier: "SnapshotImpactSummary" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ImpactSummary = typeof ImpactSummary.Type

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly cleanup: () => Effect.Effect<void>
  /** `sign` rides the commit message, so a snapshot taken at a reply that wrote a semantic vector
   *  is ADDRESSABLE by that vector — see `vectorSign`. Optional: an unsigned snapshot is normal. */
  readonly track: (files?: string[], sign?: string) => Effect.Effect<string | undefined>
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
  /**
   * Full-tree undo to a single Fossil checkin (session undo).
   * `preserveFiles` absolute paths: capture content before checkout, write back after
   * (user-edited conflict files).
   */
  readonly revertTo: (
    targetHash: string,
    opts?: { preserveFiles?: readonly string[] },
  ) => Effect.Effect<void>
  /** @deprecated Prefer revertTo — implemented as full-tree checkout to patches[0].hash */
  readonly revert: (patches: Patch[]) => Effect.Effect<void>
  readonly diff: (hash: string) => Effect.Effect<string>
  /** Optional `paths` scopes the fossil range to selected files (absolute or worktree-relative). Omit `to` to diff `from` against the working copy. */
  readonly diffFull: (from: string, to?: string, paths?: readonly string[]) => Effect.Effect<FileDiff[]>
  /**
   * Structural impact between two snapshots via CodeGraph MCP only.
   * Hard-fails if MCP unavailable or index missing — never soft-returns empty success.
   */
  readonly impact: (from: string, to: string) => Effect.Effect<ImpactSummary>
  /**
   * Impact of the LAST snapshot: the brief from fossil (`diff --brief` parent → checkout) and the
   * elements from the readonly CodeGraph SQLite pack over those files — no MCP, no `sym` tag.
   * Hard-fails when the CodeGraph index is missing — never soft-returns an empty success.
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
