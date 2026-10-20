import { fileIsUsable, retrieveFile, uploadFile } from "./files-api"

/**
 * Upload-once cache for provider-hosted images, keyed by content hash (t103).
 *
 * Why this exists: every pasted screenshot was re-sent inline on every turn
 * (measured 2026-10-04: 5.77 MB of base64 in a 7.75 MB request). Where the
 * provider offers file storage (DeepSeek Files API: `POST /files` →
 * `{"type":"file","file_id":"…"}`), the bytes are uploaded ONCE and every
 * later send addresses the id. Where it does not, the caller sends inline
 * webp — the return is `null`, never a throw (upload failure falls back to
 * inline, per plan T2's rollback rule).
 *
 * Scope, stated plainly: this module owns dedup + verification. It does NOT
 * touch the wire — emitting `{"type":"file","file_id"}` needs a ModelMessage
 * reference shape that our UI-message pipeline cannot produce without a
 * transport-level hook (t103 residual: the DeepSeek SDK converter only emits
 * `file_id` for `data.type === "reference"` parts, which `standardizePrompt`
 * never builds from a data URL). The cache is therefore live-tested at unit
 * level and wired at emission once that hook exists.
 *
 * The map is process-local on purpose: no new table, no DB in the unit path
 * (cross-restart persistence rides on `files-storage` keyed by `file_id`
 * once parts carry it). An upload is cheap; a phantom reference is not.
 */
interface CachedFile {
  fileId: string
  expiresAt: number | null
  verifiedAt: number | null
  providerID: string
}

const byHash = new Map<string, CachedFile>()

/** Tests only: drop every cached reference. */
export function __resetFilesCache(): void {
  byHash.clear()
}

function cacheKey(data: Uint8Array, providerID: string, baseUrl: string | undefined): string {
  const hash = new Bun.CryptoHasher("sha256").update(data).digest("hex")
  return `${providerID}@${baseUrl ?? "default"}:${hash}`
}

async function withFetch<T>(fetchFn: typeof fetch | undefined, fn: () => Promise<T>): Promise<T> {
  if (!fetchFn) return fn()
  const prev = globalThis.fetch
  globalThis.fetch = fetchFn
  try {
    return await fn()
  } finally {
    globalThis.fetch = prev
  }
}

export interface FileImageInput {
  apiKey: string
  baseUrl?: string
  providerID: string
  data: Uint8Array
  mime: string
  filename: string
  expiresAfterSeconds?: number
  /** Tests only: stub the network. Production passes nothing (global fetch). */
  fetchFn?: typeof fetch
}

/**
 * The `file_id` for these bytes, uploading once per distinct content.
 * Returns `null` when there is nothing usable to address (upload refused,
 * retrieve answered non-OK, network down) — the caller then sends inline
 * webp. Never throws for transport reasons.
 */
export async function fileIdForImage(input: FileImageInput): Promise<string | null> {
  const now = Date.now()
  const key = cacheKey(input.data, input.providerID, input.baseUrl)
  const hit = byHash.get(key)
  if (hit && fileIsUsable({ fileId: hit.fileId, expiresAt: hit.expiresAt, verifiedAt: hit.verifiedAt }, now)) {
    return hit.fileId
  }
  try {
    const uploaded = await withFetch(input.fetchFn, () =>
      uploadFile({
        apiKey: input.apiKey,
        data: input.data,
        filename: input.filename,
        mime: input.mime,
        expiresAfterSeconds: input.expiresAfterSeconds,
        baseUrl: input.baseUrl,
      }),
    )
    // "Ready" is established by asking, never by waiting: the upload response
    // carries no status field, so an unverified id sent on faith fails later
    // and further from its cause (files-api.ts contract).
    const verified = await withFetch(input.fetchFn, () =>
      retrieveFile({ apiKey: input.apiKey, fileId: uploaded.fileId, baseUrl: input.baseUrl }),
    )
    if (!verified) return null
    byHash.set(key, {
      fileId: uploaded.fileId,
      expiresAt: uploaded.expiresAt,
      verifiedAt: now,
      providerID: input.providerID,
    })
    return uploaded.fileId
  } catch {
    return null
  }
}
