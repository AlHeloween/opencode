// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import * as path from "path"
import { Effect, Schema, Semaphore } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import type * as LSPClient from "@/lsp/client"
import { createPatch, diffStats } from "@/util/diff-wasm"
import DESCRIPTION from "./edit.txt"
import { chainHash, hashLabel, parseHash } from "./read"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { Format } from "../format"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectoryEffect } from "./external-directory"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import * as Bom from "@/util/bom"
import { execFile } from "child_process"
import { Constitution } from "@/session/constitution"
import { filePathDescription } from "./path-hint"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "edit-tool" })

/**
 * How long an already-written edit will wait for advisory LSP diagnostics.
 * Short on purpose: a server that has not answered by now is not going to make
 * the difference between a useful warning and a stalled tool.
 */
const DIAGNOSTICS_BUDGET = "1500 millis"

const MAX_BACKUPS_PER_SESSION = 50

function formatTimestamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * Is this path gitignored? Used to skip backups for node_modules, build output
 * and the like.
 *
 * It used to run `git check-ignore --stdin` and then never write to stdin or
 * close it — `filePath` was accepted and unused. Git sat waiting for input
 * until the 5 000 ms timeout killed it, which produced an error, which the
 * callback read as "not ignored". So it did two things wrong at once: it never
 * actually checked (backups were taken for every ignored path it was written to
 * skip), and it cost a flat five seconds on EVERY edit that takes a backup.
 * That is the stall the whole edit suite was timing out on.
 *
 * `--quiet` answers by exit code: 0 ignored, 1 not ignored, 128 not a git repo.
 * Anything that is not a clean 0 means "take the backup", which is the safe
 * direction to be wrong in.
 */
function isGitIgnored(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["check-ignore", "--quiet", "--", filePath],
      { cwd: Instance.worktree, timeout: 5000 },
      (error) => resolve(!error),
    )
  })
}

function writeBackup(
  content: string,
  sessionID: string,
  callID: string,
  filePath: string,
  afs: AppFileSystem.Interface,
) {
  return Effect.gen(function* () {
    const absFile = path.resolve(filePath)
    const dataDir = path.resolve(Global.Path.data) + path.sep
    if (absFile.startsWith(dataDir)) return

    // Skip backup for gitignored files (e.g. wasi-sdk, node_modules, build artifacts)
    if (yield* Effect.promise(() => isGitIgnored(filePath))) return

    const dir = path.join(Global.Path.data, "backups", sessionID)
    const safeName = filePath.replace(/[/\\:]/g, "_").replace(/^_+/, "")
    const bakPath = path.join(dir, `${formatTimestamp()}_${callID}_${safeName}.bak`)

    yield* afs.makeDirectory(dir, { recursive: true }).pipe(Effect.catch(() => Effect.void))

    yield* afs.writeFileString(bakPath, content).pipe(Effect.catch(() => Effect.void))

    yield* afs
      .writeFileString(bakPath + ".meta.json", JSON.stringify({ originalPath: filePath }))
      .pipe(Effect.catch(() => Effect.void))

    const entries = yield* afs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([] as string[])))
const backups = entries.filter((entry) => entry.endsWith(".bak")).sort()
if (backups.length > MAX_BACKUPS_PER_SESSION) {
  for (let i = 0; i < backups.length - MAX_BACKUPS_PER_SESSION; i++) {
    yield* afs.remove(path.join(dir, backups[i])).pipe(Effect.catch(() => Effect.void))
    yield* afs.remove(path.join(dir, backups[i] + ".meta.json")).pipe(Effect.catch(() => Effect.void))
  }
}
  })
}

export function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

export function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

export function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}

function normalizeLineEndingsWithIndexMap(text: string) {
  const characters: string[] = []
  const indexMap: number[] = []

  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\r" && text[index + 1] === "\n") {
      characters.push("\n")
      indexMap.push(index)
      index++
      continue
    }
    characters.push(text[index])
    indexMap.push(index)
  }

  return { text: characters.join(""), indexMap }
}

const locks = new Map<string, Semaphore.Semaphore>()

function lock(filePath: string) {
  const resolvedFilePath = AppFileSystem.resolve(filePath)
  const hit = locks.get(resolvedFilePath)
  if (hit) return hit

  const next = Semaphore.makeUnsafe(1)
  locks.set(resolvedFilePath, next)
  return next
}

/**
 * Line-addressed replacement WITH the guard an address needs — see the call site for why.
 *
 * The slice is replaced BY POSITION: a range that happens to repeat elsewhere in the file must still
 * address the lines it names, which is the one thing a content anchor cannot do.
 */
export function replaceRange(
  content: string,
  input: { from?: number; to?: number; expect?: string; replacement: string },
): string {
  if (input.expect === undefined) {
    throw new Error(
      "`from`/`to` require `expect`: an address alone can land on lines that moved. Pass the slice's text exactly as you just read it.",
    )
  }
  const lines = content.split("\n")
  const from = input.from ?? input.to ?? 1
  const to = input.to ?? input.from ?? lines.length
  if (from < 1 || to < from || to > lines.length) {
    throw new Error(
      `range ${from}-${to} is out of bounds for a file of ${lines.length} line(s) — the numbers are 1-based and \`to\` must not precede \`from\``,
    )
  }
  const slice = lines.slice(from - 1, to).join("\n")
  // The guard compares NORMALIZED text with ONE trailing newline allowed, because that is the whole
  // difference a caller can reasonably have: they read the lines, the file has a terminator.
  const expected = normalizeLineEndings(input.expect).replace(/\r?\n$/, "")
  if (slice !== expected) {
    throw new Error(
      `the file's lines ${from}-${to} are no longer what \`expect\` says — the address drifted.\n` +
        `expected: ${JSON.stringify(expected)}\n` +
        `found:    ${JSON.stringify(slice)}\n` +
        `Read those lines again and pass their current text, or address by content with \`exact: true\`.`,
    )
  }
  return [...lines.slice(0, from - 1), ...input.replacement.split("\n"), ...lines.slice(to)].join("\n")
}

/**
 * THE EDIT LIST, RESOLVED AGAINST THE ORIGINAL CONTENT (plan 2026-10-01_hash-addressed-edits, H3/H4).
 *
 * «multiedit в начале определяет куда — и только потом правит, а не исправление, потом еще исправление»
 * (owner, 2026-10-01). That ORDER is what makes a CHAINED address usable: every entry resolves against the
 * content as it was READ, so no entry has to survive an intermediate state. It is also what makes ONE tool with
 * a list atomic by construction rather than by compensation: nothing is written until every entry has resolved.
 *
 * The address is a PAIR. `fromHash` is the hash of the line BEFORE the span — the seed `00000000` names the
 * state before line 1, so the first line is addressable like any other — and `toHash` is the hash of the span's
 * LAST line; `toHash` absent means a single line. Both must exist in the current chain or the call is REFUSED:
 * nothing lands approximately, and nothing is guessed.
 */
export type EditAddress = { fromHash: string; toHash?: string; newString: string }

export function resolveEdits(content: string, edits: EditAddress[]): string {
  const lines = content.split("\n")
  // The chain over the ORIGINAL content, computed ONCE — the whole point of the order above.
  const chain: number[] = []
  let running = 0
  for (const line of lines) chain.push((running = chainHash(running, line)))
  const seed = hashLabel(0)

  const spans = edits.map((edit, index) => {
    const at = (what: string) => `edit ${index + 1}: ${what}`
    const parsedFrom = parseHash(edit.fromHash)
    if (parsedFrom === undefined) {
      throw new Error(at(`\`fromHash\` is not an 8-hex address: ${JSON.stringify(edit.fromHash)}`))
    }
    // `fromHash` names the line BEFORE the span, so the seed resolves to "before line 1".
    const before = edit.fromHash === seed ? -1 : chain.indexOf(parsedFrom)
    if (edit.fromHash !== seed && before === -1) {
      throw new Error(
        at("`fromHash` is not in this file — the address drifted, or the file changed since it was read") +
          ". Re-read and pass the current hashes.",
      )
    }
    const start = before + 1

    const parsedTo = edit.toHash === undefined ? undefined : parseHash(edit.toHash)
    if (edit.toHash !== undefined && parsedTo === undefined) {
      throw new Error(at(`\`toHash\` is not an 8-hex address: ${JSON.stringify(edit.toHash)}`))
    }
    const end = parsedTo === undefined ? start : chain.indexOf(parsedTo)
    if (end === -1) {
      throw new Error(at("`toHash` is not in this file — the address drifted") + ". Re-read and pass the current hashes.")
    }
    if (end < start) throw new Error(at("`toHash` precedes `fromHash` — an inverted range"))
    if (end >= lines.length) throw new Error(at("the address runs past the end of the file"))
    return { start, end, replacement: edit.newString }
  })

  // A refusal, never a merge decision: two entries claiming one line have no defined order, and «last writer
  // wins» is exactly the silent outcome this design exists to remove.
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i]!.start <= ordered[i - 1]!.end) {
      throw new Error(`two edits claim line ${ordered[i]!.start + 1} — refuse rather than let one silently win`)
    }
  }

  // Bottom-up, so a replacement cannot move a span that has not been applied yet.
  let result = lines
  for (const span of [...ordered].reverse()) {
    result = [...result.slice(0, span.start), ...span.replacement.split("\n"), ...result.slice(span.end + 1)]
  }
  return result.join("\n")
}

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: filePathDescription("Path to the file to modify"),
  }),
  oldString: Schema.optional(Schema.String).annotate({
    description:
      "The text to replace. NOT needed when an ADDRESS is given (`from`/`to` + `expect`): in address mode `expect` takes this role and `oldString` is ignored.",
  }),
  newString: Schema.String.annotate({
    description: "The text to replace it with (must be different from oldString)",
  }),
  replaceAll: Schema.optional(Schema.Boolean).annotate({
    description: "Replace all occurrences of oldString (default false)",
  }),
  exact: Schema.optional(Schema.Boolean).annotate({
    description:
      "Require a LITERAL match for oldString (default false). The matcher is fuzzy by design: a padded or drifted anchor still applies, and the success report names the stage that matched. Set `exact: true` when the anchor must be found verbatim — a miss then fails the call instead of landing near it.",
  }),
  from: Schema.optional(Schema.Number).annotate({
    description:
      "First line of an ADDRESS-BASED edit (1-based, the numbers `read` prints). Needs `to` or defaults to a single line, and REQUIRES `expect`: line numbers drift, and a bare address would write into whatever now occupies those lines.",
  }),
  to: Schema.optional(Schema.Number).annotate({
    description: "Last line of an address-based edit (1-based, inclusive). Defaults to `from`.",
  }),
  expect: Schema.optional(Schema.String).annotate({
    description:
      "The CURRENT text of lines `from`-`to`, exactly as you just read it. The tool refuses if the file no longer holds it — that guard is what makes an address safe. Replaces `oldString` in this mode.",
  }),
})

export const EditTool = Tool.define(
  "edit",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* AppFileSystem.Service
    const format = yield* Format.Service
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.filePath) {
            throw new Error("filePath is required")
          }

          // Either an anchor or an address, never neither: `oldString` is optional only so that ADDRESS mode
          // does not have to carry a value it discards (plan F6).
          const addressed = params.from !== undefined || params.to !== undefined
          if (params.oldString === undefined && !addressed) {
            throw new Error(
              "pass `oldString` — the text to replace — or address the lines with `from`/`to` + `expect`.",
            )
          }

          if (!addressed && params.oldString === params.newString) {
            throw new Error("No changes to apply: oldString and newString are identical.")
          }

          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          Constitution.noteMutationRisk({ tool: "edit", path: filePath, sessionID: ctx.sessionID })
          yield* assertExternalDirectoryEffect(ctx, filePath)

          let diff = ""
          let contentOld = ""
          let contentNew = ""
          // Which cascade stage matched (plan F3). "exact" until an approximate stage says otherwise, so
          // the caller is TOLD when its anchor was approximated instead of having to infer it.
          let matchedStage = "exact"
          yield* lock(filePath).withPermits(1)(
            Effect.gen(function* () {
              if (params.oldString === "" && params.from === undefined && params.to === undefined) {
                const existed = yield* afs.existsSafe(filePath)
                const source = existed ? yield* Bom.readFile(afs, filePath) : { bom: false, text: "" }
                const next = Bom.split(params.newString)
                const desiredBom = source.bom || next.bom
                contentOld = source.text
                if (existed) yield* writeBackup(contentOld, ctx.sessionID, ctx.callID ?? "", filePath, afs)
                contentNew = next.text
                diff = trimDiff((yield* Effect.promise(() => createPatch(contentOld, contentNew))) ?? "")
                yield* ctx.ask({
                  permission: "edit",
                  patterns: [path.relative(Instance.worktree, filePath)],
                  always: ["*"],
                  metadata: {
                    filepath: filePath,
                    diff,
                  },
                })
                yield* afs.writeWithDirs(filePath, Bom.join(contentNew, desiredBom))
                if (yield* format.file(filePath)) {
                  contentNew = yield* Bom.syncFile(afs, filePath, desiredBom)
                }
                yield* bus.publish(File.Event.Edited, { file: filePath })
                yield* bus.publish(FileWatcher.Event.Updated, {
                  file: filePath,
                  event: existed ? "change" : "add",
                })
                return
              }

              const info = yield* afs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (!info) throw new Error(`File ${filePath} not found`)
              if (info.type === "Directory") throw new Error(`Path is a directory, not a file: ${filePath}`)
              const source = yield* Bom.readFile(afs, filePath)
              contentOld = source.text

              yield* writeBackup(contentOld, ctx.sessionID, ctx.callID ?? "", filePath, afs)

              const ending = detectLineEnding(contentOld)
              const old = convertToLineEnding(normalizeLineEndings(params.oldString ?? ""), ending)
              const replacement = convertToLineEnding(normalizeLineEndings(params.newString), ending)

              // THE ADDRESS, WITH ITS GUARD (plan F4). `read` prints absolute 1-based line numbers, so a
              // caller can say WHICH lines it means instead of describing them. But numbers DRIFT: a bare
              // address would write into whatever now occupies those lines, so the address carries
              // `expect` — the slice's text as the caller just read it — and a mismatch is a refusal that
              // shows both. The slice is then replaced BY POSITION, which is the one thing a content
              // anchor cannot do: a range that repeats elsewhere still addresses the lines it names.
              const applied =
                params.from !== undefined || params.to !== undefined
                  ? {
                      content: replaceRange(contentOld, {
                        from: params.from,
                        to: params.to,
                        expect: params.expect,
                        replacement,
                      }),
                      stage: "address",
                    }
                  : replaceWithStage(contentOld, old, replacement, params.replaceAll, params.exact)
              const next = Bom.split(applied.content)
              matchedStage = applied.stage
              const desiredBom = source.bom || next.bom
              contentNew = next.text

              diff = trimDiff(
                (yield* Effect.promise(() => createPatch(normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)))) ?? "",
              )
              yield* ctx.ask({
                permission: "edit",
                patterns: [path.relative(Instance.worktree, filePath)],
                always: ["*"],
                metadata: {
                  filepath: filePath,
                  diff,
                },
              })

              yield* afs.writeWithDirs(filePath, Bom.join(contentNew, desiredBom))
              if (yield* format.file(filePath)) {
                contentNew = yield* Bom.syncFile(afs, filePath, desiredBom)
              }
              yield* bus.publish(File.Event.Edited, { file: filePath })
              yield* bus.publish(FileWatcher.Event.Updated, {
                file: filePath,
                event: "change",
              })
              diff = trimDiff(
                (yield* Effect.promise(() => createPatch(normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)))) ?? "",
              )
            }).pipe(Effect.orDie),
          )

          let additions = 0
          let deletions = 0
          const stats = yield* Effect.promise(() => diffStats(contentOld, contentNew))
          if (stats) {
            additions = stats.additions
            deletions = stats.deletions
          }
          const filediff: Snapshot.FileDiff = {
            file: filePath,
            patch: diff,
            additions,
            deletions,
          }

          yield* ctx.metadata({
            metadata: {
              diff,
              filediff,
              diagnostics: {},
            },
          })

          // Plan F3: the SUCCESS names the stage, for the same reason the refusal does — a caller must
          // never have to INFER that its anchor was approximated. Exact and address matches carry no
          // note, because there is nothing to disclose: nothing was guessed.
          let output =
            matchedStage === "exact" || matchedStage === "address"
              ? "Edit applied successfully."
              : `Edit applied successfully — matched by the \`${matchedStage}\` stage, NOT literally. ` +
                `The anchor was approximated; pass \`exact: true\` to require a literal match.`
          // Diagnostics are advisory and the edit has already been written, so
          // they must never gate the return. `waitForDocumentDiagnostics` is
          // bounded at 5s (lsp/client.ts DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS),
          // which is what a spawned-but-silent server costs on EVERY edit —
          // long enough to look like the tool hung, and exactly what made the
          // whole edit suite time out at ~5 040ms against bun's 5 000ms default.
          // Where a server answers promptly this changes nothing.
          const diagnostics = yield* lsp
            .touchFile(filePath, "document")
            .pipe(
              Effect.andThen(() => lsp.diagnostics()),
              Effect.timeout(DIAGNOSTICS_BUDGET),
              Effect.catch((cause) => {
                log.debug("diagnostics skipped; reporting the edit without them", { filePath, error: cause })
                return Effect.succeed({} as Record<string, LSPClient.Diagnostic[]>)
              }),
            )
          const normalizedFilePath = AppFileSystem.normalizePath(filePath)
          const block = LSP.Diagnostic.report(filePath, diagnostics[normalizedFilePath] ?? [])
          if (block) output += `\n\nLSP errors detected in this file, please fix:\n${block}`

          return {
            metadata: {
              diagnostics,
              diff,
              filediff,
            },
            title: `${path.relative(Instance.worktree, filePath)}`,
            output,
          }
        }),
    }
  }),
)

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3

/**
 * Levenshtein distance algorithm implementation
 */
function levenshtein(a: string, b: string): number {
  // Handle empty strings
  if (a === "" || b === "") {
    return Math.max(a.length, b.length)
  }
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

function normalize(s: string): string {
  return s
    .trim()
    .replaceAll("\u2010", "-")
    .replaceAll("\u2011", "-")
    .replaceAll("\u2012", "-")
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-")
    .replaceAll("\u2015", "-")
    .replaceAll("\u2212", "-")
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'")
    .replaceAll("\u201A", "'")
    .replaceAll("\u201B", "'")
    .replaceAll("\u201C", '"')
    .replaceAll("\u201D", '"')
    .replaceAll("\u201E", '"')
    .replaceAll("\u201F", '"')
    .replaceAll("\u00A0", " ")
    .replaceAll("\u2002", " ")
    .replaceAll("\u2003", " ")
    .replaceAll("\u2004", " ")
    .replaceAll("\u2005", " ")
    .replaceAll("\u2006", " ")
    .replaceAll("\u2007", " ")
    .replaceAll("\u2008", " ")
    .replaceAll("\u2009", " ")
    .replaceAll("\u200A", " ")
    .replaceAll("\u202F", " ")
    .replaceAll("\u205F", " ")
    .replaceAll("\u3000", " ")
}

function mapAndStripWhitespace(data: string): { stripped: string; indexMap: number[] } {
  const stripped: string[] = []
  const indexMap: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== " " && data[i] !== "\t" && data[i] !== "\n" && data[i] !== "\r") {
      stripped.push(data[i])
      indexMap.push(i)
    }
  }
  return { stripped: stripped.join(""), indexMap }
}

function slidingHammingBest(
  haystack: string,
  needle: string,
  maxDist = 1,
): { pos: number; dist: number } | null {
  const n = haystack.length
  const m = needle.length
  if (m === 0 || n < m) return null
  for (let i = 0; i <= n - m; i++) {
    let dist = 0
    for (let j = 0; j < m; j++) {
      if (haystack[i + j] !== needle[j]) dist++
      if (dist > maxDist) break
    }
    if (dist <= maxDist) return { pos: i, dist }
  }
  return null
}

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

export const LineEndingNormalizedReplacer: Replacer = function* (content, find) {
  const source = normalizeLineEndingsWithIndexMap(content)
  const search = normalizeLineEndings(find)
  let offset = 0

  while (true) {
    const index = source.text.indexOf(search, offset)
    if (index === -1) return
    const start = source.indexMap[index]
    const end = source.indexMap[index + search.length] ?? content.length
    if (start !== undefined) yield content.substring(start, end)
    offset = index + search.length
  }
}

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim()
      const searchTrimmed = searchLines[j].trim()

      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    if (matches) {
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        if (k < searchLines.length - 1) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) {
    return
  }

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  // Collect all candidate positions where both anchors match (exact or unicode-normalized)
  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    const firstTrimmed = originalLines[i].trim()
    if (firstTrimmed !== firstLineSearch && normalize(firstTrimmed) !== normalize(firstLineSearch)) {
      continue
    }

    // Look for the matching last line after this first line
    for (let j = i + 2; j < originalLines.length; j++) {
      const lastTrimmed = originalLines[j].trim()
      if (lastTrimmed === lastLineSearch || normalize(lastTrimmed) === normalize(lastLineSearch)) {
        candidates.push({ startLine: i, endLine: j })
        break
      }
    }
  }

  // Return immediately if no candidates — fall through to Hamming fallback
  if (candidates.length === 0) {
    const { stripped: strippedContent } = mapAndStripWhitespace(content)
    const { stripped: strippedSearch } = mapAndStripWhitespace(find)
    const hamming = slidingHammingBest(strippedContent, strippedSearch, 1)
    if (hamming && hamming.dist === 1) {
      const { indexMap } = mapAndStripWhitespace(content)
      const first = indexMap[hamming.pos]
      const last = indexMap[hamming.pos + strippedSearch.length - 1]
      // The comparison ran with ALL whitespace removed, so it can say which CHARACTERS
      // matched — never where their lines begin or end. A span cut to the first and last
      // non-space character therefore lands mid-line, and the rest of that line survives
      // the replacement, spliced after the new text (measured 2026-09-29: read.ts:448 lost
      // the opening `<` of a reminder tag and gained a duplicated tail, while the edit
      // reported success). What the match justifies is WHOLE LINES, nothing narrower.
      if (first !== undefined && last !== undefined) {
        const start = content.lastIndexOf("\n", first - 1) + 1
        const lineBreak = content.indexOf("\n", last + 1)
        // The terminator stays OUTSIDE the span: a whole-lines span owns the text of the
        // lines, while the carriage return and newline still belong to the file — keep them
        // and a CRLF file loses the `\r` of its last replaced line.
        const lineEnd =
          lineBreak === -1 ? content.length : content[lineBreak - 1] === "\r" ? lineBreak - 1 : lineBreak
        yield content.substring(start, lineEnd)
      }
    }
    return
  }

  // Handle single candidate scenario (using relaxed threshold)
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    const actualBlockSize = endLine - startLine + 1

    // Guard: reject candidate if actual block is wildly larger than search block.
    // Prevents anchor-span bug where small search patterns accidentally match
    // across much larger blocks via coincidental first/last-line anchor hits.
    const BLOCK_SIZE_RATIO_MAX = 3
    if (actualBlockSize > searchBlockSize * BLOCK_SIZE_RATIO_MAX) {
      return
    }

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          similarity += 1.0 / linesToCheck  // both empty = perfect position match
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += (1 - distance / maxLen) / linesToCheck

        // Exit early when threshold is reached
        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
          break
        }
      }
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      let matchStartIndex = 0
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += originalLines[k].length + 1
      }
      let matchEndIndex = matchStartIndex
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k].length
        if (k < endLine) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex)
    }
    return
  }

  // Calculate similarity for multiple candidates
  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  // Guard: discard any candidate whose block is wildly larger than the search block.
  // Same anchor-span prevention as the single-candidate path above.
  const BLOCK_SIZE_RATIO_MAX = 3

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const actualBlockSize = endLine - startLine + 1

    if (actualBlockSize > searchBlockSize * BLOCK_SIZE_RATIO_MAX) {
      continue
    }

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          similarity += 1  // both empty = perfect position match
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      similarity /= linesToCheck // Average similarity
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  // Threshold judgment
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) {
        matchEndIndex += 1
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex)
  }
}

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()
  const normalizedFind = normalizeWhitespace(find)

  // Handle single line matches
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    } else {
      // Only check for substring matches if the full line doesn't match
      const normalizedLine = normalizeWhitespace(line)
      if (normalizedLine.includes(normalizedFind)) {
        // Find the actual substring in the original line that matches
        const words = find.trim().split(/\s+/)
        if (words.length > 0) {
          const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
          try {
            const regex = new RegExp(pattern)
            const match = line.match(regex)
            if (match) {
              yield match[0]
            }
          } catch {
            // Invalid regex pattern, skip
          }
        }
      }
    }
  }

  // Handle multi-line matches
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/)
        return match ? match[1].length : 0
      }),
    )

    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n"
        case "t":
          return "\t"
        case "r":
          return "\r"
        case "'":
          return "'"
        case '"':
          return '"'
        case "`":
          return "`"
        case "\\":
          return "\\"
        case "\n":
          return "\n"
        case "$":
          return "$"
        default:
          return match
      }
    })
  }

  const unescapedFind = unescapeString(find)

  // Try direct match with unescaped find string
  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  // Also try finding escaped versions in content that match unescaped find
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    const unescapedBlock = unescapeString(block)

    if (unescapedBlock === unescapedFind) {
      yield block
    }
  }
}

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  // This replacer yields all exact matches, allowing the replace function
  // to handle multiple occurrences based on replaceAll parameter
  let startIndex = 0

  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break

    yield find
    startIndex = index + find.length
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()

  if (trimmedFind === find) {
    // Already trimmed, no point in trying
    return
  }

  // Try to find the trimmed version
  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  // Also try finding blocks where trimmed content matches
  const lines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")

    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")
  if (findLines.length < 3) {
    // Need at least 3 lines to have meaningful context
    return
  }

  // Remove trailing empty line if present
  if (findLines[findLines.length - 1] === "") {
    findLines.pop()
  }

  const contentLines = content.split("\n")

  // Extract first and last lines as context anchors
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  // Find blocks that start and end with the context anchors
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue

    // Look for the matching last line
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        // Found a potential context block
        const blockLines = contentLines.slice(i, j + 1)
        const block = blockLines.join("\n")

        // Check if the middle content has reasonable similarity
        // (simple heuristic: at least 50% of non-empty lines should match when trimmed)
        if (blockLines.length === findLines.length) {
          let matchingLines = 0
          let totalNonEmptyLines = 0

          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim()
            const findLine = findLines[k].trim()

            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++
              if (blockLine === findLine) {
                matchingLines++
              }
            }
          }

          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield block
            break // Only match the first occurrence
          }
        }
        break
      }
    }
  }
}

export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}

/**
 * THE CASCADE, WITH ITS STAGES NAMED (plan F3). The name lives in the SAME entry as the function, so a
 * stage cannot be added here and forgotten in a parallel list of labels — two spellings of one mapping
 * is the defect this project has already paid for more than once.
 */
const STAGES: { name: string; fn: Replacer }[] = [
  { name: "exact", fn: SimpleReplacer },
  { name: "line-ending-normalized", fn: LineEndingNormalizedReplacer },
  { name: "line-trimmed", fn: LineTrimmedReplacer },
  { name: "block-anchor", fn: BlockAnchorReplacer },
  { name: "whitespace-normalized", fn: WhitespaceNormalizedReplacer },
  { name: "indentation-flexible", fn: IndentationFlexibleReplacer },
  { name: "escape-normalized", fn: EscapeNormalizedReplacer },
  { name: "trimmed-boundary", fn: TrimmedBoundaryReplacer },
  { name: "context-aware", fn: ContextAwareReplacer },
  { name: "multi-occurrence", fn: MultiOccurrenceReplacer },
]

/**
 * `replace`, but it also reports WHICH stage matched, so the caller can say «this anchor was
 * approximated» instead of that fact staying inside the matcher (plan F3). `replace` below is the same
 * call with the report dropped — there is still exactly ONE matcher.
 */
export function replaceWithStage(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
  exact = false,
): { content: string; stage: string } {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  let notFound = true

  // The cascade, IN ORDER — and its head is the exact match. `exact` runs the head ALONE: the caller
  // has declared that its anchor must be found literally, so a miss is a refusal instead of a guess.
  // The guess stays available to every caller who has not ruled it out, because it is what keeps a
  // drifting anchor from failing (measured 2026-10-01: a padded anchor applies, and so does an anchor
  // whose three of six middle lines differ — the loosest stage's 50 % threshold, sat exactly).
  const stages = exact ? STAGES.slice(0, 1) : STAGES

  for (const { name, fn } of stages) {
    for (const search of fn(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      notFound = false
      if (replaceAll) {
        return { content: content.replaceAll(search, newString), stage: name }
      }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue
      return {
        content: content.substring(0, index) + newString + content.substring(index + search.length),
        stage: name,
      }
    }
  }

  if (notFound) {
    throw new Error(
      exact
        ? "Could not find oldString in the file EXACTLY — `exact: true` disables the fuzzy stages, so the anchor must match the file literally. Include unique surrounding text."
        : "Could not find oldString in the file after normalized matching. Include unique surrounding text.",
    )
  }
  throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.")
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false, exact = false): string {
  return replaceWithStage(content, oldString, newString, replaceAll, exact).content
}

