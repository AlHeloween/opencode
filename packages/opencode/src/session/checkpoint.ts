/**
 * Per-Model Encrypted Conversation Checkpoint.
 *
 * Stores the fully-assembled model-ready conversation state (system prompt +
 * AI SDK messages) as an encrypted checkpoint file. On restart or model
 * switch, the checkpoint is loaded — eliminating per-turn prompt assembly
 * and reducing DB reads to delta messages only.
 *
 * Design (KV-cache continuous memory):
 * - Path system (skills/env/rules/AGENTS.md) is FROZEN until compaction or
 *   identity mismatch. Mid-session project file edits do not rebuild system —
 *   projects "go as they go" with a stable provider cache prefix.
 * - One checkpoint per provider+model+agent+session. Model switch does not
 *   lose the other model's slot; each model keeps its own continuous era.
 * - Compaction removes slots so message* / soft-hide state cannot mix with
 *   a pre-compact message-ID set.
 *
 * Reuses AES-256-GCM encryption from request-diff.ts.
 * Atomic write via temp file + rename — no partial state touches disk.
 *
 * Runtime: publish() updates an in-memory map synchronously so the next loop
 * step never races a forked disk write. Disk remains durability.
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
import type { MessageV2 } from "./message-v2"

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
   * Path system is NOT in this fingerprint — it freezes until compact.
   */
  identityFingerprint: string
  messages: ModelMessage[]
  messageIDs: string[]
  /**
   * Parallel to messageIDs: CacheControl.messageFingerprint(msg).hash at save.
   * Used to detect in-place content changes (background-jobs, tool parts, etc.)
   * so load re-converts from the first dirty message instead of reusing stale
   * model-ready bytes. Optional for older slots; next save fills them.
   */
  messageFingerprints?: string[]
  /**
   * Parallel to messageIDs: how many ModelMessage entries each DB message
   * produced in `messages`. Required for correct prefix reuse because
   * convertToModelMessages expands a single assistant tool-call message into
   * role:"assistant" + one or more role:"tool" result messages (not 1:1).
   * Slicing `messages` by messageIDs index drops tool results and triggers
   * AI_MissingToolResultsError. Optional for legacy slots; load falls back to
   * full reconversion when missing/misaligned.
   */
  modelMessageCounts?: number[]
  model: { providerID: string; modelID: string }
  agent: string
  turn: number
  timestamp: number
}

/** In-memory publish layer: key → latest CheckpointData for this process. */
const memory = new Map<string, CheckpointData>()

function memoryKey(
  sessionID: string,
  providerID: string,
  modelID: string,
  agentName?: string,
): string {
  return `${sessionID}\0${providerID}\0${modelID}\0${agentName ?? ""}`
}

/** Byte-stable fingerprint of the session identity prefix. */
export function identityFingerprint(identity: string): string {
  return createHash("sha256").update(identity, "utf8").digest("hex")
}

/**
 * True when the checkpoint was saved under the same identity bytes currently
 * in force. Missing fingerprint or version is treated as incompatible.
 * Does NOT include path system (AGENTS.md etc.) — by design for KV stability.
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

function isStructurallyValid(data: CheckpointData): boolean {
  return (
    data.kind === CHECKPOINT_KIND &&
    data.version === CHECKPOINT_VERSION &&
    typeof data.identityFingerprint === "string" &&
    data.identityFingerprint.length > 0
  )
}

/** Try to decrypt and parse a checkpoint file. Returns null on failure. */
async function tryLoadSlot(filePath: string, encKey: CryptoKey): Promise<CheckpointData | null> {
  try {
    const encrypted = await fs.readFile(filePath)
    const plaintext = await decryptBaseline(encrypted, encKey)
    const data: CheckpointData = JSON.parse(plaintext)
    if (!isStructurallyValid(data)) {
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

/**
 * Synchronously publish checkpoint for the next loop step (no disk race).
 * Call before forked save() so mid-turn tool steps see the latest messages.
 */
export function publish(input: {
  sessionID: string
  data: CheckpointData
}): void {
  const key = memoryKey(
    input.sessionID,
    input.data.model.providerID,
    input.data.model.modelID,
    input.data.agent,
  )
  memory.set(key, input.data)
}

/** Drop in-memory entries for a session (all models/agents). */
function clearMemorySession(sessionID: string): void {
  const prefix = `${sessionID}\0`
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key)
  }
}

/** Evict process memory without touching disk (tests / rare force-reload). */
export function dropMemory(sessionID: string): void {
  clearMemorySession(sessionID)
}

/**
 * Longest reusable prefix: same message IDs in order, content fingerprints match.
 * Suffix must be re-converted (new messages or in-place edits from first dirty).
 * Legacy slots without messageFingerprints trust ID order only (next save fills fps).
 *
 * NOTE: The returned length indexes messageIDs / messageFingerprints / modelMessageCounts
 * (DB messages), NOT data.messages. Use modelMessageEnd / takeModelPrefix to slice
 * ModelMessage[] — tool results expand so messages.length can exceed messageIDs.length.
 */
export function reusablePrefixLength(
  msgs: MessageV2.WithParts[],
  data: CheckpointData,
  fingerprint: (msg: MessageV2.WithParts) => string,
): number {
  // Cap by messageIDs only — do not use data.messages.length (1:N tool expansion).
  const n = Math.min(msgs.length, data.messageIDs.length)
  const fps = data.messageFingerprints
  const hasFp = Array.isArray(fps) && fps.length === data.messageIDs.length
  let prefix = 0
  for (let i = 0; i < n; i++) {
    if (msgs[i].info.id !== data.messageIDs[i]) break
    if (hasFp && fps![i] !== fingerprint(msgs[i])) break
    prefix++
  }
  return prefix
}

/**
 * Exclusive end index in data.messages for the first `prefixLen` DB messages.
 * Returns null when modelMessageCounts is missing or misaligned (legacy slots).
 */
export function modelMessageEnd(data: CheckpointData, prefixLen: number): number | null {
  const counts = data.modelMessageCounts
  if (!Array.isArray(counts) || counts.length !== data.messageIDs.length) return null
  if (prefixLen < 0 || prefixLen > counts.length) return null
  let end = 0
  for (let i = 0; i < prefixLen; i++) {
    const n = counts[i]
    if (typeof n !== "number" || n < 0 || !Number.isFinite(n)) return null
    end += n
  }
  if (end > data.messages.length) return null
  return end
}

/**
 * Model messages for the first `prefixLen` DB messages, or null when counts
 * are unavailable (caller must reconvert from DB).
 */
export function takeModelPrefix(data: CheckpointData, prefixLen: number): ModelMessage[] | null {
  const end = modelMessageEnd(data, prefixLen)
  if (end === null) return null
  return data.messages.slice(0, end)
}

/** Save checkpoint to encrypted file with 2-slot rotation + memory publish. */
export function save(input: {
  sessionID: string
  projectID: string
  data: CheckpointData
}): Effect.Effect<void> {
  // Publish first so the next loop step never waits on disk.
  publish({ sessionID: input.sessionID, data: input.data })

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

/** Load checkpoint: memory first, then newest disk slot. */
export function load(input: {
  sessionID: string
  providerID: string
  modelID: string
  projectID: string
  agentName?: string
}): Effect.Effect<CheckpointData | null> {
  return Effect.promise(async () => {
    const key = memoryKey(input.sessionID, input.providerID, input.modelID, input.agentName)
    const mem = memory.get(key)
    if (mem) {
      if (isStructurallyValid(mem)) return mem
      memory.delete(key)
    }

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
      if (data) {
        memory.set(key, data)
        return data
      }
    }

    log.warn("bug: all checkpoint slots corrupt", { sessionID: input.sessionID })
    return null
  })
}

/** Load the OLDER checkpoint slot (diagnostic / optional fallback). */
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
      .sort((a, b) => a.mtime - b.mtime)

    if (existing.length === 0) return null

    const encKey = await deriveKey(input.projectID, input.sessionID)
    for (const { path: filePath } of existing) {
      const data = await tryLoadSlot(filePath, encKey)
      if (data) return data
    }

    return null
  })
}

/** Remove all checkpoint files + memory for a session. */
export function remove(sessionID: string): Effect.Effect<void> {
  return Effect.promise(async () => {
    clearMemorySession(sessionID)
    const dir = checkpointDir(sessionID)
    try { await fs.access(dir) } catch { return }

    const safeSid = sanitize(sessionID)
    const entries = await fs.readdir(dir)
    for (const file of entries) {
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

/** Clone checkpoint system-only for subagent KV warm-start. */
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
        data: {
          ...data,
          messages: [],
          messageIDs: [],
          messageFingerprints: [],
          turn: 0,
          timestamp: Date.now(),
        },
      })
    },
  ).pipe(
    Effect.catch((e) =>
      Effect.sync(() => log.warn("bug: checkpoint clone failed", { error: errorMessage(e) })),
    ),
  )
}

export * as Checkpoint from "./checkpoint"
