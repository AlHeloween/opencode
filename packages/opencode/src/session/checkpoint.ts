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
import fs from "fs"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import {
  deriveKey,
  encryptBaseline,
  decryptBaseline,
} from "./request-diff"
import type { ModelMessage } from "ai"

export const CHECKPOINT_VERSION = 2
export const CHECKPOINT_KIND = "checkpoint" as const
const CHECKPOINT_DIR = ".checkpoints"

export interface CheckpointData {
  kind: typeof CHECKPOINT_KIND
  version: number
  systemPrompt: string[]
  messages: ModelMessage[]
  messageIDs: string[]
  model: { providerID: string; modelID: string }
  agent: string
  turn: number
  timestamp: number
}

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export function checkpointDir(_sessionID: string): string {
  return path.join(Global.Path.log, CHECKPOINT_DIR)
}

export function checkpointPath(sessionID: string, providerID: string, modelID: string): string {
  const safeProvider = sanitize(providerID)
  const safeModel = sanitize(modelID)
  const safeSid = sanitize(sessionID)
  return path.join(checkpointDir(sessionID), `${safeProvider}_${safeModel}_${safeSid}.enc`)
}

async function writeAtomic(filePath: string, data: Buffer): Promise<void> {
  const tmpPath = filePath + ".tmp." + Date.now().toString(36)
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(tmpPath, data)
  fs.renameSync(tmpPath, filePath)
}

/** Save checkpoint to encrypted file. Fire-and-forget safe — wraps in Effect. */
export function save(input: {
  sessionID: string
  projectID: string
  worktree: string
  data: CheckpointData
}): Effect.Effect<void> {
  return Effect.tryPromise({
    try: async () => {
      const filePath = checkpointPath(
        input.sessionID,
        input.data.model.providerID,
        input.data.model.modelID,
      )
      const encKey = await deriveKey(input.projectID, input.worktree, input.sessionID)
      const plaintext = JSON.stringify(input.data)
      const encrypted = await encryptBaseline(plaintext, encKey)
      await writeAtomic(filePath, encrypted)
    },
    catch: (error) => new Error("Failed to save checkpoint", { cause: error }),
  }).pipe(Effect.catch(() => Effect.void))
}

/** Load checkpoint from encrypted file. Returns null if not found or corrupt. */
export function load(input: {
  sessionID: string
  providerID: string
  modelID: string
  projectID: string
  worktree: string
}): Effect.Effect<CheckpointData | null> {
  return Effect.promise(async () => {
    const filePath = checkpointPath(input.sessionID, input.providerID, input.modelID)
    if (!fs.existsSync(filePath)) return null

    try {
      const encKey = await deriveKey(input.projectID, input.worktree, input.sessionID)
      const encrypted = fs.readFileSync(filePath)
      const plaintext = await decryptBaseline(encrypted, encKey)
      const data: CheckpointData = JSON.parse(plaintext)

      if (data.kind !== CHECKPOINT_KIND || data.version !== CHECKPOINT_VERSION) {
        try { fs.unlinkSync(filePath) } catch { /* cleanup */ }
        return null
      }

      return data
    } catch {
      try { fs.unlinkSync(filePath) } catch { /* cleanup */ }
      return null
    }
  })
}

/** Remove all checkpoint files for a session. */
export function remove(sessionID: string): Effect.Effect<void> {
  return Effect.sync(() => {
    const dir = checkpointDir(sessionID)
    if (!fs.existsSync(dir)) return

    const safeSid = sanitize(sessionID)
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(`_${safeSid}.enc`)) fs.unlinkSync(path.join(dir, file))
    }
    if (fs.readdirSync(dir).length === 0) fs.rmSync(dir, { recursive: true, force: true })
  })
}

export * as Checkpoint from "./checkpoint"
