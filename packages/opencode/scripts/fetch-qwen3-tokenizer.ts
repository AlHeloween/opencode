/**
 * Fetch Qwen3 tokenizer model and extract BPE data.
 *
 * Downloads tokenizer.json from HuggingFace (~15-25 MB), extracts
 * model.vocab + model.merges + added_tokens, and writes a compact
 * JSON file for the BPE encoder to load at runtime.
 *
 * Uses Qwen3-8B as canonical source — all Qwen3 models share the
 * same tokenizer.
 *
 * Usage: bun run scripts/fetch-qwen3-tokenizer.ts
 */

const HF_REPO = "Qwen/Qwen3-8B"
// Use /resolve/ to get actual file content (not LFS pointer)
const TOKENIZER_URL = `https://huggingface.co/${HF_REPO}/resolve/main/tokenizer.json`
const outputUrl = new URL("../src/tokenizers/qwen3/model.json", import.meta.url)
const OUTPUT_PATH = process.platform === "win32"
  ? outputUrl.pathname.slice(1)
  : outputUrl.pathname

interface HFAddedToken {
  id: number
  content: string
  special: boolean
}

interface HFTokenizerJson {
  added_tokens?: HFAddedToken[]
  model?: {
    type?: string
    vocab?: Record<string, number>
    merges?: string[]
  }
}

interface CompactModel {
  version: number
  source: string
  vocab: Record<string, number>
  merges: Record<string, number>
  specialTokens: Record<string, number>
  vocabSize: number
  preTokenizerPattern?: string
}

async function main() {
  console.log(`Fetching tokenizer from ${HF_REPO}...`)
  console.log(`URL: ${TOKENIZER_URL}`)

  const response = await fetch(TOKENIZER_URL)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  console.log("Downloading...")
  const total = Number(response.headers.get("content-length") ?? "0")
  const reader = response.body!.getReader()
  const chunks: Uint8Array[] = []
  let downloaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    downloaded += value.length
    if (total > 0) {
      const pct = ((downloaded / total) * 100).toFixed(1)
      process.stdout.write(`\r  ${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB (${pct}%)`)
    }
  }
  console.log()

  const buffer = Buffer.concat(chunks)
  console.log(`Parsing ${(buffer.length / 1024 / 1024).toFixed(1)} MB JSON...`)

  const raw = JSON.parse(buffer.toString("utf-8")) as HFTokenizerJson

  if (!raw.model) {
    throw new Error("No model section found in tokenizer.json")
  }

  console.log(`Model type: ${raw.model.type ?? "unknown"}`)

  // Extract vocab
  const vocab = raw.model.vocab ?? {}
  console.log(`Vocab entries: ${Object.keys(vocab).length.toLocaleString()}`)

  // Extract merges: flat "tokA tokB" or nested [tokA, tokB] → rank index
  const merges: Record<string, number> = {}
  const mergeArray = raw.model.merges ?? []
  for (let i = 0; i < mergeArray.length; i++) {
    const entry = mergeArray[i]
    if (Array.isArray(entry)) {
      // Nested format: [tokA, tokB] → "tokA tokB"
      merges[entry[0] + " " + entry[1]] = i
    } else {
      // Flat format: "tokA tokB"
      merges[entry] = i
    }
  }
  console.log(`Merge rules: ${mergeArray.length.toLocaleString()}`)

  // Extract special tokens
  const specialTokens: Record<string, number> = {}
  for (const tok of raw.added_tokens ?? []) {
    specialTokens[tok.content] = tok.id
  }
  console.log(`Special tokens: ${Object.keys(specialTokens).length}`)

  // Extract pre-tokenizer regex pattern
  let preTokenizerPattern: string | undefined
  const pretok = (raw as Record<string, unknown>).pre_tokenizer as Record<string, unknown> | undefined
  if (pretok?.type === "Sequence" && Array.isArray(pretok.pretokenizers)) {
    for (const pt of pretok.pretokenizers as Array<Record<string, unknown>>) {
      if (pt.type === "Split" && pt.pattern && typeof pt.pattern === "object") {
        const pattern = (pt.pattern as Record<string, string>).Regex
        if (pattern) {
          preTokenizerPattern = pattern
          console.log(`Pre-tokenizer pattern extracted`)
        }
      }
    }
  }

  const compact: CompactModel = {
    version: 1,
    source: HF_REPO,
    vocab,
    merges,
    specialTokens,
    vocabSize: Object.keys(vocab).length,
    preTokenizerPattern,
  }

  console.log(`Writing to ${OUTPUT_PATH}...`)
  await Bun.write(OUTPUT_PATH, JSON.stringify(compact))

  const outFile = Bun.file(OUTPUT_PATH)
  console.log(`Done! Model file: ${(outFile.size / 1024 / 1024).toFixed(1)} MB`)
}

main().catch((err) => {
  console.error("Failed:", err)
  process.exit(1)
})
