import z from "zod"
import { and, ne } from "drizzle-orm"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { which } from "../util/which"
import { ProjectID } from "./schema"
import { Effect, Layer, Path, Scope, Context, Stream, Types, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Hash } from "@opencode-ai/core/util/hash"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { existsSync, readdirSync } from "fs"
import path from "path"
import { init } from "#db"

const log = Log.create({ service: "project" })

const projectWorktrees = new Map<ProjectID, string>()

export function getProjectWorktrees(): Map<ProjectID, string> {
  return projectWorktrees
}

export function clearProjectWorktrees(): void {
  projectWorktrees.clear()
}

const ProjectVcs = Schema.Literal("git")

const ProjectIcon = Schema.Struct({
  url: Schema.optional(Schema.String),
  override: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
})

const ProjectCommands = Schema.Struct({
  start: Schema.optional(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
})

const ProjectTime = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
  initialized: Schema.optional(Schema.Number),
})

export const Info = Schema.Struct({
  id: ProjectID,
  worktree: Schema.String,
  vcs: Schema.optional(ProjectVcs),
  name: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIcon),
  commands: Schema.optional(ProjectCommands),
  time: ProjectTime,
  sandboxes: Schema.Array(Schema.String),
})
  .annotate({ identifier: "Project" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const Event = {
  Updated: BusEvent.define("project.updated", Info),
}

type Row = typeof ProjectTable.$inferSelect

export function fromRow(row: Row): Info {
  const icon =
    row.icon_url || row.icon_url_override || row.icon_color
      ? {
          url: row.icon_url ?? undefined,
          override: row.icon_url_override ?? undefined,
          color: row.icon_color ?? undefined,
        }
      : undefined
  return {
    id: row.id,
    worktree: row.worktree,
    vcs: row.vcs ? Schema.decodeUnknownSync(ProjectVcs)(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
    commands: row.commands ?? undefined,
  }
}

function infoToInsertValues(info: Info) {
  return {
    id: info.id,
    worktree: info.worktree,
    vcs: info.vcs ?? null,
    name: info.name ?? null,
    icon_url: info.icon?.url ?? null,
    icon_url_override: info.icon?.override ?? null,
    icon_color: info.icon?.color ?? null,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_initialized: info.time.initialized ?? null,
    sandboxes: info.sandboxes,
    commands: info.commands ?? null,
  }
}

export const UpdateInput = z.object({
  projectID: ProjectID.zod,
  name: z.string().optional(),
  icon: zod(ProjectIcon).optional(),
  commands: zod(ProjectCommands).optional(),
})
export type UpdateInput = z.infer<typeof UpdateInput>

export const UpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIcon),
  commands: Schema.optional(ProjectCommands),
})
  .annotate({ identifier: "ProjectUpdateInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type UpdatePayload = Types.DeepMutable<Schema.Schema.Type<typeof UpdatePayload>>

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  readonly fromDirectory: (directory: string) => Effect.Effect<{ project: Info; sandbox: string }>
  readonly discover: (input: Info) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: ProjectID) => Effect.Effect<Info | undefined>
  readonly update: (input: UpdateInput) => Effect.Effect<Info>
  readonly initGit: (input: { directory: string; project: Info }) => Effect.Effect<Info>
  readonly setInitialized: (id: ProjectID) => Effect.Effect<void>
  readonly sandboxes: (id: ProjectID) => Effect.Effect<string[]>
  readonly addSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
  readonly removeSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Project") {}

type GitResult = { code: number; text: string; stderr: string }

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const pathSvc = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    const git = Effect.fnUntraced(
      function* (args: string[], opts?: { cwd?: string }) {
        const handle = yield* spawner.spawn(
          ChildProcess.make("git", args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
        )
        const [text, stderr] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        return { code, text, stderr } satisfies GitResult
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" } satisfies GitResult)),
    )

    const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
      Effect.sync(() => Database.use(fn))

    const projectDb = <T>(id: ProjectID, fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
      Effect.sync(() => {
        const worktree = projectWorktrees.get(id)
        if (!worktree) throw new Error(`No worktree found for project ${id}`)
        return Database.projectUse(id, worktree, fn)
      })

    const emitUpdated = (data: Info) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          project: data.id,
          payload: { type: Event.Updated.type, properties: data },
        }),
      )

    const fakeVcs = Schema.decodeUnknownSync(Schema.optional(ProjectVcs))(Flag.OPENCODE_FAKE_VCS)

    const resolveGitPath = (cwd: string, name: string) => {
      if (!name) return cwd
      name = name.replace(/[\r\n]+$/, "")
      if (!name) return cwd
      name = AppFileSystem.windowsPath(name)
      if (pathSvc.isAbsolute(name)) return pathSvc.normalize(name)
      return pathSvc.resolve(cwd, name)
    }

    const scope = yield* Scope.Scope

    const pathProjectID = (dir: string) => ProjectID.make(Hash.fast(pathSvc.normalize(dir)))

    const hasLocalProjectBoundary = (dir: string) =>
      existsSync(Database.getProjectDbPath(dir)) ||
      existsSync(pathSvc.join(dir, "opencode.json")) ||
      existsSync(pathSvc.join(dir, "opencode.jsonc")) ||
      existsSync(pathSvc.join(dir, "bin", "opencode.json")) ||
      existsSync(pathSvc.join(dir, "bin", "opencode.jsonc"))

    const readCachedProjectId = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readFileString(pathSvc.join(dir, "opencode")).pipe(
        Effect.map((x) => x.trim()),
        Effect.map(ProjectID.make),
        Effect.catch(() => Effect.void),
      )
    })

    const fromDirectory = Effect.fn("Project.fromDirectory")(function* (directory: string) {
      log.info("fromDirectory", { directory })

      // Phase 1: discover git info
      type DiscoveryResult = { id: ProjectID; worktree: string; sandbox: string; vcs: Info["vcs"] }

      const data: DiscoveryResult = yield* Effect.gen(function* () {
        const local = importFromDisk(directory)
        // Only trust a previously-imported project if it was discovered as git.
        // Non-git projects (vcs: null/fakeVcs) may have been cached before a .git
        // directory existed — re-check so sessions with the git root-commit
        // project ID become visible in the session list.
        if (local && local.vcs === "git") {
          return {
            id: local.id,
            worktree: pathSvc.normalize(directory),
            sandbox: pathSvc.normalize(directory),
            vcs: local.vcs,
          }
        }

        if (hasLocalProjectBoundary(directory)) {
          return {
            id: pathProjectID(directory),
            worktree: pathSvc.normalize(directory),
            sandbox: pathSvc.normalize(directory),
            vcs: fakeVcs,
          }
        }

        const dotgitMatches = yield* fs.up({ targets: [".git"], start: directory }).pipe(Effect.orDie)
        const dotgit = dotgitMatches[0]

        if (!dotgit) {
          return {
            id: pathProjectID(directory),
            worktree: pathSvc.normalize(directory),
            sandbox: pathSvc.normalize(directory),
            vcs: fakeVcs,
          }
        }

        let sandbox = pathSvc.dirname(dotgit)
        const gitBinary = yield* Effect.sync(() => which("git"))
        let id = yield* readCachedProjectId(dotgit)

        if (!gitBinary) {
          return {
            id: id ?? pathProjectID(sandbox),
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }

        const commonDir = yield* git(["rev-parse", "--git-common-dir"], { cwd: sandbox })
        if (commonDir.code !== 0) {
          return {
            id: id ?? pathProjectID(sandbox),
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }
        const common = resolveGitPath(sandbox, commonDir.text.trim())
        const bareCheck = yield* git(["config", "--bool", "core.bare"], { cwd: sandbox })
        const isBareRepo = bareCheck.code === 0 && bareCheck.text.trim() === "true"
        const worktree = common === sandbox ? sandbox : isBareRepo ? common : pathSvc.dirname(common)

        if (id == null) {
          id = yield* readCachedProjectId(common)
        }

        if (!id) {
          const revList = yield* git(["rev-list", "--max-parents=0", "HEAD"], { cwd: sandbox })
          const roots = revList.text
            .split("\n")
            .filter(Boolean)
            .map((x) => x.trim())
            .toSorted()

          id = roots[0] ? ProjectID.make(roots[0]) : undefined
          if (id) {
            yield* fs.writeFileString(pathSvc.join(common, "opencode"), id).pipe(Effect.ignore)
          }
        }

        if (!id) {
          return { id: pathProjectID(sandbox), worktree: sandbox, sandbox, vcs: "git" as const }
        }

        const topLevel = yield* git(["rev-parse", "--show-toplevel"], { cwd: sandbox })
        if (topLevel.code !== 0) {
          return {
            id,
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }
        sandbox = resolveGitPath(sandbox, topLevel.text.trim())

        return { id, sandbox, worktree, vcs: "git" as const }
      })

      // Build project from discovery data only (no DB access).
      // Persistence (merge with existing row, upsert, session migration) is handled
      // by persistDiscovery() after initFromWorktree in instance.ts.
      const result: Info = {
        id: data.id,
        worktree: data.worktree,
        vcs: data.vcs,
        sandboxes: data.sandbox !== data.worktree ? [data.sandbox] : [],
        time: { created: Date.now(), updated: Date.now() },
      }
      projectWorktrees.set(data.id, data.worktree)
      // Persist project to its own DB
      yield* Effect.sync(() =>
        Database.projectUse(data.id, data.worktree, (db) => {
          // Read existing row to merge sandboxes
          const existing = db.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get()
          const mergedSandboxes = existing
            ? [...new Set([...existing.sandboxes, ...result.sandboxes])]
            : result.sandboxes
          result.sandboxes = mergedSandboxes
          db.insert(ProjectTable)
            .values(infoToInsertValues(result))
            .onConflictDoUpdate({
              target: ProjectTable.id,
              set: {
                worktree: result.worktree,
                vcs: result.vcs ?? null,
                name: result.name ?? null,
                icon_url: result.icon?.url ?? null,
                icon_url_override: result.icon?.override ?? null,
                icon_color: result.icon?.color ?? null,
                time_updated: result.time.updated,
                sandboxes: mergedSandboxes,
                commands: result.commands ?? null,
              },
            })
            .run()
        }),
      )
      // Filter sandboxes by filesystem existence
      result.sandboxes = yield* Effect.forEach(
        result.sandboxes,
        (s) =>
          fs.exists(s).pipe(
            Effect.orDie,
            Effect.map((exists) => (exists ? s : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))

      yield* emitUpdated(result)
      return { project: result, sandbox: data.sandbox }
    })

    const discover = Effect.fn("Project.discover")(function* (input: Info) {
      if (input.vcs !== "git") return
      if (input.icon?.override) return
      if (input.icon?.url) return

      const matches = yield* fs
        .glob("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
          cwd: input.worktree,
          absolute: true,
          include: "file",
        })
        .pipe(Effect.orDie)
      const shortest = matches.sort((a, b) => a.length - b.length)[0]
      if (!shortest) return

      const buffer = yield* fs.readFile(shortest).pipe(Effect.orDie)
      const base64 = Buffer.from(buffer).toString("base64")
      const mime = AppFileSystem.mimeType(shortest)
      const url = `data:${mime};base64,${base64}`
      yield* update({ projectID: input.id, icon: { url } })
    })

    const list = Effect.fn("Project.list")(function* () {
      const entries = yield* Effect.sync(() => [...projectWorktrees.entries()])
      const results: Info[] = []
      for (const [id, worktree] of entries) {
        const row = yield* Effect.sync(() =>
          Database.projectUse(id, worktree, (d) =>
            d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get(),
          ),
        )
        if (row) results.push(fromRow(row))
      }
      return results
    })

    const get = Effect.fn("Project.get")(function* (id: ProjectID) {
      const worktree = projectWorktrees.get(id)
      if (!worktree) return undefined
      const row = yield* Effect.sync(() =>
        Database.projectUse(id, worktree, (d) =>
          d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get(),
        ),
      )
      return row ? fromRow(row) : undefined
    })

    const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
      const worktree = projectWorktrees.get(input.projectID)
      if (!worktree) throw new Error(`No worktree found for project ${input.projectID}`)
      const result = yield* Effect.sync(() =>
        Database.projectUse(input.projectID, worktree, (d) =>
          d
            .update(ProjectTable)
            .set({
              name: input.name,
              icon_url: input.icon?.url,
              icon_url_override: input.icon?.override,
              icon_color: input.icon?.color,
              commands: input.commands,
              time_updated: Date.now(),
            })
            .where(eq(ProjectTable.id, input.projectID))
            .returning()
            .get(),
        ),
      )
      if (!result) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(result)
      yield* emitUpdated(data)
      return data
    })

    const initGit = Effect.fn("Project.initGit")(function* (input: { directory: string; project: Info }) {
      if (input.project.vcs === "git") return input.project
      if (!(yield* Effect.sync(() => which("git")))) throw new Error("Git is not installed")
      const result = yield* git(["init", "--quiet"], { cwd: input.directory })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.text.trim() || "Failed to initialize git repository")
      }
      const { project } = yield* fromDirectory(input.directory)
      return project
    })

    const setInitialized = Effect.fn("Project.setInitialized")(function* (id: ProjectID) {
      const worktree = projectWorktrees.get(id)
      if (!worktree) throw new Error(`No worktree found for project ${id}`)
      yield* Effect.sync(() =>
        Database.projectUse(id, worktree, (d) =>
          d.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
        ),
      )
    })

    const sandboxes = Effect.fn("Project.sandboxes")(function* (id: ProjectID) {
      const worktree = projectWorktrees.get(id)
      if (!worktree) return []
      const row = yield* Effect.sync(() =>
        Database.projectUse(id, worktree, (d) =>
          d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get(),
        ),
      )
      if (!row) return []
      const data = fromRow(row)
      return yield* Effect.forEach(
        data.sandboxes,
        (dir) =>
          fs.isDir(dir).pipe(
            Effect.orDie,
            Effect.map((ok) => (ok ? dir : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))
    })

    const addSandbox = Effect.fn("Project.addSandbox")(function* (id: ProjectID, directory: string) {
      const worktree = projectWorktrees.get(id)
      if (!worktree) throw new Error(`No worktree found for project ${id}`)
      const row = yield* Effect.sync(() =>
        Database.projectUse(id, worktree, (d) =>
          d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get(),
        ),
      )
      if (!row) throw new Error(`Project not found: ${id}`)
      const sboxes = [...row.sandboxes]
      if (!sboxes.includes(directory)) sboxes.push(directory)
      const result = yield* Effect.sync(() =>
        Database.projectUse(id, worktree, (d) =>
          d
            .update(ProjectTable)
            .set({ sandboxes: sboxes, time_updated: Date.now() })
            .where(eq(ProjectTable.id, id))
            .returning()
            .get(),
        ),
      )
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    const removeSandbox = Effect.fn("Project.removeSandbox")(function* (id: ProjectID, directory: string) {
      const worktree = projectWorktrees.get(id)
      if (!worktree) throw new Error(`No worktree found for project ${id}`)
      const row = yield* Effect.sync(() =>
        Database.projectUse(id, worktree, (d) =>
          d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get(),
        ),
      )
      if (!row) throw new Error(`Project not found: ${id}`)
      const sboxes = row.sandboxes.filter((s) => s !== directory)
      const result = yield* Effect.sync(() =>
        Database.projectUse(id, worktree, (d) =>
          d
            .update(ProjectTable)
            .set({ sandboxes: sboxes, time_updated: Date.now() })
            .where(eq(ProjectTable.id, id))
            .returning()
            .get(),
        ),
      )
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    return Service.of({
      fromDirectory,
      discover,
      list,
      get,
      update,
      initGit,
      setInitialized,
      sandboxes,
      addSandbox,
      removeSandbox,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(NodePath.layer),
)

export function list() {
  const results: Info[] = []
  const seen = new Set<string>()

  // Read all known projects from the in-memory map
  for (const [id, worktree] of projectWorktrees) {
    if (seen.has(id)) continue
    try {
      const row = Database.projectUse(id, worktree, (db) =>
        db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get(),
      )
      if (row && !seen.has(row.id)) {
        seen.add(row.id)
        results.push(fromRow(row))
      }
    } catch {
      // project DB may not be accessible
    }
  }

  return results
}

export function get(id: ProjectID): Info | undefined {
  const worktree = projectWorktrees.get(id)
  if (!worktree) return undefined
  try {
    const row = Database.projectUse(id, worktree, (db) =>
      db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get(),
    )
    if (!row) return undefined
    return fromRow(row)
  } catch {
    return undefined
  }
}

export function setInitialized(id: ProjectID) {
  const worktree = projectWorktrees.get(id)
  if (!worktree) return
  Database.projectUse(id, worktree, (db) =>
    db.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
  )
}

/**
 * Persist a newly discovered project into the project's own DB.
 * Reads the existing project row (if any) to preserve name/icon/timestamps,
 * merges with new discovery data, upserts, and migrates orphan sessions.
 * Must be called within a project context (Database.withProject).
 */
export function persistDiscovery(result: Info, worktree: string) {
  Database.use((db) => {
    // Read existing project row to preserve name/icon/timestamps
    const row = db.select().from(ProjectTable).where(eq(ProjectTable.id, result.id)).get()
    const existing = row ? fromRow(row) : result

    // Merge: preserve existing name/icon/timestamps, update worktree/vcs/sandboxes
    const merged: Info = {
      ...existing,
      worktree: result.worktree,
      vcs: result.vcs,
      sandboxes: [...new Set([...existing.sandboxes, ...result.sandboxes])],
      time: { ...existing.time, updated: Date.now() },
    }

    // Upsert into the current project DB (already scoped by Database.withProject)
    db.insert(ProjectTable)
      .values(infoToInsertValues(merged))
      .onConflictDoUpdate({
        target: ProjectTable.id,
        set: {
          worktree: merged.worktree,
          vcs: merged.vcs ?? null,
          name: merged.name ?? null,
          icon_url: merged.icon?.url ?? null,
          icon_url_override: merged.icon?.override ?? null,
          icon_color: merged.icon?.color ?? null,
          time_updated: merged.time.updated,
          time_initialized: merged.time.initialized ?? null,
          sandboxes: merged.sandboxes,
          commands: merged.commands ?? null,
        },
      })
      .run()

    // Migrate orphan sessions to the discovered project ID.
    // Covers: (a) sessions with global project ID (pre-discovery),
    //         (b) sessions with a stale project ID from a prior discovery
    //             that produced a different ID (e.g. path-hash vs git root-commit).
    if (merged.id !== ProjectID.global) {
      db.update(SessionTable)
        .set({ project_id: merged.id })
        .where(and(
          eq(SessionTable.directory, worktree),
          ne(SessionTable.project_id, merged.id),
        ))
        .run()
    }
  })
}

/**
 * Discover and import a project from an existing on-disk database.
 * Checks if `{worktree}/.opencode/data/opencode.db` exists, validates
 * it's an opencode database, reads project metadata, and returns it.
 */
export function importFromDisk(worktree: string): Info | undefined {
  const dbPath = Database.getProjectDbPath(worktree)
  if (!existsSync(dbPath)) return undefined

  let db: ReturnType<typeof init> | undefined
  try {
    db = init(dbPath)
    // Validate it's an opencode database by checking for expected tables
    const sqlite = db.$client as {
      prepare: (sql: string) => { all: () => Array<{ name: string }> }
    }
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('project', 'session')")
      .all()
    if (tables.length < 2) return undefined

    // Read project metadata from the per-project DB
    const row = db.select().from(ProjectTable).get()
    if (!row) return undefined

    const info = fromRow(row)
    projectWorktrees.set(info.id, worktree)
    log.info("imported project from disk", { id: info.id, worktree })
    return info
  } catch (err) {
    log.warn("bug: failed to import project from disk", { worktree, error: String(err) })
    return undefined
  } finally {
    if (db) {
      try { (db.$client as { close: () => void }).close() } catch { /* best effort */ }
    }
  }
}

export * as Project from "./project"
