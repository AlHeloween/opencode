/**
 * Provider Files API — upload once, address by id.
 *
 * Why this exists, measured 2026-10-04 on `d:/!!!`: every pasted screenshot was
 * re-sent inline, so one request carried 15 base64 PNGs — 5.77 MB of a 7.75 MB
 * payload — and `raw-wire` wrote 137 MB across 17 requests in a single sitting.
 *
 * WHAT IT BUYS AND WHAT IT DOES NOT. Bytes, not money. An image bills as at most
 * 1024 tokens (api-docs.deepseek.com vision docs), so on a warm cache at
 * $0.003/M fifteen of them cost about $0.000046 — noise against a bill that is
 * 75.5% completion. This buys a 7.75 MB → ~0.06 MB payload and removes the
 * approach to the 48 MiB body limit that every unfolded screenshot walks
 * toward. It is not a cost optimisation, and treating it as one would rank it
 * above the reasoning tokens that actually are the bill.
 *
 * THE PROVIDER HAS NO STATE. The upload response is `id, object, bytes,
 * created_at, filename, purpose, expires_at` — no status, no processing. So
 * there is nothing to poll: a file is either accepted or the request failed,
 * and "ready" is established by asking (`files.retrieve`) rather than waiting.
 */

const DEEPSEEK_BASE = "https://api.deepseek.com"

/** What the provider reports about a stored file. */
export interface ProviderFile {
  fileId: string
  bytes: number
  filename?: string
  createdAt: number
  /** Epoch ms, or null when the upload asked for no term. */
  expiresAt: number | null
}

/** Our row for a stored file — the receipt that makes a `file_id` usable. */
export interface FileRecord {
  fileId: string
  expiresAt: number | null
  verifiedAt: number | null
}

/**
 * A file may be referenced only when it has been verified and its term has not
 * run out.
 *
 * `verifiedAt` is part of the predicate on purpose: the provider exposes no
 * state to read, so "we asked and it answered" is the only evidence a file is
 * there, and an unverified id sent on faith fails later and further from its
 * cause. An expiry with no clock is worse than no expiry — it would refuse a
 * permanent file — so a null term means permanent, exactly as the API means it.
 */
export function fileIsUsable(record: FileRecord, now: number): boolean {
  if (record.verifiedAt === null) return false
  if (record.expiresAt !== null && record.expiresAt <= now) return false
  return true
}

function parseFile(json: { id?: string; bytes?: number; filename?: string; created_at?: number; expires_at?: number }): ProviderFile {
  if (!json.id) throw new Error("files API returned no id")
  return {
    fileId: json.id,
    bytes: json.bytes ?? 0,
    filename: json.filename,
    createdAt: (json.created_at ?? 0) * 1000,
    expiresAt: json.expires_at === undefined ? null : json.expires_at * 1000,
  }
}

function authHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
}

/**
 * Upload one file. `expiresAfterSeconds` is omitted for a permanent file; the
 * API accepts 3600 … 2592000 when present.
 */
export async function uploadFile(input: {
  apiKey: string
  data: Uint8Array
  filename: string
  mime: string
  expiresAfterSeconds?: number
  baseUrl?: string
}): Promise<ProviderFile> {
  const base = input.baseUrl ?? DEEPSEEK_BASE
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(input.data)], { type: input.mime }), input.filename)
  form.append("purpose", "user_data")
  if (input.expiresAfterSeconds !== undefined) {
    form.append("expires_after[anchor]", "created_at")
    form.append("expires_after[seconds]", String(input.expiresAfterSeconds))
  }
  const response = await fetch(base + "/files", { method: "POST", headers: authHeaders(input.apiKey), body: form })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`files upload failed ${response.status}: ${text.slice(0, 200)}`)
  }
  return parseFile((await response.json()) as never)
}

/**
 * Prove a file is still there. This is the whole of "is it ready" — there is no
 * status field to poll.
 */
export async function retrieveFile(input: {
  apiKey: string
  fileId: string
  baseUrl?: string
}): Promise<ProviderFile | null> {
  const base = input.baseUrl ?? DEEPSEEK_BASE
  const response = await fetch(`${base}/files/${encodeURIComponent(input.fileId)}`, {
    headers: authHeaders(input.apiKey),
  })
  if (!response.ok) return null
  return parseFile((await response.json()) as never)
}

export async function deleteFile(input: { apiKey: string; fileId: string; baseUrl?: string }): Promise<boolean> {
  const base = input.baseUrl ?? DEEPSEEK_BASE
  const response = await fetch(`${base}/files/${encodeURIComponent(input.fileId)}`, {
    method: "DELETE",
    headers: authHeaders(input.apiKey),
  })
  return response.ok
}