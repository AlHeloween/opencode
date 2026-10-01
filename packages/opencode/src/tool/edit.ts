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
import * as TextCodec from "@/util/text-codec"
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
  // The BYTES as read: a backup that re-encoded the text would «restore» a UTF-16 or ANSI file as UTF-8.
  content: Uint8Array,
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

    yield* afs.writeWithDirs(bakPath, content).pipe(Effect.catch(() => Effect.void))

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
 * Hold EVERY file's lock for the whole batch, in a canonical order so two batches over overlapping files
 * cannot deadlock.
 *
 * The batch resolves every address against each file as it was READ and only then writes, so the reads and the
 * writes have to sit inside ONE hold: with the resolve outside it, a concurrent edit could land in between and
 * be silently overwritten — the one failure the address exists to prevent. Nothing new is built here; it is the
 * semaphore this file already took per file, held once for the set.
 */
function withFileLocks<A, E, R>(filePaths: string[], effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  // Ordered by the RESOLVED path — the key `lock()` takes — or two spellings of one file would order differently
  // in two batches and could deadlock against each other.
  const ordered = filePaths.map((filePath) => AppFileSystem.resolve(filePath)).sort()
  const acquire = (index: number): Effect.Effect<A, E, R> =>
    index >= ordered.length ? effect : lock(ordered[index]!).withPermits(1)(acquire(index + 1))
  return acquire(0)
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
 * LAST line; `toHash` absent means a single line, and `toHash` EQUAL to `fromHash` names the empty span after
 * that line — an insertion, which is also how a line is appended at the end. Both must exist in the current
 * chain or the call is REFUSED: nothing lands approximately, and nothing is guessed.
 *
 * THE SPAN'S EDGES (H9c — owner, 2026-10-01: «от хеша - до хеша вставляем что отправил агент», the final
 * terminator «проверить как было в оригинале и не выдумывать»). A span is whole lines WITH their terminators.
 * `newString` is split into lines; ONE trailing terminator is its last line's own and is replaced by what the
 * ORIGINAL span's last line had, so «B» and «B\n» are the same line and nothing is glued or lost; `""` is zero
 * lines, a deletion. Every other new line takes the file's MAJORITY `ending`, so an edit adds no mixing.
 */
export type EditAddress = { fromHash: string; toHash?: string; newString: string }

type Line = { text: string; eol: string }

/** Lines WITH their terminators. No phantom line follows a final terminator — `read` prints none either. */
function terminated(content: string): Line[] {
  const out: Line[] = []
  let from = 0
  for (;;) {
    const nl = content.indexOf("\n", from)
    if (nl === -1) break
    const cr = nl > from && content[nl - 1] === "\r"
    out.push({ text: content.slice(from, cr ? nl - 1 : nl), eol: cr ? "\r\n" : "\n" })
    from = nl + 1
  }
  if (from < content.length) {
    const rest = content.slice(from)
    // `read` strips ONE trailing CR from an unterminated last line as well, so the chain must see the same text.
    out.push(rest.endsWith("\r") ? { text: rest.slice(0, -1), eol: "\r" } : { text: rest, eol: "" })
  }
  return out
}

export function resolveEdits(
  content: string,
  edits: readonly EditAddress[],
  ending: TextCodec.LineEnding | undefined = TextCodec.lineEnding(content),
): string {
  const lines = terminated(content)
  // The chain over the ORIGINAL content, computed ONCE — the whole point of the order above. `read` prints a
  // line WITHOUT its terminator and the chain is taken over exactly that string, so CRLF and LF hash alike.
  const chain: number[] = []
  let running = 0
  for (const line of lines) chain.push((running = chainHash(running, line.text)))
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
    // `toHash` equal to `fromHash` — the seed included — names the EMPTY span after that line: end = start - 1.
    const end = parsedTo === undefined ? start : edit.toHash === seed ? -1 : chain.indexOf(parsedTo)
    if (edit.toHash !== undefined && edit.toHash !== seed && end === -1) {
      throw new Error(at("`toHash` is not in this file — the address drifted") + ". Re-read and pass the current hashes.")
    }
    if (end < start - 1) throw new Error(at("`toHash` precedes `fromHash` — an inverted range"))
    if (end >= lines.length) throw new Error(at("the address runs past the end of the file"))
    return { start, end, replacement: edit.newString }
  })

  // A refusal, never a merge decision: two entries claiming one line — or two claiming one insertion point —
  // have no defined order, and «last writer wins» is exactly the silent outcome this design exists to remove.
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i]!.start <= ordered[i - 1]!.end || ordered[i]!.start === ordered[i - 1]!.start) {
      throw new Error(`two edits claim line ${ordered[i]!.start + 1} — refuse rather than let one silently win`)
    }
  }

  // Bottom-up, so a replacement cannot move a span that has not been applied yet.
  let result = lines
  for (const span of [...ordered].reverse()) {
    const incoming = span.replacement === "" ? [] : terminated(span.replacement)
    const insertion = span.end < span.start
    const previous = result[span.start - 1]
    // A break where the file needs one and has none to copy: its majority ending, else the agent's, else LF.
    const lineBreak = ending ?? (incoming.at(-1)?.eol || "\n")
    const atBareEnd = previous !== undefined && previous.eol === "" && span.start === lines.length
    const appendToBare = insertion && atBareEnd
    const deletesBareEnd =
      !insertion && incoming.length === 0 && span.end === lines.length - 1 && lines[span.end]!.eol === ""
    // The terminator the new LAST line carries — the original's form, never the agent's guess.
    const tail = (() => {
      if (!insertion) return lines[span.end]!.eol // a replaced span: what its last line had
      if (lines.length === 0) return incoming.at(-1)?.eol ?? "" // an empty file: nothing to copy, as sent
      if (appendToBare) return "" // the file ended bare, and still does
      if (span.start === lines.length) return previous!.eol // an append: the end keeps its form
      return lineBreak // an insertion before a line
    })()
    const fitted = incoming.map((line, i) => ({
      text: line.text,
      eol: i === incoming.length - 1 ? tail : (ending ?? line.eol),
    }))
    const head = result.slice(0, span.start)
    // Appending after a bare last line: that line now needs the break. Deleting a bare last line: the line
    // before it becomes the end, and takes the bare form.
    if (previous !== undefined && appendToBare) head[head.length - 1] = { text: previous.text, eol: lineBreak }
    if (previous !== undefined && deletesBareEnd) head[head.length - 1] = { text: previous.text, eol: "" }
    result = [...head, ...fitted, ...result.slice(span.end + 1)]
  }
  return result.map((line) => line.text + line.eol).join("")
}

/**
 * ONE file's changes — the ENTRY type, and it is exactly the shape `edit` took when it addressed a single file.
 *
 * That is deliberate: «что одно изменение что пачка» (owner, 2026-10-01). One change is a list of one, so there
 * is no second spelling of «a change to a file» to keep in sync — the uniform shape IS the feature.
 */
const FileChange = Schema.Struct({
  filePath: Schema.String.annotate({
    description: filePathDescription("Path to the file to modify"),
  }),
  edits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        fromHash: Schema.String.annotate({
          description:
            "The address of the line BEFORE the span: the hash `read` printed for the line just above the first line you are changing — `00000000` for line 1, which is the state before the file. It must come from THIS file; an address that does not resolve fails the whole call.",
        }),
        toHash: Schema.optional(Schema.String).annotate({
          description:
            "The address of the LAST line of the span, exactly as `read` printed it. Omit it to change a single line. Pass the SAME hash as `fromHash` to INSERT after that line without replacing anything.",
        }),
        newString: Schema.String.annotate({
          description:
            "The lines that replace the span. `\"\"` deletes it. A trailing line break is optional: the last line ends the way the replaced line ended, and every break is fitted to the file's own endings.",
        }),
      }),
    ).annotate({
      description:
        "Every change to THIS file. All of them are resolved against the file AS IT WAS READ and applied in ONE write, so no entry is affected by another.",
    }),
  ),
  content: Schema.optional(Schema.String).annotate({
    description:
      "Create a NEW file with this content. Refused when the file already exists — address its lines instead — and never combined with `edits`.",
  }),
})

export const Parameters = Schema.Struct({
  files: Schema.Array(FileChange).annotate({
    description:
      "The files this call changes — one entry per file. Read several files, then change them all in ONE call, as one batch. Every address in EVERY entry is resolved before ANYTHING is written, so a failure anywhere writes NOTHING, in any file.",
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
          if (params.files.length === 0) {
            throw new Error(
              "`files` is empty — pass at least one entry, `{ filePath, edits: [{ fromHash, newString }] }`, or `{ filePath, content }` to create a file.",
            )
          }

          // ONE entry per file, and the entry IS the shape a single-file edit always had — «что одно изменение
          // что пачка» (owner, 2026-10-01). Two entries for one file have no defined order, and the list INSIDE
          // an entry is what changes one file twice, so a duplicate is REFUSED rather than merged: the same rule,
          // one level up, as two spans claiming one line.
          const entries = params.files.map((entry, index) => {
            const edits = entry.edits ?? []
            const at = (what: string) => `files[${index}] (${entry.filePath}): ${what}`
            if (entry.content !== undefined && edits.length > 0) {
              throw new Error(at("`content` creates a new file; it cannot be combined with `edits`."))
            }
            if (entry.content === undefined && edits.length === 0) {
              throw new Error(at("pass `edits` — at least one addressed change — or `content` to create a new file."))
            }
            return {
              entry,
              edits,
              filePath: path.isAbsolute(entry.filePath)
                ? entry.filePath
                : path.join(Instance.directory, entry.filePath),
            }
          })
          const seenAt = new Map<string, number>()
          entries.forEach((item, index) => {
            const key = AppFileSystem.resolve(item.filePath)
            const first = seenAt.get(key)
            if (first !== undefined) {
              throw new Error(
                `files[${first}] and files[${index}] name the same file (${item.filePath}) — one entry carries ALL of a file's changes; a second entry for it has no defined order.`,
              )
            }
            seenAt.set(key, index)
          })

          // What the batch decided. Filled by PHASE 1, consumed after the hold is released.
          const planned: {
            filePath: string
            existed: boolean
            status: "change" | "add"
            // The bytes as they were READ — what the backup must restore, not a re-encoding of their text.
            bytesOld: Uint8Array | undefined
            contentOld: string
            contentNew: string
            contentFinal: string
            encoding: TextCodec.TextEncoding
            ending: TextCodec.LineEnding | undefined
            notice: string | undefined
            diff: string
          }[] = []

          yield* withFileLocks(
            entries.map((item) => item.filePath),
            Effect.gen(function* () {
              // ---- PHASE 1 — RESOLVE EVERY ENTRY OF EVERY FILE. NOTHING IS WRITTEN HERE. ------------------
              // This is the order the whole design rests on: every address is checked against the content as it
              // was READ, so no entry has to survive an intermediate state, and a failure anywhere leaves every
              // file in the batch exactly as it was.
              for (const item of entries) {
                Constitution.noteMutationRisk({ tool: "edit", path: item.filePath, sessionID: ctx.sessionID })
                yield* assertExternalDirectoryEffect(ctx, item.filePath)

                const existed = yield* afs.existsSafe(item.filePath)

                // ONE write path for both shapes; they differ only in how the text is produced. The FORM it is
                // written in — encoding, endings — comes from `TextCodec.fit` for both, so a conversion is decided
                // and NAMED in one place (H9d).
                if (item.entry.content !== undefined) {
                  if (existed) {
                    throw new Error(
                      `${item.filePath} already exists — \`content\` only CREATES a file. Address its lines with \`edits\`.`,
                    )
                  }
                  const form = TextCodec.fit(item.filePath, undefined, item.entry.content)
                  planned.push({
                    filePath: item.filePath,
                    existed,
                    status: "add",
                    bytesOld: undefined,
                    contentOld: "",
                    contentNew: form.text,
                    contentFinal: form.text,
                    encoding: form.encoding,
                    ending: form.ending,
                    notice: form.notice,
                    diff: "",
                  })
                  continue
                }
                if (!existed) {
                  throw new Error(`${item.filePath} not found — an address can only name lines of a file that exists`)
                }
                const info = yield* afs.stat(item.filePath)
                if (info.type === "Directory") throw new Error(`Path is a directory, not a file: ${item.filePath}`)
                // Decoded through the SAME codec `read` uses, so the text the addresses were printed over is the
                // text they resolve against — in every encoding, the BOM never part of line 1.
                const bytesOld = new Uint8Array(yield* afs.readFile(item.filePath))
                const source = TextCodec.decode(bytesOld, item.filePath)
                if (source.kind === "binary") {
                  throw new Error(
                    `${item.filePath} is a binary file — \`edit\` addresses text lines only. Inspect it with \`read\` and \`hex: true\`.`,
                  )
                }
                if (source.kind === "undecodable") throw new Error(`Cannot decode ${item.filePath}: ${source.reason}`)
                // The new lines are fitted to the TARGET's ending — CRLF for Delphi/ANSI, else the file's majority —
                // so an edit adds no mixing. The ADDRESSES never depend on it: the chain is taken over each line
                // WITHOUT its terminator, which is exactly the string `read` printed.
                const forced = TextCodec.target(item.filePath, source.encoding).ending
                const applied = resolveEdits(source.text, item.edits, forced ?? TextCodec.lineEnding(source.text))
                if (applied === source.text) {
                  throw new Error(`${item.filePath}: no changes to apply — the result is identical to the file.`)
                }
                const form = TextCodec.fit(item.filePath, source, applied)
                planned.push({
                  filePath: item.filePath,
                  existed,
                  status: "change",
                  bytesOld,
                  contentOld: source.text,
                  contentNew: form.text,
                  contentFinal: form.text,
                  encoding: form.encoding,
                  ending: form.ending,
                  notice: form.notice,
                  diff: "",
                })
              }

              // ---- PHASE 2 — ASK FOR EVERY FILE BEFORE WRITING ANY OF THEM. --------------------------------
              // Asking at write time would let a denial land after an earlier file had already been written, and
              // the batch would be a partial apply — the one outcome the list exists to make impossible.
              for (const plan of planned) {
                plan.diff = trimDiff(
                  (yield* Effect.promise(() =>
                    createPatch(normalizeLineEndings(plan.contentOld), normalizeLineEndings(plan.contentNew)),
                  )) ?? "",
                )
                yield* ctx.ask({
                  permission: "edit",
                  patterns: [path.relative(Instance.worktree, plan.filePath)],
                  always: ["*"],
                  metadata: { filepath: plan.filePath, diff: plan.diff },
                })
              }

              // ---- PHASE 3 — WRITE EVERY FILE, each as it was verified. ------------------------------------
              for (const plan of planned) {
                if (plan.bytesOld !== undefined) {
                  yield* writeBackup(plan.bytesOld, ctx.sessionID, ctx.callID ?? "", plan.filePath, afs)
                }
                yield* afs.writeWithDirs(plan.filePath, TextCodec.encode(plan.contentNew, plan.encoding))
                if (yield* format.file(plan.filePath)) {
                  plan.contentFinal = yield* TextCodec.syncFile(afs, plan.filePath, plan.encoding, plan.ending)
                }
                yield* bus.publish(File.Event.Edited, { file: plan.filePath })
                yield* bus.publish(FileWatcher.Event.Updated, { file: plan.filePath, event: plan.status })
                plan.diff = trimDiff(
                  (yield* Effect.promise(() =>
                    createPatch(normalizeLineEndings(plan.contentOld), normalizeLineEndings(plan.contentFinal)),
                  )) ?? "",
                )
              }
            }).pipe(Effect.orDie),
          )

          const filediffs: Snapshot.FileDiff[] = []
          for (const plan of planned) {
            const stats = yield* Effect.promise(() => diffStats(plan.contentOld, plan.contentFinal))
            filediffs.push({
              file: plan.filePath,
              patch: plan.diff,
              additions: stats?.additions ?? 0,
              deletions: stats?.deletions ?? 0,
            })
          }

          // Diagnostics are advisory and the writes have already happened, so they must never gate the return.
          // `waitForDocumentDiagnostics` is bounded at 5s (lsp/client.ts DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS),
          // which is what a spawned-but-silent server costs — long enough to look like the tool hung, and exactly
          // what made the whole edit suite time out at ~5 040ms against bun's 5 000ms default. ONE budget for the
          // whole batch rather than one per file: every file is touched and the map is then read ONCE, so a batch
          // of ten waits what a batch of one waits. Where a server answers promptly this changes nothing.
          const diagnostics = yield* Effect.gen(function* () {
            for (const plan of planned) yield* lsp.touchFile(plan.filePath, "document")
            return yield* lsp.diagnostics()
          }).pipe(
            Effect.timeout(DIAGNOSTICS_BUDGET),
            Effect.catch((cause) => {
              log.debug("diagnostics skipped; reporting the edit without them", { error: cause })
              return Effect.succeed({} as Record<string, LSPClient.Diagnostic[]>)
            }),
          )

          yield* ctx.metadata({
            metadata: {
              filediffs,
              diagnostics,
            },
          })

          const changed = planned.map((plan) => path.relative(Instance.worktree, plan.filePath))
          let output =
            changed.length === 1
              ? "Edit applied successfully."
              : `Edit applied successfully to ${changed.length} files.`
          for (const plan of planned) {
            // A conversion is never silent (owner: «агент получает уведомление»): the file's FORM changed beyond
            // the lines the agent addressed, and the next read prints different bytes.
            if (plan.notice) output += `\n\n${path.relative(Instance.worktree, plan.filePath)}: ${plan.notice}`
            const normalized = AppFileSystem.normalizePath(plan.filePath)
            const block = LSP.Diagnostic.report(plan.filePath, diagnostics[normalized] ?? [])
            if (block) {
              output += `\n\nLSP errors detected in ${path.relative(Instance.worktree, plan.filePath)}, please fix:\n${block}`
            }
          }

          return {
            metadata: {
              diagnostics,
              filediffs,
            },
            title: changed.length === 1 ? changed[0]! : `${changed.length} files`,
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

