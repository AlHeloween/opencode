import fs from "fs"
import path from "path"
import { EOL } from "os"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "gateway.wire-capture" })

/**
 * One exchange, one key (T4): every capture point of a single gateway exchange
 * writes under `<ISO-start>-<requestId>` so intent / sent / received files sort
 * and match together. UTC, filesystem-safe (`:` and `.` become `-`).
 */
export function isoFileStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, "-")
}

export function exchangeStem(startIso: string, requestId: string): string {
  return `${startIso}-${String(requestId).replace(/[^a-zA-Z0-9_-]/g, "_")}`
}

export interface WireAttemptRecord {
  dir: string
  stem: string
  requestId: string
  attempt: number
  protocol: string
  url: string
  method: string
  headers: Record<string, string>
  /** The EXACT string handed to the transport — stored verbatim (T2). */
  body: string
}

/**
 * Best-effort verbatim write of one transport attempt ("what WENT ONTO the
 * wire"). The record is written from inside the transport seam, so an h3→h2
 * fallback leaves one record per attempt that actually reached its seam.
 * Pretty/diff views are DERIVED from this file, never stored instead of it.
 * A write failure must never break the request: log `bug:` and continue.
 */
export function writeWireAttempt(record: WireAttemptRecord): string | undefined {
  try {
    fs.mkdirSync(record.dir, { recursive: true })
    const filePath = path.join(record.dir, `${record.stem}-attempt${record.attempt}.json`)
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          type: "wire",
          timestamp: Date.now(),
          id: record.requestId,
          protocol: record.protocol,
          attempt: record.attempt,
          url: record.url,
          method: record.method,
          headers: record.headers,
          body: record.body,
        },
        null,
        2,
      ).replace(/\n/g, EOL),
    )
    return filePath
  } catch (e) {
    log.warn("bug: raw-wire dump failed", {
      error: e instanceof Error ? e.message : String(e),
      stem: record.stem,
      attempt: record.attempt,
    })
    return undefined
  }
}
