import type { TokenizerModel, TokenizerInstance } from "../types"
import { BPETokenizer } from "../bpe-encoder"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tokenizer.qwen3" })

let tokenizer: BPETokenizer | undefined
let loadAttempted = false

async function loadModel(): Promise<TokenizerModel | undefined> {
  try {
    const rawPath = new URL("./model.json", import.meta.url).pathname
    const path = process.platform === "win32" ? rawPath.slice(1) : rawPath
    const file = Bun.file(path)
    if (!(await file.exists())) return undefined
    return (await file.json()) as TokenizerModel
  } catch {
    return undefined
  }
}

export async function loadQwen3(): Promise<TokenizerInstance | undefined> {
  if (tokenizer) return tokenizer
  if (loadAttempted) return undefined

  loadAttempted = true
  const model = await loadModel()
  if (!model) {
    log.debug("model.json not found, qwen3 tokenizer unavailable")
    return undefined
  }
  tokenizer = new BPETokenizer(model)
  log.debug("qwen3 tokenizer loaded", { vocabSize: model.vocabSize })
  return tokenizer
}

export function getQwen3(): TokenizerInstance | undefined {
  return tokenizer
}

export function preloadQwen3(): void {
  loadQwen3()
}

export * as Qwen3Loader from "./loader"
