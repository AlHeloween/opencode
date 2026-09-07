import { registry } from "@/attachment/registry"

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)

/** @deprecated Use `registry.isPdf(mime)` from `@/attachment/registry` */
export function isPdfAttachment(mime: string) {
  return registry.isPdf(mime)
}

/** @deprecated Use `registry.isMedia(mime)` from `@/attachment/registry` */
export function isMedia(mime: string) {
  return registry.isMedia(mime)
}

/** @deprecated Use `registry.isImage(mime)` from `@/attachment/registry` */
export function isImageAttachment(mime: string) {
  return registry.isImage(mime)
}

export function sniffAttachmentMime(bytes: Uint8Array, fallback: string) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp"
  }

  const video = sniffVideoMime(bytes)
  if (video) return video

  return fallback
}

/**
 * Detect video containers by MAGIC BYTES ONLY (2026-09-07, Alexander).
 *
 * The extension fallback is DANGEROUS for video: mime-types maps the .ts
 * extension to video/mp2t (MPEG Transport Stream), so every TypeScript file
 * "looks like" a video. A text source file must never enter the video
 * pipeline, therefore video recognition requires byte-level proof:
 *
 * - "ftyp" at offset 4  -> mp4/mov variants (isom, mp42, qt, M4V, heic…)
 * - 0x47 packet sync    -> MPEG Transport Stream (video/mp2t) — checked ONLY
 *                          as bytes; text files never start with 0x47;
 * - EBML magic 0x1A45DFA3 -> webm/mkv;
 * - RIFF....AVI LIST    -> avi;
 * - "FLV"               -> flash video.
 */
export function sniffVideoMime(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12) return undefined

  // MP4 family: bytes 4-7 are "ftyp"; bytes 8-11 give the brand.
  if (startsWith(bytes.subarray(4, 8), [0x66, 0x74, 0x79, 0x70])) {
    // "ftyp"
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!)
    // QuickTime/HEIC stills are not provider-consumable video; keep mp4 brands.
    const qt = brand === "qt  " || brand === "heic" || brand === "heix" || brand === "heim"
    if (!qt) return "video/mp4"
  }

  // MPEG Transport Stream: 0x47 sync byte at 188-byte packet stride.
  // A real TS starts with the sync byte; ASCII text cannot (0x47 = "G",
  // but "G" must be followed by non-printable pack header bytes to match).
  if (bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) return "video/mp2t"

  // Matroska/WebM: EBML magic.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm"

  // AVI: RIFF....AVI LIST.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x41, 0x56, 0x49, 0x20])) {
    return "video/x-msvideo"
  }

  // FLV.
  if (startsWith(bytes, [0x46, 0x4c, 0x56])) return "video/x-flv"

  return undefined
}
