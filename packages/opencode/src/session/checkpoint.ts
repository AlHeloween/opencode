/**
 * Per-Model Encrypted Conversation Checkpoint.
 *
 * Stores the fully-assembled model-ready conversation state (system prompt +
 * AI SDK messages) as an encrypted checkpoint file. On restart or model
 * switch, the checkpoint is loaded — eliminating per-turn prompt assembly
 * and reducing DB reads to delta messages only.
 *
 * Reuses AES-256-GCM encryption from request-diff.ts.
 * Atomic write via temp file + rename — no partial state touches disk.
 */
import fs from "fs/promises"
import path from "path"
import { createHash } from "crypto"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { errorMessage } from "@/util/error"
import {
  deriveKey,
  encryptBaseline,
  decryptBaseline,
} from "./request-diff"
import type { ModelMessage } from "ai"

const log = Log.create({ service: "checkpoint" })

/** v4: require identityFingerprint so kernel/identity migrations cannot silently
 *  pair a new identity prefix with a checkpoint assembled under an old kernel. */
export const CHECKPOINT_VERSION = 4
export const CHECKPOINT_KIND = "checkpoint" as const
const CHECKPOINT_DIR = ".checkpoints"
const CHECKPOINT_SLOTS = 2

export interface CheckpointData {
  kind: typeof CHECKPOINT_KIND
  version: number
  systemPrompt: string[]
  /**
   * SHA-256 of the identity prefix (reasoning + agent prompt) that was active
   * when this checkpoint was written. Load rejects mismatches so a kernel or
   * agent-prompt change rebuilds system state instead of mixing eras.
   */
  identityFingerprint: string
  messages: ModelMessage[]
  messageIDs: string[]
  model: { providerID: string; modelID: string }
  agent: string
  turn: number
  timestamp: number
}

/** Byte-stable fingerprint of the session identity prefix. */
export function identityFingerprint(identity: string): string {
  return createHash("sha256").update(identity, "utf8").digest("hex")
}

/**
 * True when the checkpoint was saved under the same identity bytes currently
 * in force. Missing fingerprint or version is treated as incompatible.
 */
export function isIdentityCompatible(data: CheckpointData, currentIdentity: string): boolean {
  if (data.version !== CHECKPOINT_VERSION) return false
  if (!data.identityFingerprint) return false
  return data.identityFingerprint === identityFingerprint(currentIdentity)
}

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export function checkpointDir(_sessionID: string): string {
  return path.join(Global.Path.log, CHECKPOINT_DIR)
}

export function checkpointPath(sessionID: string, providerID: string, modelID: string, agentName?: string): string {
  const safeProvider = sanitize(providerID)
  const safeModel = sanitize(modelID)
  const safeSid = sanitize(sessionID)
  const safeAgent = agentName ? sanitize(agentName) : ""
  return path.join(checkpointDir(sessionID), `${safeProvider}_${safeModel}_${safeAgent ? safeAgent + "_" : ""}${safeSid}.enc`)
}

/** Return slot file paths for rotating checkpoints. */
function checkpointSlotPaths(
  sessionID: string, providerID: string, modelID: string, agentName?: string,
): string[] {
  const base = checkpointPath(sessionID, providerID, modelID, agentName)
  return Array.from({ length: CHECKPOINT_SLOTS }, (_, i) =>
    base.replace(/\.enc$/, `_S${i}.enc`),
  )
}

/** Pick the slot with the OLDER mtime (or first non-existing slot). */
async function olderSlot(slots: string[]): Promise<string> {
  const stats = await Promise.all(
    slots.map(async (p) => {
      try {
        const s = await fs.stat(p)
        return { path: p, mtime: s.mtimeMs }
      } catch {
        return { path: p, mtime: 0 }
      }
    }),
  )
  return stats.reduce((oldest, curr) => (curr.mtime <= oldest.mtime ? curr : oldest), stats[0]).path
}

/** Try to decrypt and parse a checkpoint file. Returns null on failure. */
async function tryLoadSlot(filePath: string, encKey: CryptoKey): Promise<CheckpointData | null> {
  try {
    const encrypted = await fs.readFile(filePath)
    const plaintext = await decryptBaseline(encrypted, encKey)
    const data: CheckpointData = JSON.parse(plaintext)
    if (
      data.kind !== CHECKPOINT_KIND ||
      data.version !== CHECKPOINT_VERSION ||
      typeof data.identityFingerprint !== "string" ||
      data.identityFingerprint.length === 0
    ) {
      try { await fs.unlink(filePath) } catch (e) {
        log.debug("checkpoint corrupt file unlink failed", { filePath, error: errorMessage(e) })
      }
      return null
    }
    return data
  } catch (e) {
    log.warn("bug: checkpoint slot load failed", { filePath, error: errorMessage(e) })
    try { await fs.unlink(filePath) } catch (e2) {
      log.debug("checkpoint corrupt file unlink failed", { filePath, error: errorMessage(e2) })
    }
    return null
  }
}

async function writeAtomic(filePath: string, data: Buffer): Promise<void> {
  const tmpPath = filePath + ".tmp." + crypto.randomUUID()
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(tmpPath, data)
  await fs.rename(tmpPath, filePath)
}

/** Save checkpoint to encrypted file with 2-slot rotation.
 *  Writes to the slot with the OLDER mtime, preserving the newer slot as backup. */
export function save(input: {
  sessionID: string
  projectID: string
  data: CheckpointData
}): Effect.Effect<void> {
  return Effect.tryPromise({
    try: async () => {
      const slots = checkpointSlotPaths(
        input.sessionID,
        input.data.model.providerID,
        input.data.model.modelID,
        input.data.agent,
      )
      const filePath = await olderSlot(slots)
      const encKey = await deriveKey(input.projectID, input.sessionID)
      const plaintext = JSON.stringify(input.data)
      const encrypted = await encryptBaseline(plaintext, encKey)
      await writeAtomic(filePath, encrypted)
    },
    catch: (error) => new Error("Failed to save checkpoint", { cause: error }),
  }).pipe(Effect.catch(() => Effect.sync(() => {
    log.warn("bug: checkpoint save failed", {
      sessionID: input.sessionID,
      providerID: input.data.model.providerID,
      modelID: input.data.model.modelID,
      agent: input.data.agent,
    })
  })))
}

/** Load checkpoint from rotating slots. Tries newest slot first (by mtime). */
export function load(input: {
  sessionID: string
  providerID: string
  modelID: string
  projectID: string
  agentName?: string
}): Effect.Effect<CheckpointData | null> {
  return Effect.promise(async () => {
    const slots = checkpointSlotPaths(input.sessionID, input.providerID, input.modelID, input.agentName)
    const results = await Promise.all(
      slots.map(async (p) => {
        try {
          const s = await fs.stat(p)
          return { path: p, mtime: s.mtimeMs }
        } catch {
          return null
        }
      }),
    )
    const existing = results.filter((r): r is { path: string; mtime: number } => r !== null)
      .sort((a, b) => b.mtime - a.mtime)

    if (existing.length === 0) return null

    const encKey = await deriveKey(input.projectID, input.sessionID)
    for (const { path: filePath } of existing) {
      const data = await tryLoadSlot(filePath, encKey)
      if (data) return data
    }

    log.warn("bug: all checkpoint slots corrupt", { sessionID: input.sessionID })
    return null
  })
}

/** Load the OLDER checkpoint slot (for compaction fallback).
 *  Returns the checkpoint with the older mtime — guaranteed to have fewer messages. */
export function loadPrevious(input: {
  sessionID: string
  providerID: string
  modelID: string
  projectID: string
  agentName?: string
}): Effect.Effect<CheckpointData | null> {
  return Effect.promise(async () => {
    const slots = checkpointSlotPaths(input.sessionID, input.providerID, input.modelID, input.agentName)
    const results = await Promise.all(
      slots.map(async (p) => {
        try {
          const s = await fs.stat(p)
          return { path: p, mtime: s.mtimeMs }
        } catch {
          return null
        }
      }),
    )
    const existing = results.filter((r): r is { path: string; mtime: number } => r !== null)
      .sort((a, b) => a.mtime - b.mtime)  // ASCENDING — oldest first

    if (existing.length === 0) return null

    const encKey = await deriveKey(input.projectID, input.sessionID)
    for (const { path: filePath } of existing) {
      const data = await tryLoadSlot(filePath, encKey)
      if (data) return data
    }

    return null
  })
}

/** Remove all checkpoint files for a session (both slot and legacy formats). */
export function remove(sessionID: string): Effect.Effect<void> {
  return Effect.promise(async () => {
    const dir = checkpointDir(sessionID)
    try { await fs.access(dir) } catch { return }

    const safeSid = sanitize(sessionID)
    const entries = await fs.readdir(dir)
    for (const file of entries) {
      // Match both legacy (_sid.enc) and slot format (_sid_S0.enc, _sid_S1.enc)
      if (file.includes(`_${safeSid}_S`) || file.endsWith(`_${safeSid}.enc`)) {
        try { await fs.unlink(path.join(dir, file)) } catch (e) {
          log.debug("checkpoint remove failed", { sessionID, file, error: errorMessage(e) })
        }
      }
    }
    const remaining = await fs.readdir(dir)
    if (remaining.length === 0) await fs.rm(dir, { recursive: true, force: true })
  })
}

/** Find session ID of latest checkpoint matching provider/model/agent. */
export function findLatest(input: {
  providerID: string
  modelID: string
  agentName: string
  excludeSessionID?: string
}): Effect.Effect<string | null> {
  return Effect.promise(async () => {
    const dir = checkpointDir("")
    try { await fs.access(dir) } catch { return null }

    const prefix = `${sanitize(input.providerID)}_${sanitize(input.modelID)}_${sanitize(input.agentName)}_`
    const exclude = input.excludeSessionID ? sanitize(input.excludeSessionID) : null

    let latest: { sessionID: string; mtime: number } | null = null
    const entries = await fs.readdir(dir)
    for (const file of entries) {
      if (!file.startsWith(prefix) || !file.endsWith(".enc")) continue
      // Strip optional _S{N} slot suffix from session ID
      const raw = file.slice(prefix.length, -".enc".length)
      const sid = raw.replace(/_S\d+$/, "")
      if (exclude && sid === exclude) continue
      const stat = await fs.stat(path.join(dir, file))
      if (!latest || stat.mtimeMs > latest.mtime) {
        latest = { sessionID: sid, mtime: stat.mtimeMs }
      }
    }
    return latest?.sessionID ?? null
  })
}

/** Clone checkpoint from a previous session to a new session.
 *  Strips session-specific state (messages, turns) — keeps only system
 *  prompt for KV cache continuity across same-agent+model invocations. */
export function clone(input: {
  sourceSessionID: string
  destSessionID: string
  providerID: string
  modelID: string
  agentName: string
  projectID: string
}): Effect.Effect<void> {
  return Effect.flatMap(
    load({
      sessionID: input.sourceSessionID,
      providerID: input.providerID,
      modelID: input.modelID,
      projectID: input.projectID,
      agentName: input.agentName,
    }),
    (data) => {
      if (!data) return Effect.void
      return save({
        sessionID: input.destSessionID,
        projectID: input.projectID,
        data: { ...data, messages: [], messageIDs: [], turn: 0, timestamp: Date.now() },
      })
    },
  ).pipe(
    Effect.catch((e) =>
      Effect.sync(() => log.warn("bug: checkpoint clone failed", { error: errorMessage(e) })),
    ),
  )
}

export * as Checkpoint from "./checkpoint"
