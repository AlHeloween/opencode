import fs from "fs/promises"
import path from "path"
import { randomBytes } from "node:crypto"
import * as Log from "@opencode-ai/core/util/log"

const VERSION = 1
const ALGORITHM = "AES-256-GCM"
const KEY_FILE = ".opencode.encryption.key"

const log = Log.create({ service: "encrypted-json" })

type Payload = {
  version: number
  algorithm: string
  iv: string
  ciphertext: string
}

function isPayload(value: unknown): value is Payload {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.version === VERSION &&
    record.algorithm === ALGORITHM &&
    typeof record.iv === "string" &&
    typeof record.ciphertext === "string"
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

export function encryptedPath(filepath: string) {
  return `${filepath}.enc`
}

export function keyPath(filepath: string) {
  return path.join(path.dirname(filepath), KEY_FILE)
}

async function readKey(filepath: string) {
  const keyFile = keyPath(filepath)
  try {
    const key = Buffer.from((await fs.readFile(keyFile, "utf8")).trim(), "base64")
    if (key.length !== 32) throw new Error(`invalid encrypted storage key length at ${keyFile}`)
    return key
  } catch (error) {
    if (!isNotFound(error)) throw error
    const key = randomBytes(32)
    await fs.mkdir(path.dirname(keyFile), { recursive: true })
    await fs.writeFile(keyFile, key.toString("base64"), { mode: 0o600 })
    return key
  }
}

async function importKey(filepath: string) {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(await readKey(filepath)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  )
}

async function encrypt(filepath: string, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(filepath), new TextEncoder().encode(plaintext)),
  )
  return JSON.stringify(
    {
      version: VERSION,
      algorithm: ALGORITHM,
      iv: Buffer.from(iv).toString("base64"),
      ciphertext: Buffer.from(ciphertext).toString("base64"),
    } satisfies Payload,
    null,
    2,
  )
}

async function decrypt(filepath: string, payload: Payload) {
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(Buffer.from(payload.iv, "base64")) },
      await importKey(filepath),
      new Uint8Array(Buffer.from(payload.ciphertext, "base64")),
    ),
  )
}

export async function readText(filepath: string): Promise<string | undefined> {
  const storage = encryptedPath(filepath)
  try {
    const payload = JSON.parse(await fs.readFile(storage, "utf8")) as unknown
    if (!isPayload(payload)) {
      log.warn("ignored invalid encrypted json payload", { path: storage })
      return undefined
    }
    return await decrypt(filepath, payload)
  } catch (error) {
    if (!isNotFound(error)) {
      log.warn("failed to read encrypted json payload", { path: storage, error: errorMessage(error) })
    }
    return undefined
  }
}

export async function writeText(filepath: string, plaintext: string): Promise<void> {
  const storage = encryptedPath(filepath)
  const tmp = `${storage}.tmp.${process.pid}.${Date.now().toString(36)}`
  await fs.mkdir(path.dirname(storage), { recursive: true })
  await fs.writeFile(tmp, await encrypt(filepath, plaintext), { mode: 0o600 })
  await fs.rename(tmp, storage)
  await fs.chmod(storage, 0o600).catch(() => undefined)
}

export async function writeJson(filepath: string, value: unknown): Promise<void> {
  await writeText(filepath, JSON.stringify(value, null, 2))
}

export async function mirrorText(filepath: string, plaintext: string): Promise<void> {
  await writeText(filepath, plaintext).catch((error) => {
    log.warn("failed to mirror plaintext json to encrypted storage", {
      path: encryptedPath(filepath),
      error: errorMessage(error),
    })
  })
}

export async function mirrorJson(filepath: string, value: unknown): Promise<void> {
  await mirrorText(filepath, JSON.stringify(value, null, 2))
}
