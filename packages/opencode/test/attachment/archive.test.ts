import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ArchiveHandler } from "../../src/attachment/handlers/archive"

// Minimal valid ZIP file (local file header + central directory + EOCD)
function makeZipBuffer(): Buffer {
  const fileName = Buffer.from("test.txt")
  const fileContent = Buffer.from("hello world")

  // Local file header
  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0) // signature
  localHeader.writeUInt16LE(20, 4)          // version needed
  localHeader.writeUInt16LE(0, 6)           // flags
  localHeader.writeUInt16LE(0, 8)           // compression (stored)
  localHeader.writeUInt16LE(0, 10)          // mod time
  localHeader.writeUInt16LE(0, 12)          // mod date
  localHeader.writeUInt32LE(0, 14)          // crc32
  localHeader.writeUInt32LE(fileContent.length, 18) // compressed size
  localHeader.writeUInt32LE(fileContent.length, 22) // uncompressed size
  localHeader.writeUInt16LE(fileName.length, 26)
  localHeader.writeUInt16LE(0, 28) // extra field length

  // Central directory
  const centralDir = Buffer.alloc(46)
  centralDir.writeUInt32LE(0x02014b50, 0)
  centralDir.writeUInt16LE(20, 4)
  centralDir.writeUInt16LE(20, 6)
  centralDir.writeUInt16LE(0, 8)
  centralDir.writeUInt16LE(0, 10)
  centralDir.writeUInt16LE(0, 12)
  centralDir.writeUInt16LE(0, 14)
  centralDir.writeUInt32LE(0, 16)
  centralDir.writeUInt32LE(fileContent.length, 20)
  centralDir.writeUInt32LE(fileContent.length, 24)
  centralDir.writeUInt16LE(fileName.length, 28)
  centralDir.writeUInt16LE(0, 30)
  centralDir.writeUInt16LE(0, 32)
  centralDir.writeUInt16LE(0, 34)
  centralDir.writeUInt32LE(0, 36)
  centralDir.writeUInt32LE(30, 42) // offset to local header

  // End of central directory
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)  // entries in disk
  eocd.writeUInt16LE(1, 10) // total entries
  eocd.writeUInt32LE(46, 12) // central dir size
  eocd.writeUInt32LE(30 + fileName.length + fileContent.length, 16) // offset
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([localHeader, fileName, fileContent, centralDir, fileName, eocd])
}

function makeDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`
}

describe("ArchiveHandler", () => {
  test("detect returns true for archive mime types", () => {
    expect(ArchiveHandler.detect("application/zip")).toBe(true)
    expect(ArchiveHandler.detect("application/gzip")).toBe(true)
    expect(ArchiveHandler.detect("application/x-7z-compressed")).toBe(true)
    expect(ArchiveHandler.detect("application/x-tar")).toBe(true)
    expect(ArchiveHandler.detect("application/x-rar-compressed")).toBe(true)
    expect(ArchiveHandler.detect("image/png")).toBe(false)
  })

  test("classify extracts metadata from ZIP data URL", async () => {
    const zip = makeZipBuffer()
    const url = makeDataUrl(zip, "application/zip")
    const att = { type: "file", kind: "archive", mime: "application/zip", url, filename: "test.zip" } as any

    const result = await Effect.runPromise(ArchiveHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("archive")
    const meta = result.metadata as any
    expect(meta).toBeDefined()
    expect(meta._tag).toBe("archive")
    expect(meta.fileCount).toBe(1)
    expect(meta.compressedSize).toBeGreaterThan(0)
  })

  test("classify handles non-data URL", async () => {
    const att = { type: "file", kind: "archive", mime: "application/zip", url: "https://example.com/file.zip" } as any
    const result = await Effect.runPromise(ArchiveHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("archive")
    expect((result.metadata as any).fileCount).toBe(0)
  })

  test("describe formats archive info", () => {
    const att: any = {
      kind: "archive", mime: "application/zip", filename: "bundle.zip",
      metadata: { _tag: "archive", fileCount: 42, compressedSize: 1024000 },
    }
    const desc = ArchiveHandler.describe(att)
    expect(desc).toContain("bundle.zip")
    expect(desc).toContain("42 files")
    expect(desc).toContain("1000")
  })

  test("render returns TUI badge", () => {
    const att: any = {
      kind: "archive", mime: "application/zip", filename: "archive.zip",
      metadata: { _tag: "archive", fileCount: 5 },
    }
    const rendered = ArchiveHandler.render(att)
    expect(rendered.badge.text).toBe("zip")
    expect(rendered.label).toBe("archive.zip")
    expect(rendered.preview).toBe("5 files")
  })
})
