/**
 * Real token counting, but only for the part of the window the provider cannot tell
 * us about.
 *
 * The ABSOLUTE size of the window comes from the provider: `prompt_tokens` on the
 * last response is exact, free, and already includes the system prefix and the tool
 * schemas that `estimateContentTokens` never looks at (measured on this session:
 * 493 088 tokens of parts + 99 390 of unmeasured prefix/schemas/framing = 592 478
 * billed). So only the GROWTH since that response needs counting.
 *
 * Growth is small by construction: a tool result is ~2.8k chars at the median and
 * the answer is bounded by the 32 768 output ceiling. That is what makes a real
 * tokenizer affordable at all — counting the whole window instead costs 967 ms for
 * the 1.7 MB visible window at 1.9 Mchars/s (`experiments/2026-09-18_tokenizer-gap/
 * bench.mts`) and this counter runs two to three times per turn, while the growth
 * costs 1.2 ms typically and 64 ms at the answer ceiling.
 *
 * `chars/4` is NOT a usable growth unit: measured on our own corpus the divisor is a
 * function of the script — 5.20 chars/token English, 3.69 Russian, 1.30 Chinese,
 * 1.78 for a mixed technical answer (`samples.py`, `last_answer.py`). A single
 * constant cannot cover a 4x spread, which is precisely why the absolute is taken
 * from the provider rather than estimated.
 *
 * Degradation is MANDATORY, not a nicety: this is the `tiktoken` JS/WASM package and
 * its Node entry reads `tiktoken_bg.wasm` from disk. A compiled binary may not carry
 * that file, and an unavailable tokenizer must not break a turn — it falls back to
 * `chars/4` and reports itself as inexact, so callers and logs can say which one ran.
 */
import { createRequire } from "node:module"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.token-count" })

/** Same divisor the fallback path has always used; see the note above for why it lies. */
const CHARS_PER_TOKEN = 4

interface Encoder {
  encode_ordinary(text: string): Uint32Array
}

/** `undefined` = not probed yet, `null` = probed and unavailable. */
let encoder: Encoder | null | undefined
/** Logged once, so a missing binary warns rather than spamming every turn. */
let warned = false

function encoderOrNull(): Encoder | null {
  if (encoder !== undefined) return encoder
  try {
    // Synchronous on purpose: `computeOpenWindowTokens` is a pure sync function on
    // the path that decides both compaction thresholds. An async init here would
    // turn the whole budget into a Promise for no gain.
    const mod = createRequire(import.meta.url)("tiktoken") as { get_encoding(name: string): Encoder }
    encoder = mod.get_encoding("o200k_base")
    log.info("token counter installed", { encoding: "o200k_base" })
  } catch (e) {
    encoder = null
    if (!warned) {
      warned = true
      log.warn("bug: tokenizer unavailable — window growth will be estimated by chars/4", {
        error: String(e),
        consequence: "growth is undercounted for code and non-Latin scripts (measured 1.2-3.1x)",
      })
    }
  }
  return encoder
}

/**
 * Tokens for `text`, exactly when the tokenizer is available and by `chars/4` when
 * it is not. Never throws: a counter that fails on content is not a counter — the
 * default `encode` even throws on the literal `<|endoftext|>`, which our own
 * transcript contains, so only `encode_ordinary` is used.
 */
export function countTokens(text: string): number {
  if (!text) return 0
  const enc = encoderOrNull()
  if (enc) {
    try {
      return enc.encode_ordinary(text).length
    } catch (e) {
      if (!warned) {
        warned = true
        log.warn("bug: token count failed — falling back to chars/4", { error: String(e) })
      }
    }
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Whether counts are exact. Reported in logs so a fallback run is never mistaken for a measured one. */
export function tokenCounterExact(): boolean {
  return encoderOrNull() !== null
}
