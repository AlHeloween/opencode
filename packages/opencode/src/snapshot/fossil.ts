import { Duration, Effect, Layer, Schedule, Semaphore, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Service as SnapshotService, type Interface, type Patch, type FileDiff, type ImpactSummary } from "."
import { hasCodegraphIndex, mcpTouchThenSqlitePack } from "@/codegraph/mcp-client"
import { packToImpactFields } from "@/codegraph/sqlite-pack"

const log = Log.create({ service: "snapshot-fossil" })

function currentHash(text: string): string | undefined {
  return text.match(/^checkout:\s+([a-f0-9]+)/m)?.[1] ?? text.match(/^hash:\s+([a-f0-9]+)/m)?.[1]
}

/** Parse structural tag value from `fossil tag list CHECKIN` output (`sym=VALUE` or `sym VALUE`). */
function parseSymTagValue(tagListText: string): string | undefined {
  for (const line of tagListText.split("\n")) {
    const t = line.trim()
    // Prefer name=value (current fossil list format)
    const eq = t.match(/^sym=(.+)$/)
    if (eq?.[1]) return eq[1].trim()
    // Legacy / alternate: "sym  value"
    if (t.startsWith("sym ") || t.startsWith("sym\t")) {
      const v = t.slice(3).trim()
      if (v) return v
    }
  }
  return undefined
}

// Find fossil binary: tools/ relative to executable, then PATH.
// Probe both `fossil` and `fossil.exe` so Windows tools/ and Linux PATH/symlinks work.
function findFossil(): string {
  const fs = require("fs") as typeof import("fs")
  const names = process.platform === "win32" ? ["fossil.exe", "fossil"] : ["fossil", "fossil.exe"]
  const dirs = [
    path.join(path.dirname(process.execPath), "tools"),
    path.join(Global.Path.home, "tools"),
    path.join(path.resolve(import.meta.dirname!, "..", "..", "..", ".."), "external", "fossil"),
  ]
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return "fossil"
}

const FOSSIL_BIN = findFossil()

/** Clear open-tree markers (Windows `_FOSSIL_`, Unix `_fossil`). Independent of git. */
function clearCheckoutMarkers(fs: AppFileSystem.Interface, worktree: string) {
  return Effect.gen(function* () {
    yield* fs.remove(path.join(worktree, "_FOSSIL_")).pipe(Effect.catch(() => Effect.void))
    yield* fs.remove(path.join(worktree, "_fossil")).pipe(Effect.catch(() => Effect.void))
  })
}

type State = Omit<Interface, "init">

export const layer = Layer.effect(
  SnapshotService,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const config = yield* Config.Service
    const locks = new Map<string, Semaphore.Semaphore>()

    const lock = (key: string) => {
      const hit = locks.get(key)
      if (hit) return hit
      const next = Semaphore.makeUnsafe(1)
      locks.set(key, next)
      return next
    }

    const state = yield* InstanceState.make<State>(
      Effect.fn("SnapshotFossil.state")(function* (ctx) {
        const fossilDir = path.join(ctx.worktree, ".opencode", "data", "fossil", ctx.project.id)
        const repoPath = path.join(fossilDir, "snapshot.fsl")
        const worktree = ctx.worktree
        const locked = <A, E, R>(fx: Effect.Effect<A, E, R>) => lock(fossilDir).withPermits(1)(fx)

        const enabled = Effect.fnUntraced(function* () {
          return (yield* config.get()).snapshot !== false
        })

        const fossil = Effect.fnUntraced(
          function* (args: string[], opts?: { cwd?: string }) {
            const proc = ChildProcess.make(FOSSIL_BIN, args, {
              cwd: opts?.cwd ?? worktree,
              extendEnv: true,
            })
            const handle = yield* spawner.spawn(proc)
            const [text, stderr] = yield* Effect.all(
              [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
              { concurrency: 2 },
            )
            const code = yield* handle.exitCode
            return { code, text, stderr }
          },
          Effect.scoped,
          Effect.catch((err) =>
            Effect.succeed({
              code: 1 as any,
              text: "",
              stderr: err instanceof Error ? err.message : String(err),
            }),
          ),
        )

        // Translate .gitignore patterns to Fossil ignore-glob format
        const translateGitignore = Effect.fnUntraced(function* () {
          const gitignorePath = path.join(worktree, ".gitignore")
          const content = yield* fs.readFileString(gitignorePath).pipe(Effect.catch(() => Effect.succeed("")))
          if (!content) return ""

          const lines = content.split(/\r?\n/).filter((l) => {
            const trimmed = l.trim()
            return trimmed && !trimmed.startsWith("#")
          })

          const translated: string[] = []
          for (const line of lines) {
            let p = line.trim()
            // Skip negation patterns (not supported in Fossil)
            if (p.startsWith("!")) continue
            // Remove leading / (Fossil patterns are always root-relative)
            if (p.startsWith("/")) p = p.slice(1)
            // Remove trailing / (Fossil has no directory-only distinction)
            if (p.endsWith("/")) p = p.slice(0, -1)
            // Replace **/ with nothing (* already matches / in Fossil)
            p = p.replace(/^\*\*\//, "").replace(/\/\*\*$/, "").replace(/\/\*\*\//, "/*/")
            // Replace remaining ** with *
            p = p.replace(/\*\*/g, "*")
            // Skip empty patterns
            if (!p || p === ".") continue
            translated.push(p)
          }

          return translated.join("\n")
        })

        // Ensure .fossil-settings/ignore-glob exists and is synced from .gitignore
        const ensureIgnoreGlob = Effect.fnUntraced(function* () {
          const settingsDir = path.join(worktree, ".fossil-settings")
          const ignorePath = path.join(settingsDir, "ignore-glob")

          const gitignorePatterns = yield* translateGitignore()
          // Add our own patterns
          const extraPatterns = ["*.fsl", ".jj", ".git", "_FOSSIL_", "_fossil"]
          const allPatterns = [...extraPatterns, ...gitignorePatterns.split("\n").filter(Boolean)]

          const existing = yield* fs.readFileString(ignorePath).pipe(Effect.catch(() => Effect.succeed("")))
          const content = allPatterns.join("\n") + "\n"

          if (existing === content) return

          log.info("syncing ignore-glob from .gitignore", { patterns: allPatterns.length })
          yield* fs.ensureDir(settingsDir).pipe(Effect.orDie)
          yield* fs.writeFileString(ignorePath, content).pipe(Effect.orDie)
        })

        // Self-healing bootstrap — if fossil open fails (corrupted DB), remove and reinit
        const ensureInit = Effect.fnUntraced(function* () {
          yield* ensureIgnoreGlob()

          if (yield* fs.exists(repoPath)) {
            // Fast path: if the checkout is already open and pointing to the
            // correct repository, skip `fossil open --force`. Calling open on
            // an already-open checkout in Fossil v2.28+ can trigger internal
            // branch operations that fail/hang.
            const probe = yield* fossil(["info"], { cwd: worktree }).pipe(
              Effect.catch(() => Effect.succeed({ code: -1, text: "", stderr: "" })),
            )
            const probeRepo = probe.text.match(/^repository:\s+(.+)$/m)?.[1]?.trim()
            if (
              probe.code === 0 &&
              probeRepo &&
              path.resolve(probeRepo).replaceAll("\\", "/").toLowerCase() ===
                path.resolve(repoPath).replaceAll("\\", "/").toLowerCase()
            ) {
              return true
            }

            const openResult = yield* fossil(["open", repoPath, "--force", "--keep", "--nested"], { cwd: worktree }).pipe(
              Effect.catch(() => Effect.succeed({ code: -1, text: "", stderr: "fossil process error" })),
            )
            const alreadyOpen = /already an open tree/i.test(openResult.stderr)
            if (openResult.code === 0 || alreadyOpen) {
              // `fossil open --force` is required for a non-empty worktree,
              // but it is not idempotent. Several snapshot consumers may
              // share this checkout, so verify and reuse the existing one.
              const currentResult = yield* fossil(["info"], { cwd: worktree })
              const repository = currentResult.text.match(/^repository:\s+(.+)$/m)?.[1]?.trim()
              const sameRepository =
                repository &&
                path.resolve(repository).replaceAll("\\", "/").toLowerCase() ===
                  path.resolve(repoPath).replaceAll("\\", "/").toLowerCase()
              if (currentResult.code === 0 && sameRepository) return true

              // Never close or recover an existing checkout until its
              // identity is known. It may belong to a parent worktree.
              if (alreadyOpen) {
                log.error("bug: fossil checkout conflicts with snapshot repository", {
                  repoPath,
                  repository,
                  stderr: currentResult.stderr || openResult.stderr,
                })
                return false
              }

              // A stale checkout marker can make `open --force` succeed while later
              // commands fail with "Unresolved RID values". Do not recreate
              // a healthy checkout: other services may be using it.
              yield* fossil(["close", "--force"], { cwd: worktree }).pipe(Effect.catch(() => Effect.void))
              yield* clearCheckoutMarkers(fs, worktree)
              const reopenResult = yield* fossil(["open", repoPath, "--force", "--keep", "--nested"], { cwd: worktree }).pipe(
                Effect.catch(() => Effect.succeed({ code: -1, text: "", stderr: "" })),
              )
              if (reopenResult.code === 0) return true
              log.warn("fossil reopen failed, performing atomic recovery", { stderr: reopenResult.stderr })
            } else {
              log.warn("fossil open failed, performing atomic recovery", { stderr: openResult.stderr })
            }

            // Corrupted or out-of-sync repository — recovery is scoped to
            // this checkout/repository pair and continues into reinit below.
            // Never touches project .git (including index.lock).
            yield* fossil(["close", "--force"], { cwd: worktree }).pipe(Effect.catch(() => Effect.void))
            yield* fs.remove(repoPath).pipe(Effect.catch(() => Effect.void))
            yield* clearCheckoutMarkers(fs, worktree)
            yield* fs.remove(path.join(worktree, ".fossil-settings", "ignore-glob")).pipe(Effect.catch(() => Effect.void))
          }

          log.info("initializing fossil repo", { repoPath, worktree })
          yield* fs.ensureDir(fossilDir).pipe(Effect.orDie)

          const initResult = yield* fossil(["init", repoPath], { cwd: worktree })
          if (initResult.code !== 0) {
            log.warn("fossil init failed", { stderr: initResult.stderr })
            return false
          }

          const openResult = yield* fossil(["open", repoPath, "--force", "--keep", "--nested"], { cwd: worktree })
          if (openResult.code !== 0) {
            log.warn("fossil open failed", { stderr: openResult.stderr })
            return false
          }

          // Establish a checkpointable baseline even when the worktree has
          // no files Fossil can add yet.
          const baselineResult = yield* fossil(
            ["commit", "-m", "opencode-init", "--no-warnings", "--allow-fork", "--allow-empty", "--hash"],
            { cwd: worktree },
          )
          if (baselineResult.code !== 0) {
            log.warn("bug: fossil baseline commit failed", { stderr: baselineResult.stderr })
            return false
          }

          log.info("fossil repo initialized", { repoPath })
          return true
        })

        const track = Effect.fnUntraced(function* (files?: string[]) {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* enabled())) return undefined
              if (!(yield* ensureInit())) return undefined

              // Tool-driven snapshots provide the exact changed paths. Keep
              // that path bounded: a global Fossil scan here can traverse the
              // entire worktree while the model loop is waiting to continue.
              if (files !== undefined) {
                for (const file of files) {
                  const rel = path.relative(worktree, file).replaceAll("\\", "/")
                  if (yield* fs.exists(file)) {
                    yield* fossil(["add", "--force", rel], { cwd: worktree }).pipe(
                      Effect.catch(() => Effect.void),
                    )
                    continue
                  }
                  yield* fossil(["rm", rel], { cwd: worktree }).pipe(
                    Effect.catch(() => Effect.void),
                  )
                }
              } else {
                // Manual or bootstrap tracking may intentionally reconcile the
                // whole worktree. Fossil performs that in one process rather
                // than spawning a process for every discovered file.
                yield* fossil(["addremove"], { cwd: worktree }).pipe(
                  Effect.catch(() => Effect.void),
                )
              }

              // Get current version before commit
              const before = yield* fossil(["info"], { cwd: worktree })
              const beforeHash = currentHash(before.text) ?? ""
              if (!beforeHash) log.warn("bug: fossil current hash unavailable", { stderr: before.stderr })

              // Use --allow-fork: when autosync is enabled (Fossil default),
              // commits that would create a fork are rejected unless --allow-fork
              // is passed. Since this is a snapshot system where fork topology
              // doesn't matter, always allow forking.
              const commitResult = yield* fossil(["commit", "-m", "auto-snapshot", "--no-warnings", "--allow-fork", "--hash"], {
                cwd: worktree,
              })

              if (commitResult.code !== 0) {
                log.info("tracking commit failed", { hash: beforeHash, stderr: commitResult.stderr })
                return beforeHash || undefined
              }

              // Parse new version from output
              const afterHash = (
                commitResult.text.match(/New_Version:\s+([a-f0-9]+)/)?.[1]?.trim()
                ?? commitResult.text.trim()
              ).slice(0, 40)

              log.info("tracking", { hash: afterHash, before: beforeHash })

              // Structural tagging via CodeGraph MCP only (SQLite/CLI blocked when MCP owns graph).
              // Soft-skip forbidden: if .codegraph exists, MCP failure fails this Effect (hard-fail).
              // Fossil commit already succeeded; tag failure still surfaces as track error so agents
              // never think impact ran when MCP was down.
              if (beforeHash && hasCodegraphIndex(worktree)) {
                const diff = yield* fossil(
                  ["diff", "--from", beforeHash, "--to", afterHash, "--brief"],
                  { cwd: worktree },
                )
                if (diff.code === 0 && diff.text.trim()) {
                  const changedFiles = diff.text
                    .trim()
                    .split("\n")
                    .map((l: string) => l.replace(/^[A-Z]+\s+/, "").trim())
                    .filter((f: string) => f.length > 0)
                    .map((f: string) => f.replace(/\\/g, "/"))

                  if (changedFiles.length > 0) {
                    // Hybrid: MCP touch (refresh) → SQLite pack → compact tag (not MCP prose)
                    const hybrid = yield* mcpTouchThenSqlitePack(worktree, changedFiles).pipe(
                      Effect.mapError((err) => {
                        const msg = err instanceof Error ? err.message : String(err)
                        log.error("bug: codegraph hybrid required for structural tag (hard-fail)", {
                          err: msg,
                          hash: afterHash,
                        })
                        return new Error(
                          `CodeGraph MCP→SQLite unavailable for fossil structural tag (hard-fail). ${msg}`,
                        )
                      }),
                    )
                    // fossil tag add OPTIONS TAGNAME ARTIFACT-ID ?VALUE?
                    // VALUE must come after the check-in hash — otherwise fossil
                    // treats the KINDS:… string as an artifact ID (hard fail).
                    const tagValue = hybrid.symTag
                    const tagResult = yield* fossil(
                      ["tag", "add", "--propagate", "sym", afterHash, tagValue],
                      { cwd: worktree },
                    )
                    if (tagResult.code !== 0) {
                      return yield* Effect.fail(
                        new Error(
                          `fossil tag add sym failed: ${tagResult.stderr || tagResult.text}`.trim(),
                        ),
                      )
                    }
                  }
                }
              }

              return afterHash
            }).pipe(Effect.orDie),
          )
        })

        const opId = Effect.fnUntraced(function* () {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* enabled())) return undefined
              if (!(yield* ensureInit())) return undefined
              // Fossil doesn't have a separate op log — use version hash as op ID
              const result = yield* fossil(["info"], { cwd: worktree })
              const hash = currentHash(result.text)
              return result.code === 0 ? hash : undefined
            }).pipe(Effect.orDie),
          )
        })

        const opRestore = Effect.fnUntraced(function* (targetVersion: string) {
          return yield* locked(
            Effect.gen(function* () {
              log.info("fossil checkout (opRestore)", { version: targetVersion })
              if (!(yield* ensureInit())) return
              const result = yield* fossil(["checkout", "--force", targetVersion], { cwd: worktree })
              if (result.code !== 0) {
                log.error("fossil checkout failed", { version: targetVersion, stderr: result.stderr })
                return
              }
              // Remove stale files from the previous leaf that aren't tracked
              // in the target version (fossil checkout leaves them as extras).
              yield* fossil(["clean", "--force"], { cwd: worktree })
            }).pipe(Effect.orDie),
          )
        })

        const patch = Effect.fnUntraced(function* (hash: string) {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* ensureInit())) return { hash, files: [] }
              const result = yield* fossil(["diff", "--from", hash, "--brief"], {
                cwd: worktree,
              })
              const files = result.text
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                  // "CHANGED file.txt" or "ADDED file.txt" format
                  const match = line.match(/^[A-Z]+\s+(.+)$/)
                  return match?.[1]?.trim() ?? ""
                })
                .filter(Boolean)
                .map((f) => path.join(worktree, f).replaceAll("\\", "/"))

              return { hash, files }
            }).pipe(Effect.orDie),
          )
        })

        const restore = Effect.fnUntraced(function* (snapshot: string) {
          return yield* locked(
            Effect.gen(function* () {
              log.info("restore (checkout)", { version: snapshot })
              if (!(yield* ensureInit())) return
              const result = yield* fossil(["checkout", "--force", snapshot], { cwd: worktree })
              if (result.code !== 0) {
                log.error("fossil checkout failed", { snapshot, stderr: result.stderr })
                return
              }
              // Remove stale files from the previous leaf that aren't tracked
              // in the target version (fossil checkout leaves them as extras).
              yield* fossil(["clean", "--force"], { cwd: worktree })
            }).pipe(Effect.orDie),
          )
        })

        const revert = Effect.fnUntraced(function* (patches: Patch[]) {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* ensureInit())) return

              const seen = new Set<string>()
              for (const item of patches) {
                for (const file of item.files) {
                  if (seen.has(file)) continue
                  seen.add(file)
                  const rel = path.relative(worktree, file).replaceAll("\\", "/")
                  const resolvedHash = yield* resolveHash(item.hash)
                  log.info("reverting", { file: rel, from: resolvedHash })
                  const result = yield* fossil(["revert", rel, "-r", resolvedHash], { cwd: worktree })
                  if (result.code !== 0) {
                    log.info("file not in snapshot, attempting delete", { file: rel })
                    yield* fs.remove(file).pipe(Effect.catch(() => Effect.void))
                  }
                }
              }

              // Seal the revert
              yield* fossil(["commit", "-m", "revert", "--no-warnings", "--allow-fork"], { cwd: worktree }).pipe(
                Effect.catch(() => Effect.void),
              )
            }).pipe(Effect.orDie),
          )
        })

        const diff = Effect.fnUntraced(function* (hash: string) {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* ensureInit())) return ""
              const resolved = yield* resolveHash(hash)
              const result = yield* fossil(["diff", "--from", resolved], { cwd: worktree })
              return result.code === 0 ? result.text.trim() : ""
            }).pipe(Effect.orDie),
          )
        })

        const getEarliestCommit = Effect.fnUntraced(function* () {
          // fossil uses "timeline" not "log"; --reverse with limit 1 gives earliest commit
          const result = yield* fossil(
            ["timeline", "--limit", "1", "--format", "%H", "--reverse"],
            { cwd: worktree },
          )
          if (result.code !== 0) return undefined
          const hash = result.text.trim().split("\n")[0]?.trim()
          // fossil may return 64-char SHA3-256 or 40-char; either works with fossil commands
          return hash?.slice(0, 40) || undefined
        })

        const resolveHash = Effect.fnUntraced(function* (hash: string) {
          // Check if hash exists in fossil repo
          const check = yield* fossil(["info", hash], { cwd: worktree })
          if (check.code === 0) return hash
          // Hash not found (e.g. old git hash) — fallback to earliest fossil commit
          const earliest = yield* getEarliestCommit()
          log.warn("hash not found in fossil, using earliest", { hash, fallback: earliest })
          return earliest ?? hash
        })

        const diffFull = Effect.fnUntraced(function* (from: string, to: string, paths?: readonly string[]) {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* ensureInit())) return []

              // Resolve hashes — fallback for old git hashes
              const resolvedFrom = yield* resolveHash(from)
              const resolvedTo = yield* resolveHash(to)
              const selected = paths
                ?.map((file) => path.relative(worktree, file).replaceAll("\\", "/"))
                .filter((file) => file && !file.startsWith("../"))
              const targets = selected?.length ? selected : undefined

              // Get numstat (insertions/deletions per file)
              const statusResult = yield* fossil(
                ["diff", "--from", resolvedFrom, "--to", resolvedTo, "-s", ...(targets ?? [])],
                {
                  cwd: worktree,
                },
              )
              if (statusResult.code !== 0) return []

              // Get brief status (ADDED/DELETED/EDITED/CHANGED per file)
              const briefResult = yield* fossil(
                ["diff", "--from", resolvedFrom, "--to", resolvedTo, "--brief", ...(targets ?? [])],
                {
                  cwd: worktree,
                },
              )
              const statusMap = new Map<string, "added" | "deleted" | "modified">()
              if (briefResult.code === 0) {
                for (const line of briefResult.text.trim().split("\n").filter(Boolean)) {
                  const match = line.match(/^(ADDED|DELETED|EDITED|CHANGED|UPDATE)\s+(.+)$/)
                  if (match) {
                    const status = match[1]
                    const file = match[2].trim()
                    statusMap.set(file, status === "ADDED" ? "added" : status === "DELETED" ? "deleted" : "modified")
                  }
                }
              }

              const files = statusResult.text
                .trim()
                .split("\n")
                .filter(Boolean)
                .filter((line) => !line.includes("TOTAL") && !line.includes("INSERTED"))
                .map((line) => {
                  const parts = line.trim().split(/\s+/)
                  return parts.length >= 3 ? parts[2] : ""
                })
                .filter(Boolean)

              const result: FileDiff[] = []
              for (const file of files) {
                const rel = path.join(worktree, file).replaceAll("\\", "/")
                const statLine = statusResult.text.split("\n").find((l) => l.includes(file)) ?? ""
                const parts = statLine.trim().split(/\s+/)
                const additions = parts.length >= 2 ? parseInt(parts[0]) || 0 : 0
                const deletions = parts.length >= 3 ? parseInt(parts[1]) || 0 : 0

                result.push({
                  file: rel,
                  patch: "",
                  additions,
                  deletions,
                  status: statusMap.get(file) ?? "modified",
                })
              }

              return result
            }).pipe(Effect.orDie),
          )
        })

        const impact = Effect.fnUntraced(function* (from: string, to: string) {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* ensureInit())) {
                return yield* Effect.fail(new Error("fossil snapshot not initialized"))
              }
              if (!hasCodegraphIndex(worktree)) {
                return yield* Effect.fail(
                  new Error(
                    `No .codegraph/ in ${worktree}. Initialize CodeGraph (codegraph init) before impact.`,
                  ),
                )
              }

              const resolvedFrom = yield* resolveHash(from)
              const resolvedTo = yield* resolveHash(to)

              const diff = yield* fossil(
                ["diff", "--from", resolvedFrom, "--to", resolvedTo, "--brief"],
                { cwd: worktree },
              )
              if (diff.code !== 0 || !diff.text.trim()) {
                return yield* Effect.fail(
                  new Error(`fossil diff failed or empty (${resolvedFrom} → ${resolvedTo})`),
                )
              }

              const changedFiles = diff.text
                .trim()
                .split("\n")
                .map((l: string) => l.replace(/^[A-Z]+\s+/, "").trim())
                .filter((f: string) => f.length > 0)
                .map((f: string) => f.replace(/\\/g, "/"))

              if (changedFiles.length === 0) {
                const empty: ImpactSummary = {
                  from: resolvedFrom,
                  to: resolvedTo,
                  changedFiles: 0,
                  symbolCountByKind: {},
                  topSymbols: [],
                  impactedFiles: [],
                  callerCount: 0,
                }
                return empty
              }

              // Hybrid: MCP touch → SQLite pack (structured impact, low noise)
              const hybrid = yield* mcpTouchThenSqlitePack(worktree, changedFiles)
              const fields = packToImpactFields(hybrid.pack)

              const summary: ImpactSummary = {
                from: resolvedFrom,
                to: resolvedTo,
                changedFiles: changedFiles.length,
                symbolCountByKind: fields.symbolCountByKind,
                topSymbols: fields.topSymbols,
                impactedFiles:
                  fields.impactedFiles.length > 0
                    ? fields.impactedFiles
                    : changedFiles.slice(0, 20),
                callerCount: fields.callerCount,
              }
              return summary
            }).pipe(Effect.orDie),
          )
        })

        const lastImpact = Effect.fnUntraced(function* () {
          return yield* locked(
            Effect.gen(function* () {
              if (!(yield* ensureInit())) {
                return yield* Effect.fail(new Error("fossil snapshot not initialized"))
              }

              const info = yield* fossil(["info"], { cwd: worktree })
              const hash = currentHash(info.text)
              if (!hash) {
                return yield* Effect.fail(new Error("no fossil checkout hash"))
              }

              const tag = yield* fossil(["tag", "list", hash], { cwd: worktree })
              if (tag.code !== 0 || !tag.text.trim()) {
                return yield* Effect.fail(
                  new Error(
                    `No fossil tags for ${hash}. Structural sym tag requires CodeGraph MCP on track.`,
                  ),
                )
              }

              // fossil tag list CHECKIN prints "name=value" (or bare name)
              const tagValue = parseSymTagValue(tag.text)
              if (!tagValue) {
                return yield* Effect.fail(
                  new Error(
                    `No sym tag on ${hash}. MCP structural tagging did not run or failed hard previously.`,
                  ),
                )
              }

              const kindSection = tagValue.match(/KINDS:([^|]*)/)?.[1]
              const symbolCountByKind: Record<string, number> = {}
              if (kindSection) {
                for (const pair of kindSection.split(",")) {
                  const [k, v] = pair.split("=")
                  if (k && v) symbolCountByKind[k] = parseInt(v) || 0
                }
              } else if (tagValue.startsWith("MCP:")) {
                symbolCountByKind["mcp"] = 1
              }

              const topSection = tagValue.match(/TOP:([^|]*)/)?.[1]
              const topSymbols = topSection
                ? topSection.split(",").filter(Boolean)
                : tagValue.startsWith("MCP:")
                  ? [tagValue.slice(0, 200)]
                  : []

              const impactSection = tagValue.match(/IMPACT:([^|]*)/)?.[1]
              const impactedFiles = impactSection ? impactSection.split(",").filter(Boolean) : []

              const summary: ImpactSummary = {
                from: hash,
                to: hash,
                changedFiles: 0,
                symbolCountByKind,
                topSymbols,
                impactedFiles,
                callerCount: topSymbols.length,
              }
              return summary
            }).pipe(Effect.orDie),
          )
        })

        // Eager open at instance boot — independent of project git and of the
        // first track(). Lazy-only open meant:
        // - TUI showed red "git" until an agent edit (exclusive marker logic)
        // - any git stall (e.g. stuck .git/index.lock blocking paths that never
        //   reached track) looked like "fossil never initialized"
        // Snapshot Fossil must not wait on git health.
        if (yield* enabled()) {
          const ok = yield* locked(ensureInit()).pipe(
            Effect.catch((err) => {
              log.warn("bug: fossil ensureInit at bootstrap failed", {
                error: err instanceof Error ? err.message : String(err),
                repoPath,
              })
              return Effect.succeed(false)
            }),
          )
          if (ok) log.info("fossil snapshot ready", { repoPath })
          else log.warn("fossil snapshot not ready after bootstrap ensureInit", { repoPath })
        }

        return { cleanup: () => Effect.void, track, opId, opRestore, checkpoint: opId, checkout: opRestore, patch, restore, revert, diff, diffFull, impact, lastImpact }
      }),
    )

    return SnapshotService.of({
      init: Effect.fn("SnapshotFossil.init")(function* () {
        // Materializes SnapshotFossil.state (includes eager ensureInit above).
        yield* InstanceState.get(state)
      }),
      cleanup: Effect.fn("SnapshotFossil.cleanup")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.cleanup())
      }),
      track: Effect.fn("SnapshotFossil.track")(function* (files?: string[]) {
        return yield* InstanceState.useEffect(state, (s) => s.track(files))
      }),
      checkpoint: Effect.fn("SnapshotFossil.checkpoint")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.opId())
      }),
      checkout: Effect.fn("SnapshotFossil.checkout")(function* (version: string) {
        return yield* InstanceState.useEffect(state, (s) => s.opRestore(version))
      }),
      // @deprecated — use checkpoint()
      opId: Effect.fn("SnapshotFossil.opId")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.opId())
      }),
      // @deprecated — use checkout()
      opRestore: Effect.fn("SnapshotFossil.opRestore")(function* (opId: string) {
        return yield* InstanceState.useEffect(state, (s) => s.opRestore(opId))
      }),
      patch: Effect.fn("SnapshotFossil.patch")(function* (hash: string) {
        return yield* InstanceState.useEffect(state, (s) => s.patch(hash))
      }),
      restore: Effect.fn("SnapshotFossil.restore")(function* (snapshot: string) {
        return yield* InstanceState.useEffect(state, (s) => s.restore(snapshot))
      }),
      revert: Effect.fn("SnapshotFossil.revert")(function* (patches: Patch[]) {
        return yield* InstanceState.useEffect(state, (s) => s.revert(patches))
      }),
      diff: Effect.fn("SnapshotFossil.diff")(function* (hash: string) {
        return yield* InstanceState.useEffect(state, (s) => s.diff(hash))
      }),
      diffFull: Effect.fn("SnapshotFossil.diffFull")(function* (
        from: string,
        to: string,
        paths?: readonly string[],
      ) {
        return yield* InstanceState.useEffect(state, (s) => s.diffFull(from, to, paths))
      }),
      impact: Effect.fn("SnapshotFossil.impact")(function* (from: string, to: string) {
        return yield* InstanceState.useEffect(state, (s) => s.impact(from, to))
      }),
      lastImpact: Effect.fn("SnapshotFossil.lastImpact")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.lastImpact())
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

export * as SnapshotFossil from "./fossil"
