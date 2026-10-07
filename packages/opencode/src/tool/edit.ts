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
 * THE EDIT LIST, RESOLVED AGAINST THE ORIGINAL CONTENT (plan 2026-10-01_hash-addressed-edits, H3/H4).
 *
 * «multiedit в начале определяет куда — и только потом правит, а не исправление, потом еще исправление»
 * (owner, 2026-10-01). That ORDER is what makes a CHAINED address usable: every entry resolves against the
 * content as it was READ, so no entry has to survive an intermediate state. It is also what makes ONE tool with
 * a list atomic by construction rather than by compensation: nothing is written until every entry has resolved.
 *
 * The address is INCLUSIVE (plan 2026-10-04_edit-inclusive-span): `fromHash` is the hash of the span's FIRST
 * line and `toHash` of its LAST — the very hashes `read` prints beside the lines being changed; `toHash` absent
 * or EQUAL to `fromHash` means that one line. An insertion is its own form, `insertAfter` (the seed `00000000`
 * names the state before line 1), which is also how a line is appended at the end. An entry carries exactly
 * one of `fromHash` / `insertAfter`. Every hash must exist in the current chain or the call is REFUSED:
 * nothing lands approximately, and nothing is guessed.
 *
 * WHY INCLUSIVE (owner, 2026-10-04: «модель ошибаться не может - само описание edit значит кривое»). The old
 * pair named the line BEFORE the span and read `fromHash == toHash` as an insertion. Both readings a model
 * naturally makes («the hash beside the line I change», «from X to X») were VALID addresses of a DIFFERENT
 * span, so a miss was never refused — it landed one line off or duplicated a line (measured on the ClientSoft
 * robots the same day). The address now means what it looks like.
 *
 * THE SPAN'S EDGES (H9c — owner, 2026-10-01: «от хеша - до хеша вставляем что отправил агент», the final
 * terminator «проверить как было в оригинале и не выдумывать»). A span is whole lines WITH their terminators.
 * `newString` is split into lines; ONE trailing terminator is its last line's own and is replaced by what the
 * ORIGINAL span's last line had, so «B» and «B\n» are the same line and nothing is glued or lost; `""` is zero
 * lines, a deletion. Every other new line takes the file's MAJORITY `ending`, so an edit adds no mixing.
 */
export type EditAddress = { fromHash?: string; toHash?: string; insertAfter?: string; newString: string }

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

/**
 * The new text, or EVERY refusal — never the first failure alone (plan 2026-10-01_edit-refusal-names-its-target,
 * R2): the batch exists to be one call, so its refusal must be enough to fix it in one more.
 */
export type Resolution = { kind: "text"; text: string } | { kind: "refused"; refusals: string[] }

type Span = { start: number; end: number; replacement: string }

/** `resolveAddresses` for a caller that wants a throw: one Error whose lines are the whole refusal set. */
export function resolveEdits(
  content: string,
  edits: readonly EditAddress[],
  ending: TextCodec.LineEnding | undefined = TextCodec.lineEnding(content),
  target?: string,
): string {
  const resolution = resolveAddresses(content, edits, ending, target)
  if (resolution.kind === "refused") throw new Error(resolution.refusals.join("\n"))
  return resolution.text
}

export function resolveAddresses(
  content: string,
  edits: readonly EditAddress[],
  ending: TextCodec.LineEnding | undefined = TextCodec.lineEnding(content),
  target?: string,
): Resolution {
  const lines = terminated(content)
  // The chain over the ORIGINAL content, computed ONCE — the whole point of the order above. `read` prints a
  // line WITHOUT its terminator and the chain is taken over exactly that string, so CRLF and LF hash alike.
  const chain: number[] = []
  let running = 0
  for (const line of lines) chain.push((running = chainHash(running, line.text)))
  const seed = hashLabel(0)
  // ONE builder names the file for every refusal below (R1), so a future refusal cannot forget it.
  const named = (what: string) => (target === undefined ? what : `${target}: ${what}`)

  // Each entry resolves to its span or to the refusal that says why not; every entry is walked, so the failing
  // SET is in hand before anything is decided.
  const resolved = edits.map((edit, index): Span | string => {
    const at = (what: string) => named(`edit ${index + 1}: ${what}`)
    const drifted = (field: string) =>
      at(`\`${field}\` is not in this file — the address drifted, or the file changed since it was read`) +
      ". Re-read and pass the current hashes."
    // The line a hash names, or a refusal. `allowSeed`: only an insertion may name the state before line 1.
    const lineOf = (field: string, hash: string, allowSeed: boolean): number | string => {
      const parsed = parseHash(hash)
      if (parsed === undefined) return at(`\`${field}\` is not an 8-hex address: ${JSON.stringify(hash)}`)
      if (hash === seed) {
        if (allowSeed) return -1
        return at(`\`${field}\` 00000000 is no line — to insert before line 1 pass \`insertAfter: "00000000"\``)
      }
      const found = chain.indexOf(parsed)
      return found === -1 ? drifted(field) : found
    }
    const isSpan = edit.fromHash !== undefined
    const isInsertion = edit.insertAfter !== undefined
    if (isSpan === isInsertion) {
      return at(
        "pass EITHER `fromHash` (+ optional `toHash`) to replace the lines from..to, OR `insertAfter` to insert after a line — " +
          (isSpan ? "not both" : "one of them is required"),
      )
    }
    if (isInsertion) {
      if (edit.toHash !== undefined) return at("`toHash` belongs to a span — an insertion has only `insertAfter`")
      // The EMPTY span after that line: end = start - 1.
      const after = lineOf("insertAfter", edit.insertAfter!, true)
      if (typeof after === "string") return after
      return { start: after + 1, end: after, replacement: edit.newString }
    }
    // INCLUSIVE: `fromHash` IS the first line, `toHash` the last; absent or equal = that one line.
    const start = lineOf("fromHash", edit.fromHash!, false)
    if (typeof start === "string") return start
    const end = edit.toHash === undefined ? start : lineOf("toHash", edit.toHash, false)
    if (typeof end === "string") return end
    if (end < start) return at("`toHash` precedes `fromHash` — an inverted range")
    return { start, end, replacement: edit.newString }
  })
  const refusals = resolved.filter((entry): entry is string => typeof entry === "string")
  if (refusals.length > 0) return { kind: "refused", refusals }
  const spans = resolved.filter((entry): entry is Span => typeof entry !== "string")

  // A refusal, never a merge decision: two entries claiming one line — or two claiming one insertion point —
  // have no defined order, and «last writer wins» is exactly the silent outcome this design exists to remove.
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  const clashes = ordered
    .slice(1)
    .filter((span, i) => span.start <= ordered[i]!.end || span.start === ordered[i]!.start)
    .map((span) => named(`two edits claim line ${span.start + 1} — refuse rather than let one silently win`))
  if (clashes.length > 0) return { kind: "refused", refusals: clashes }

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
  return { kind: "text", text: result.map((line) => line.text + line.eol).join("") }
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
        fromHash: Schema.optional(Schema.String).annotate({
          description:
            "The FIRST line you replace: the hash `read` printed beside that very line. It must come from THIS file; an address that does not resolve fails the whole call. Use `insertAfter` instead to add lines without replacing any.",
        }),
        toHash: Schema.optional(Schema.String).annotate({
          description:
            "The LAST line you replace (inclusive): the hash `read` printed beside it. Omit it, or pass the same hash as `fromHash`, to replace exactly that one line.",
        }),
        insertAfter: Schema.optional(Schema.String).annotate({
          description:
            "INSERT `newString` after this line, replacing nothing: the hash `read` printed beside it; `00000000` inserts before line 1 (also into an empty file). Pass this OR `fromHash`, never both.",
        }),
        newString: Schema.String.annotate({
          description:
            "The lines that replace fromHash..toHash, or the lines inserted after `insertAfter`. `\"\"` with `fromHash` deletes the span. A trailing line break is optional: the last line ends the way the replaced line ended, and every break is fitted to the file's own endings.",
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
  encoding: Schema.optional(Schema.String).annotate({
    description:
      "The code page a LEGACY file (not UTF-8, no BOM) was READ in — pass exactly the `encoding` you gave `read`; default: this host's ANSI page. The addresses are over the decoded text, so a different page does not resolve. Ignored for UTF-8 and BOM files.",
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
              "`files` is empty — pass at least one entry, `{ filePath, edits: [{ fromHash, toHash?, newString }] }` (or `{ insertAfter, newString }`), or `{ filePath, content }` to create a file.",
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
            // The page the model READ a legacy file in (H10). Validated here, before any file is touched.
            const codepage = entry.encoding === undefined ? undefined : TextCodec.codePage(entry.encoding)
            if (entry.encoding !== undefined && codepage === undefined) {
              throw new Error(
                at(
                  `\`encoding\` ${JSON.stringify(entry.encoding)} is not a code page — pass the legacy page you read the file in, e.g. windows-1251, windows-1252, gbk.`,
                ),
              )
            }
            if (entry.encoding !== undefined && entry.content !== undefined) {
              throw new Error(at("`encoding` names the page an EXISTING legacy file is read in; a new file has none."))
            }
            return {
              entry,
              edits,
              codepage,
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
              // Every entry's refusal is COLLECTED and the batch is refused once, naming them all — so one more
              // call is enough to fix it (plan 2026-10-01_edit-refusal-names-its-target, R2).
              const refusals: string[] = []
              for (const item of entries) {
                Constitution.noteMutationRisk({ tool: "edit", path: item.filePath, sessionID: ctx.sessionID })
                yield* assertExternalDirectoryEffect(ctx, item.filePath)

                const existed = yield* afs.existsSafe(item.filePath)

                // ONE write path for both shapes; they differ only in how the text is produced. The FORM it is
                // written in — encoding, endings — comes from `TextCodec.fit` for both, so a conversion is decided
                // and NAMED in one place (H9d).
                if (item.entry.content !== undefined) {
                  if (existed) {
                    refusals.push(
                      `${item.filePath} already exists — \`content\` only CREATES a file. Address its lines with \`edits\`.`,
                    )
                    continue
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
                  refusals.push(`${item.filePath} not found — an address can only name lines of a file that exists`)
                  continue
                }
                const info = yield* afs.stat(item.filePath)
                if (info.type === "Directory") {
                  refusals.push(`Path is a directory, not a file: ${item.filePath}`)
                  continue
                }
                // Decoded through the SAME codec `read` uses, so the text the addresses were printed over is the
                // text they resolve against — in every encoding, the BOM never part of line 1.
                const bytesOld = new Uint8Array(yield* afs.readFile(item.filePath))
                const source = TextCodec.decode(bytesOld, item.filePath, item.codepage)
                if (source.kind === "binary") {
                  refusals.push(
                    `${item.filePath} is a binary file — \`edit\` addresses text lines only. Inspect it with \`read\` and \`hex: true\`.`,
                  )
                  continue
                }
                if (source.kind === "undecodable") {
                  refusals.push(`Cannot decode ${item.filePath}: ${source.reason}`)
                  continue
                }
                // The new lines are fitted to the TARGET's ending — CRLF for Delphi/ANSI, else the file's majority —
                // so an edit adds no mixing. The ADDRESSES never depend on it: the chain is taken over each line
                // WITHOUT its terminator, which is exactly the string `read` printed.
                const forced = TextCodec.target(item.filePath, source.encoding).ending
                const resolution = resolveAddresses(
                  source.text,
                  item.edits,
                  forced ?? TextCodec.lineEnding(source.text),
                  item.filePath,
                )
                if (resolution.kind === "refused") {
                  refusals.push(...resolution.refusals)
                  continue
                }
                if (resolution.text === source.text) {
                  refusals.push(`${item.filePath}: no changes to apply — the result is identical to the file.`)
                  continue
                }
                const form = TextCodec.fit(item.filePath, source, resolution.text)
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
              if (refusals.length > 0) throw new Error(refusals.join("\n"))

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

