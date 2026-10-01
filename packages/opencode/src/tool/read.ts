import { Effect, Option, Schema, Scope } from "effect"
import { isUtf8 } from "node:buffer"
import { createReadStream } from "fs"
import * as path from "path"
import * as Tool from "./tool"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectoryEffect } from "./external-directory"
import { Instruction } from "../session/instruction"
import { isImageAttachment, sniffAttachmentMime, sniffVideoMime } from "@/util/media"
import { convertDocument, isSupportedDocumentFormat } from "../util/markdownify"
import { extractVideoFrames, probeDuration } from "@/util/video"
import { filePathDescription } from "./path-hint"
import * as TextCodec from "../util/text-codec"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
// A line longer than MAX_LINE_LENGTH is WRAPPED, not clipped (plan 2026-10-01_hash-addressed-edits, H2). The
// suffix this replaced — «... (line truncated to 2000 chars)» — answers «how much did I lose», and the owner
// asked a DIFFERENT question: WHERE in the line the reader is («если в файле очень длинные строки то у тебя
// должен быть перенос строк. Для определения позиции»). Chunks after the first therefore name their character
// offset inside the line, so any part of it can be pointed at; the line's ADDRESS stays on its first chunk,
// where the line begins.
const LINE_CONTINUATION = "      ↳+"
const LINE_OUTPUT_CAPPED = "... (output capped before the end of this line)"
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`
const SAMPLE_BYTES = 4096
const TEXT_DOCUMENT_EXTENSIONS = new Set(["atom", "csv", "htm", "html", "json", "md", "rss", "txt", "xml"])
const HEX_DUMP_BYTES_PER_ROW = 16
const HEX_DUMP_DEFAULT_BYTE_LIMIT = 512

// `offset` and `limit` were originally `z.coerce.number()` — the runtime
// coercion was useful when the tool was called from a shell but serves no
// purpose in the LLM tool-call path (the model emits typed JSON). The JSON
// Schema output is identical (`type: "number"`), so the LLM view is
// unchanged; purely CLI-facing uses must now send numbers rather than strings.
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: filePathDescription("Path to the file or directory to read"),
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "The line number (or byte offset in hex mode) to start reading from (1-indexed)",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "The maximum number of lines (or bytes in hex mode) to read",
  }),
  hex: Schema.optional(Schema.Boolean).annotate({
    description: "When true, read a binary file as a formatted hex dump with offset and ASCII tail",
  }),
  encoding: Schema.optional(Schema.String).annotate({
    description:
      "The code page of a LEGACY file — one that is neither UTF-8 nor marked by a BOM: windows-1251, windows-1252, gbk, shift_jis, ibm866… Default: this host's ANSI page. Such a file's output names the page it was read in; if the text looks wrong, read it again with the right one, and pass the same `encoding` to `edit`. Ignored for UTF-8 and BOM files.",
  }),
})

export const ReadTool = Tool.define(
  "read",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const instruction = yield* Instruction.Service
    const lsp = yield* LSP.Service
    const scope = yield* Scope.Scope

    const miss = Effect.fn("ReadTool.miss")(function* (filepath: string) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)
      const items = yield* fs.readDirectory(dir).pipe(
        Effect.map((items) =>
          items
            .filter(
              (item) =>
                item.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(item.toLowerCase()),
            )
            .map((item) => path.join(dir, item))
            .slice(0, 3),
        ),
        Effect.catch(() => Effect.succeed([] as string[])),
      )

      if (items.length > 0) {
        return yield* Effect.fail(
          new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${items.join("\n")}`),
        )
      }

      return yield* Effect.fail(new Error(`File not found: ${filepath}`))
    })

    const list = Effect.fn("ReadTool.list")(function* (filepath: string) {
      const items = yield* fs.readDirectoryEntries(filepath)
      return yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* (item) {
          if (item.type === "directory") return item.name + "/"
          if (item.type !== "symlink") return item.name

          const target = yield* fs.stat(path.join(filepath, item.name)).pipe(Effect.catch(() => Effect.void))
          if (target?.type === "Directory") return item.name + "/"
          return item.name
        }),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items: string[]) => items.sort((a, b) => a.localeCompare(b))))
    })

    const warm = Effect.fn("ReadTool.warm")(function* (filepath: string) {
      yield* lsp.touchFile(filepath).pipe(Effect.ignore, Effect.forkIn(scope))
    })

    const readSample = Effect.fn("ReadTool.readSample")(function* (
      filepath: string,
      fileSize: number,
      sampleSize: number,
    ) {
      if (fileSize === 0) return new Uint8Array()

      return yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(filepath, { flag: "r" })
          return Option.getOrElse(yield* file.readAlloc(Math.min(sampleSize, fileSize)), () => new Uint8Array())
        }),
      )
    })

    // ONE definition of «binary» for `read` and `edit` (TextCodec). A BOM is checked FIRST: UTF-16 is full of
    // NUL bytes, and the heuristic alone called every UTF-16 file binary.
    const isBinaryFile = (filepath: string, bytes: Uint8Array) =>
      TextCodec.bomEncoding(bytes) === undefined && TextCodec.looksBinary(filepath, bytes)

    const run = Effect.fn("ReadTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (params.offset !== undefined && params.offset < 1) {
        return yield* Effect.fail(new Error("offset must be greater than or equal to 1"))
      }
      const codepage = params.encoding === undefined ? undefined : TextCodec.codePage(params.encoding)
      if (params.encoding !== undefined && codepage === undefined) {
        return yield* Effect.fail(
          new Error(
            `\`encoding\`: ${JSON.stringify(params.encoding)} is not a code page — pass a legacy page such as windows-1251, windows-1252, gbk, shift_jis or ibm866. UTF-8 and BOM files are detected on their own.`,
          ),
        )
      }

      let filepath = params.filePath
      if (process.platform === "win32") {
        filepath = AppFileSystem.windowsPath(filepath)
        if (/^[\\/](?![A-Za-z](?:[\\/]|:)|cygdrive[\\/]|mnt[\\/])/.test(filepath)) {
          filepath = path.join(path.parse(Instance.directory).root, filepath.slice(1))
        }
      }
      if (!path.isAbsolute(filepath)) {
        filepath = path.resolve(Instance.directory, filepath)
      }
      if (process.platform === "win32") {
        filepath = AppFileSystem.normalizePath(filepath)
      }
      const title = path.relative(Instance.worktree, filepath)

      const stat = yield* fs.stat(filepath).pipe(
        Effect.catchIf(
          (err) => "reason" in err && err.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
      )

      yield* assertExternalDirectoryEffect(ctx, filepath, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
        kind: stat?.type === "Directory" ? "directory" : "file",
      })

      yield* ctx.ask({
        permission: "read",
        patterns: [filepath],
        always: ["*"],
        metadata: {},
      })

      if (!stat) return yield* miss(filepath)

      if (stat.type === "Directory") {
        const items = yield* list(filepath)
        const limit = params.limit ?? DEFAULT_READ_LIMIT
        const offset = params.offset ?? 1
        const start = offset - 1
        const sliced = items.slice(start, start + limit)
        const truncated = start + sliced.length < items.length

        return {
          title,
          output: [
            `<path>${filepath}</path>`,
            `<type>directory</type>`,
            `<entries>`,
            sliced.join("\n"),
            truncated
              ? `\n(Showing ${sliced.length} of ${items.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
              : `\n(${items.length} entries)`,
            `</entries>`,
          ].join("\n"),
          metadata: {
            preview: sliced.slice(0, 20).join("\n"),
            truncated,
            loaded: [] as string[],
          },
        }
      }

      const { results: loaded, skippedDelivered } = yield* instruction.resolve(ctx.messages, filepath, ctx.messageID)
      const sample = yield* readSample(filepath, Number(stat.size), SAMPLE_BYTES)

      const mime = sniffAttachmentMime(sample, AppFileSystem.mimeType(filepath))
      if (params.hex) {
        // Hex mode — reads ANY file as hex dump, regardless of type
        const bytes = yield* fs.readFile(filepath)
        const hexOffset = params.offset ?? 1
        const hexLimit = params.limit ?? HEX_DUMP_DEFAULT_BYTE_LIMIT
        const hexResult = formatHexDump(new Uint8Array(bytes), {
          offset: hexOffset,
          limit: hexLimit,
          maxTotalBytes: MAX_BYTES,
        })

        let output = [`<path>${filepath}</path>`, `<type>hexdump</type>`, `<hexdump>`].join("\n")
        output += "\n" + hexResult.lines.join("\n")

        const byteEnd = hexResult.offsetStart + hexResult.bytesShown - 1
        if (hexResult.truncated) {
          output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing bytes ${hexResult.offsetStart}-${byteEnd} of ${bytes.length}. Use offset=${hexResult.offsetStart + hexResult.bytesShown} to continue.)`
        } else if (hexResult.bytesShown < bytes.length) {
          output += `\n\n(Showing bytes ${hexResult.offsetStart}-${byteEnd} of ${bytes.length}. Use offset=${hexResult.offsetStart + hexResult.bytesShown} to continue.)`
        } else {
          output += `\n\n(End of file - total ${bytes.length} bytes)`
        }
        output += "\n</hexdump>"

        return {
          title,
          output,
          metadata: {
            preview: hexResult.lines.slice(0, 10).join("\n"),
            truncated: hexResult.truncated,
            loaded: loaded.map((item) => item.filepath),
          },
        }
      }

      if (isImageAttachment(mime)) {
        const bytes = yield* fs.readFile(filepath)
        return {
          title,
          output: "Image read successfully",
          metadata: {
            preview: "Image read successfully",
            truncated: false,
            loaded: loaded.map((item) => item.filepath),
          },
          attachments: [
            {
              type: "file" as const,
              mime,
              url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
            },
          ],
        }
      }

      // Video: capability-aware dispatch (user spec 2026-09-07).
      //  - model supports native video -> attach the file (openrouter SDK maps
      //    video/* file parts to the wire video_url content block)
      //  - no video but image input -> SPLIT: sample evenly spaced downscaled
      //    frames via ffmpeg and attach them as images
      //  - neither -> fall through to the markdownify stub below
      //
      // Video is recognized by MAGIC BYTES ONLY (sniffVideoMime). The
      // extension fallback is deliberately excluded: mime-types maps .ts
      // (TypeScript) to video/mp2t (MPEG Transport Stream), and a text
      // source file must never enter the video pipeline (2026-09-07
      // incident: reading a .ts source file shipped its text as a "video").
      // Native path is mp4-only (provider contract): other sniffed
      // containers (mp2t/webm/avi/flv) take the SPLIT path under an
      // image-capable model, else fall through to the stub.
      const videoMime = sniffVideoMime(new Uint8Array(sample))
      if (videoMime) {
        const model = ctx.extra?.["model"] as
          | { capabilities?: { input?: { video?: boolean; image?: boolean } } }
          | undefined
        const videoInput = model?.capabilities?.input?.video === true
        const imageInput = model?.capabilities?.input?.image === true
        const MAX_VIDEO_BYTES = 20 * 1024 * 1024
        if (videoInput && videoMime === "video/mp4") {
          if (Number(stat.size) > MAX_VIDEO_BYTES) {
            return yield* Effect.fail(
              new Error(
                `Video too large for native input: ${filepath} (${(Number(stat.size) / 1048576).toFixed(1)} MiB > 20 MiB). ` +
                  `Split or compress it first.`,
              ),
            )
          }
          const bytes = yield* fs.readFile(filepath)
          // The window budget prices a NATIVE video by DURATION — the provider bills
          // it that way (measured 1.97 MiB ≈ 6s → 2610 prompt tokens, and
          // `video_tokens: 0`, so it never reports a per-item figure either), so
          // ffprobe here is the only source for it. 0 when the container cannot be
          // probed: the part then carries no price rather than a fabricated one.
          const durationSeconds = yield* Effect.promise(() => probeDuration(filepath))
          return {
            title,
            output: "Video read successfully (native video input)",
            metadata: {
              preview: "Video read successfully",
              truncated: false,
              loaded: loaded.map((item) => item.filepath),
            },
            attachments: [
              {
                type: "file" as const,
                mime: videoMime,
                url: `data:${videoMime};base64,${Buffer.from(bytes).toString("base64")}`,
                ...(durationSeconds > 0 ? { durationSeconds } : {}),
              },
            ],
          }
        }
        if (imageInput) {
          const frames = yield* Effect.promise(() => extractVideoFrames(filepath))
          if (frames.length > 0) {
            return {
              title,
              output: `Video split into ${frames.length} sampled frames (model has image input, no native video). Frames are evenly spaced across the full duration; analyze them as a sequence.`,
              metadata: {
                preview: `Video split into ${frames.length} frames`,
                truncated: false,
                loaded: loaded.map((item) => item.filepath),
              },
              attachments: frames.map((frame) => ({
                type: "file" as const,
                mime: "image/jpeg",
                url: `data:image/jpeg;base64,${frame.base64}`,
              })),
            }
          }
          // ffmpeg/ffprobe unavailable — fall through to the markdownify stub.
        }
      }

      if (isBinaryFile(filepath, sample)) {
        const bytes = yield* fs.readFile(filepath)

        const ext = path.extname(filepath).toLowerCase().slice(1)
        if (isSupportedDocumentFormat(ext) && !TEXT_DOCUMENT_EXTENSIONS.has(ext)) {
          const markdown = yield* Effect.promise(() =>
            convertDocument(new Uint8Array(bytes), path.basename(filepath)),
          )
          return {
            title,
            output: [
              `<path>${filepath}</path>`,
              `<type>${ext}</type>`,
              "<content>",
              // Numbered like the plain-text path. A converted document used to
              // come back as bare markdown, so nothing in it was addressable —
              // you could read a contract clause but not cite the line it is on.
              markdown
                .split("\n")
                .map((line, i) => `${i + 1}: ${line}`)
                .join("\n"),
              "</content>",
            ].join("\n"),
            metadata: {
              preview: markdown.slice(0, 500),
              truncated: false,
              loaded: loaded.map((item) => item.filepath),
            },
          }
        }
        return yield* Effect.fail(new Error(`Cannot read binary file: ${filepath}`))
      }

      // A refusal from the decoder (no host page) is a FAILURE the model can act on, not a defect.
      const file = yield* Effect.tryPromise({
        try: () => lines(filepath, { limit: params.limit ?? DEFAULT_READ_LIMIT, offset: params.offset ?? 1, codepage }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
        return yield* Effect.fail(
          new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`),
        )
      }

      // A LEGACY file says which page it was read in — bytes cannot name their code page, a reader of the text
      // can (H10). Only then: a UTF-8 file's output stays byte-identical.
      const legacy =
        file.codepage === undefined
          ? []
          : [
              `<encoding>ANSI ${file.codepage} — a legacy file (not UTF-8, no BOM), read in ${file.codepage}${codepage ? "" : ", this host's default"}. If the text looks wrong, read it again with \`encoding\` set to its code page, and pass the same \`encoding\` to \`edit\`. Saving converts it to UTF-8 with BOM and CRLF.</encoding>`,
            ]
      let output = [`<path>${filepath}</path>`, `<type>file</type>`, ...legacy, "<content>\n"].join("\n")
      output += file.raw.map((line, i) => `${i + file.offset}  ${file.hashes[i]}: ${line}`).join("\n")

      const last = file.offset + file.raw.length - 1
      const next = last + 1
      const truncated = file.more || file.cut
      if (file.cut) {
        output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`
      } else if (file.more) {
        output += `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)`
      } else {
        output += `\n\n(End of file - total ${file.count} lines)`
      }
      output += "\n</content>"

      yield* warm(filepath)

      if (loaded.length > 0) {
        output += `\n\n<system-reminder>\n${loaded.map((item) => item.content).join("\n\n")}\n</system-reminder>`
      } else if (skippedDelivered.length > 0) {
        // 2026-08-30 (Alexander): full instruction content rides on the FIRST
        // read only. Afterwards a one-line gated-workflow reminder keeps the
        // causal chain without the AGENTS.md flood (previously re-delivered in
        // full after every compaction — compacted read parts vanish from
        // ctx.messages and the dedup lost track).
        // System alerts carry the §8 seal too (owner directive 2026-09-29): the
        // reminder is closed with time + md5 so it cannot seed a correlation loop.
        // The stamp uses this read's moment — the output is persisted in the part,
        // so replays carry the same sealed text and the KV prefix stays stable.
                        const reminder =
          `Gated workflow: State→SV→Plan→Implement→Oracle→Clean. ` +
          `Continue from your last gate. Project instructions already delivered this session — ` +
          `sessionread the file if a rule is needed.`
        // NEGATIVE RESULT 2026-09-29 — de-duplicated, and the seal is REMOVED from this
        // repeat: the line emitted the SAME one-line reminder TWICE, each copy closed with
        // `time: …` + `md5: …` computed over `Date.now()`. That is a repeating message with a
        // fresh, meaningless key, handed to a model that continues what it reads. From
        // 09:45:16Z every read carried the doubled block; by 09:49:58Z the model was closing
        // its own sections with slash-close tags x1826 inside ONE reasoning block
        // (experiments/2026-09-29_seal-loop-forensics/loop_census.py). The section-8 seal
        // belongs to a user message, not to a message the tool repeats.
        output += `\n\n<system-reminder>${reminder}</system-reminder>`
      }

      return {
        title,
        output,
        metadata: {
          preview: file.raw.slice(0, 20).join("\n"),
          truncated,
          loaded: loaded.map((item) => item.filepath),
        },
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

/**
 * The LINE ADDRESS (plan 2026-10-01_hash-addressed-edits, H1).
 *
 * `h(i) = trunc32(xxh3_64(h(i-1) ‖ "\u0000" ‖ line(i)))`, seeded at 0, so a line's hash carries the WHOLE
 * prefix above it: an address says what the FILE is, not where a line is. Any change above an addressed span
 * changes its hash, and the edit is refused instead of landing near it — a guess is not implemented at all.
 *
 * The text hashed is the line WITHOUT its terminator, which is exactly the string `read` prints. That is what
 * makes the address survive CRLF: `\r` is stripped below (CRLF counts as one break), so a CRLF file and an LF
 * file hash their lines IDENTICALLY and an ending rewrite invalidates nothing. That class — the bytes a caller
 * types back never equal the bytes on disk — is the one `oldString` could not survive, and the fuzzy cascade
 * existed only to forgive it.
 *
 * 32 bits, because the address is a PAIR and the chain already carries position and history: the hash only has
 * to catch substitution, where a per-line collision is ≈ 2·10⁻¹⁰. If that ever proves too tight, the lever is
 * width — never a fuzzy fallback.
 *
 * xxh3, the owner's decision (2026-10-01: «короткий инкрементальный xxH3 хеш»): it has dedicated short-input
 * paths, and a line is a short input. A first build used xxHash64 on the premise «xxHash3 appears nowhere in src»
 * — but `Bun.hash.xxHash3` is built into the runtime. The algorithm is pinned by a test against an independent
 * implementation (Python `xxhash.xxh3_64`), because read and edit share this function and would agree on ANY hash.
 */
export function chainHash(previous: number, line: string): number {
  // Mask in the hash's OWN space: converting first would round the low bits away (64 bits do not fit a double).
  return Number(Bun.hash.xxHash3(`${previous}\u0000${line}`) & 0xffff_ffffn)
}

/** The printed form. ONE spelling, shared by `read` and `edit` — never a second. */
export function hashLabel(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/** Read a printed label back. `undefined` for anything that is not exactly 8 hex characters. */
export function parseHash(label: string): number | undefined {
  return /^[0-9a-f]{8}$/.test(label) ? Number.parseInt(label, 16) >>> 0 : undefined
}

/**
 * The file's lines, its true line count and the chained address of every returned line.
 *
 * The address is a function of the TEXT, never of the bytes that carry it (plan H9): `edit` decodes through
 * `TextCodec`, so this must produce the SAME text for every encoding `edit` accepts, or an address printed here
 * never resolves there. UTF-8 — with or without a BOM, the BOM never part of line 1 — is STREAMED, as it always
 * was; anything else (UTF-16, ANSI in the host code page) is decoded WHOLE by the codec. The fallback is decided
 * by the WHOLE file, past the window included: a window of ASCII lines over a file whose third line is cp1251
 * would otherwise stream as UTF-8 while `edit` decodes it as ANSI.
 */
export async function lines(filepath: string, opts: { limit: number; offset: number; codepage?: string }) {
  const streamed = await streamUtf8(filepath, opts)
  if (streamed) return { ...streamed, codepage: undefined }
  // `codepage` is the model's choice for a legacy file (H10) — canonical, validated by the caller.
  const decoded = TextCodec.decode(new Uint8Array(await Bun.file(filepath).arrayBuffer()), filepath, opts.codepage)
  if (decoded.kind === "binary") throw new Error(`Cannot read binary file: ${filepath}`)
  if (decoded.kind === "undecodable") throw new Error(`Cannot decode ${filepath}: ${decoded.reason}`)
  const window = lineWindow(opts)
  const parts = decoded.text.split("\n")
  if (parts.at(-1) === "") parts.pop() // the terminator of the last line opens no line of its own
  for (const part of parts) window.push(part.endsWith("\r") ? part.slice(0, -1) : part)
  return {
    ...window.result(),
    encoding: decoded.encoding,
    codepage: decoded.encoding === "ansi" ? decoded.codepage : undefined,
  }
}

/** The UTF-8 path, streamed. `undefined` = not UTF-8 — a UTF-16 BOM, or any line that is not valid UTF-8. */
async function streamUtf8(filepath: string, opts: { limit: number; offset: number }) {
  // Raw byte scan instead of readline: 0x0A never appears inside a multi-byte
  // UTF-8 sequence, so splitting the stream on newline bytes is exact. The
  // tally CONTINUES past the limit (tally-only mode) so `count` is the TRUE
  // total for the "Showing lines X-Y of N" pager — the readline version broke
  // at limit+1 and reported "of 11" for a 100-line file, while the original
  // full readline pass stalled on huge files (b07ddf7cda). A byte scan is
  // memcpy-speed: correct count without the stall.
  const stream = createReadStream(filepath)
  const window = lineWindow(opts)
  let encoding: "utf-8" | "utf-8-bom" = "utf-8"
  let first = true
  let pending: Buffer = Buffer.alloc(0)

  // `false` = this line is not UTF-8, and the file is not either. Validated even past the window: the window
  // must not decide the encoding. The line is DECODED only inside it.
  const processLine = (lineBuf: Buffer) => {
    const line = lineBuf.length > 0 && lineBuf[lineBuf.length - 1] === 0x0d ? lineBuf.subarray(0, -1) : lineBuf
    if (!isUtf8(line)) return false
    window.push(window.tallyOnly() ? undefined : line.toString("utf8")) // CRLF counts as a single break
    return true
  }

  try {
    for await (const chunk of stream) {
      let buf: Buffer = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      if (first) {
        first = false
        const bom = TextCodec.bomEncoding(buf)
        if (bom === "utf-16le" || bom === "utf-16be") return undefined
        if (bom === "utf-8-bom") {
          encoding = bom
          buf = buf.subarray(3)
        }
      }
      let from = 0
      for (;;) {
        const nl = buf.indexOf(0x0a, from)
        if (nl === -1) break
        if (!processLine(buf.subarray(from, nl))) return undefined
        from = nl + 1
      }
      pending = buf.subarray(from)
    }
    if (pending.length > 0 && !processLine(pending)) return undefined // final line without trailing newline
  } finally {
    stream.destroy()
  }

  return { ...window.result(), encoding }
}

/**
 * The window over a file's lines, fed one decoded line at a time — ONE implementation for the streamed and the
 * decoded path, so the two cannot disagree about a hash, a wrap or a count.
 */
function lineWindow(opts: { limit: number; offset: number }) {
  const start = opts.offset - 1
  const raw: string[] = []
  const hashes: string[] = []
  // The chain state. It advances over EVERY line, including the ones this window does not return.
  let hash = 0
  let bytes = 0
  let count = 0
  let cut = false
  let more = false
  let tallyOnly = false

  // `text` is undefined only in tally-only mode, where the caller need not decode the line at all.
  const push = (text: string | undefined) => {
    count += 1
    // Past the window NOTHING is needed: `count` keeps tallying (the pager needs the true total) but the line
    // is neither decoded nor hashed. Only the lines up to the window's end are chained, because no printed
    // address depends on a later line.
    if (tallyOnly || text === undefined) return
    // BEFORE the skip, and that position is load-bearing: a line's address must be the same whether it was
    // read in a three-line window or in a five-hundred-line one, so the chain has to run over the lines this
    // window does not RETURN — the skipped prefix is not skippable, because a hash carries its whole prefix.
    hash = chainHash(hash, text)
    if (count <= start) return
    if (raw.length >= opts.limit) {
      more = true
      tallyOnly = true
      return
    }
    // A long line is WRAPPED: chunks after the first name their character offset inside the line, so a reader
    // can tell WHERE they are, and the line's address stays on its first chunk. Chunks are added only while
    // they fit the output budget, and running out of budget SAYS SO instead of truncating in silence — a line
    // longer than the whole output would otherwise be dropped entirely, which is strictly worse than the
    // clipped form this replaces (that one always showed the first 2000 characters).
    const separator = raw.length > 0 ? 1 : 0
    const chunks: string[] = []
    let chunkBytes = 0
    let cursor = 0
    for (;;) {
      const chunk = text.slice(cursor, cursor + MAX_LINE_LENGTH)
      const piece = cursor === 0 ? chunk : `${LINE_CONTINUATION}${cursor}: ${chunk}`
      const pieceBytes = Buffer.byteLength(piece, "utf-8") + (chunks.length > 0 ? 1 : 0)
      if (bytes + separator + chunkBytes + pieceBytes > MAX_BYTES) {
        // The budget cannot hold even the FIRST chunk: the line is not shown, exactly as before.
        if (chunks.length === 0) {
          cut = true
          more = true
          tallyOnly = true
          return
        }
        const capped = `${LINE_CONTINUATION}${cursor}: ${LINE_OUTPUT_CAPPED}`
        chunks.push(capped)
        chunkBytes += Buffer.byteLength(capped, "utf-8") + 1
        break
      }
      chunks.push(piece)
      chunkBytes += pieceBytes
      cursor += chunk.length
      if (cursor >= text.length) break
    }
    raw.push(chunks.join("\n"))
    hashes.push(hashLabel(hash))
    bytes += separator + chunkBytes
  }

  return {
    push,
    tallyOnly: () => tallyOnly,
    result: () => ({ raw, hashes, count, cut, more, offset: opts.offset }),
  }
}

// ------------------------------------------------------------------
// Hex dump formatting
// ------------------------------------------------------------------

export interface HexDumpResult {
  lines: string[]
  offsetStart: number
  bytesShown: number
  truncated: boolean
}

export interface HexDumpOptions {
  offset: number     // 1-indexed byte offset
  limit: number      // max bytes to show
  maxTotalBytes: number  // max total text output bytes before truncation
}

/**
 * Format binary data as a classic hex dump table.
 *
 * Output per row (16 bytes):
 *   <8-digit offset>  <8-hex address>  <8 hex bytes> <8 hex bytes>  |<ASCII tail>|
 *
 * Example:
 *   00000000  3f19c2ea  48 65 6c 6c 6f 20 57 6f  72 6c 64 21 0a 00 00 00  |Hello World!....|
 *   00000010  9c0be411  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
 *
 * A BYTE ROW GETS AN ADDRESS, exactly as a text line does (owner, 2026-10-01: «Для бинарника тоже самое») —
 * the same chain, over the row's BYTES rather than a line's text. Two consequences are the whole point:
 *
 *   - rows are aligned to the FILE, never to `offset`. They used to begin wherever the caller pointed, which
 *     made a row's content — and so its address — depend on the WINDOW. `offset` now means «the first row
 *     shown is the one CONTAINING this byte». Without that, two reads of one file disagree and the address is
 *     a rendering of the call rather than of the file.
 *   - the chain runs from byte ZERO over every row, including the ones above the window nobody reads, because
 *     a hash carries its whole prefix. Same rule `lines()` follows for text, and it is what makes a re-read at
 *     another offset REPRODUCE an address rather than invent one. It costs ~77 ms per MiB of prefix
 *     (experiments/2026-10-01_hex-address), which is why `limit` pages by whole ROWS: a page that advanced by
 *     a byte count would re-show the row it stopped inside, for ever.
 *
 * The bytes reach the chain as a latin1 string — the 1:1 map from a byte to a code point, which is what
 * «binary» MEANS rather than a rendering of it. Qualified BEFORE the code was built on it, not after: 28 340
 * distinct rows produced 28 340 distinct strings, and a latin1 string does NOT hash to what the raw byte view
 * does — so a text address and a hex address over one file live in different spaces and can never resolve for
 * one another.
 */
export function formatHexDump(data: Uint8Array, opts: HexDumpOptions): HexDumpResult {
  const lines: string[] = []
  const start = Math.max(0, opts.offset - 1)
  const alignedStart = Math.floor(start / HEX_DUMP_BYTES_PER_ROW) * HEX_DUMP_BYTES_PER_ROW
  const rows = Math.max(1, Math.ceil(opts.limit / HEX_DUMP_BYTES_PER_ROW))
  const end = Math.min(data.length, alignedStart + rows * HEX_DUMP_BYTES_PER_ROW)
  let textBytes = 0
  let truncated = false
  let rowCount = 0
  let chain = 0

  for (let i = 0; i < end && !truncated; i += HEX_DUMP_BYTES_PER_ROW) {
    const rowEnd = Math.min(i + HEX_DUMP_BYTES_PER_ROW, data.length)
    // Hashed from byte zero, PRINTED only inside the window — the prefix is not skippable.
    chain = chainHash(chain, Buffer.from(data.subarray(i, rowEnd)).toString("latin1"))
    if (i < alignedStart) continue
    const rowHex: string[] = []
    const rowAscii: string[] = []

    for (let j = i; j < rowEnd; j++) {
      const b = data[j]
      rowHex.push(b.toString(16).padStart(2, "0"))
      rowAscii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".")
    }

    // Build the hex columns: 8 bytes, space, 8 bytes
    const leftHex = rowHex.slice(0, 8).join(" ")
    const rightHex = rowHex.slice(8).join(" ")
    const hexPart = rightHex.length > 0 ? `${leftHex}  ${rightHex}` : leftHex
    // Pad to consistent width: 8*3 - 1 + 2 + 8*3 - 1 = 47 chars (left) + 2 (gap) + up to 23 (right)
    const hexPadded = hexPart.padEnd(50)

    const asciiPart = rowAscii.join("")
    const line = `${i.toString(16).padStart(8, "0")}  ${hashLabel(chain)}  ${hexPadded}  |${asciiPart}|`

    const lineBytes = Buffer.byteLength(line, "utf-8") + (lines.length > 0 ? 1 : 0)
    if (textBytes + lineBytes > opts.maxTotalBytes && rowCount > 0) {
      truncated = true
      break
    }

    lines.push(line)
    textBytes += lineBytes
    rowCount++
  }

  return {
    lines,
    // The ALIGNED start, because that is what is actually shown — reporting `start` would name a byte the
    // output does not begin at, and the pager would then re-request a byte it already delivered.
    offsetStart: alignedStart + 1,
    bytesShown: Math.max(0, end - alignedStart),
    truncated,
  }
}
