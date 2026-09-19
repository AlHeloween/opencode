import { REPLAY_DELIVERED_MARKER } from "../../session/message-v2"

/**
 * Temporary data acquisition — the gateway's half: WITHHOLD, never supply.
 *
 * The division of labour, grounded in code rather than assumed (plan §0.1): the RUNTIME holds the
 * parts and the DB, so it acquires and re-attaches; the SET is a keyed record; the GATEWAY is the
 * only layer that sees the true outgoing body, so it is the only layer that can withhold — and
 * withholding needs no payload source, because the payload is ALREADY in the body being looked at.
 * Re-attaching from here would mean the gateway holding image bytes, which this design refuses
 * («кешировать не надо») and would duplicate ownership of the same bytes.
 *
 * The shape acted on is a `content[]` entry whose `type` is `image_url` and whose `image_url.url`
 * starts with `data:` (plan §0.3.1). A released or expired item's payload is replaced by a
 * one-line POINTER; a held item is untouched.
 *
 * Four rules, each bought by a defect:
 *
 *  1. **Withhold a released or expired item** — payload → pointer, byte-stable: a pure function of
 *     the item's fields, so two consecutive requests with the same set are byte-identical.
 *  2. **Keep a held item untouched.**
 *  3. **NEVER BLANK.** A replacement that cannot name an address leaves the payload ALONE. This is
 *     the invariant the `recall` `keep` defect bought: a reduction that blanks content is worse than
 *     no reduction at all, and "selected nothing" must fall through rather than delete.
 *  4. **No-op on an empty set**, and return the input UNCHANGED — the same string, not a
 *     re-serialisation — when the body does not parse or nothing matched. A transform that corrupts
 *     a request is worse than one that does nothing, and the byte-identity of the untouched case is
 *     what makes the flag-off control meaningful at T2.
 *
 * ## Matching is content-addressed, and that is a decision, not a convenience
 *
 * The body carries NO part id: an `image_url` entry is `{type, image_url: {url}}`. So the only thing
 * that can tie a body payload to a set item is the payload ITSELF. The alternative — matching the
 * `[Image N]` ordinal the transcript prints beside it — would couple this layer to the numbering
 * decision (§4.1, still open) and would break for any item acquired without a transcript label: a CUA
 * frame, a fetched document, a stored source.
 *
 * `payloadDigest` is therefore EXPORTED, so the runtime that acquires computes the digest with the
 * SAME function this layer matches with. Two implementations of "which payload is this" would drift
 * invisibly, and the drift would surface as an item that can never be released.
 */

export type TdaKind = "image" | "document" | "source"

export type TdaHeld = {
  /** The part id — what the pointer prints, so the runtime can find the bytes again. */
  id: string
  kind: TdaKind
  /** Why it was acquired. Printed in the pointer: a release without a motive is a silent edit. */
  reason: string
  /**
   * The last turn it is held for. A TURN, not a wall clock: a fold moves the window, not time, and
   * a span declared in turns survives a long sampling pause without silently expiring.
   */
  expiresAtTurn: number
  /** Digest of the base64 payload, from `payloadDigest` — the only handle a body payload exposes. */
  digest: string
  /**
   * The tool that can hand it back. Declared by the runtime, never invented here: naming a reader
   * that cannot return the item is exactly the defect the tool placeholder shipped once and had to
   * fix («re-read or re-run the tool» was impossible for a `task` result and unsafe for `bash`).
   * Absent = unknown, and the pointer then SAYS unknown instead of naming the wrong tool.
   */
  reader?: string
}

export type TdaSet = {
  held: TdaHeld[]
}

/**
 * Digest of the PAYLOAD — the base64 after `data:<mime>;base64,` — not of the wrapper, so a mime or
 * parameter change cannot orphan an item that is still in the window. One implementation, used by
 * the acquirer and by the matcher below.
 */
export function payloadDigest(url: string): string {
  const comma = url.indexOf(",")
  const payload = url.startsWith("data:") && comma >= 0 ? url.slice(comma + 1) : url
  return new Bun.CryptoHasher("sha256").update(payload).digest("hex")
}

/** The size convention the dropped-result placeholder uses, so the two surfaces read alike. */
function sizeLabel(chars: number): string {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)} KB` : `${chars} chars`
}

/**
 * The pointer that replaces a withheld payload — the SAME grammar the dropped-tool-result
 * placeholder prints, down to the shared `REPLAY_DELIVERED_MARKER`, so a reader who has learned one
 * has learned the other and `isReplayReduced` recognises both. Pure function of the item, so the
 * prefix is byte-stable across requests and the KV cache holds.
 */
export function withheldPointer(item: TdaHeld, payloadChars: number): string {
  const back =
    item.reader === undefined
      ? `the runtime (reader not declared for id=${item.id})`
      : `${item.reader}(id=${item.id})`
  return (
    `[${item.kind} id=${item.id} ${REPLAY_DELIVERED_MARKER}${sizeLabel(payloadChars)}, ${item.reason})` +
    ` — released; ${back} to attach it again]`
  )
}

/** Which content entries carry a payload this layer can withhold, and where that payload lives. */
function payloadUrl(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== "image_url") return undefined
  const media = entry.image_url
  if (!media || typeof media !== "object") return undefined
  const url = (media as Record<string, unknown>).url
  return typeof url === "string" && url.startsWith("data:") ? url : undefined
}

/**
 * The transform. Withhold what the set has released or let expire; leave everything else exactly
 * as it was; return the input string itself when nothing changed.
 */
export function applyTemporaryDataAcquisition(body: string, set: TdaSet, turn: number): string {
  if (set.held.length === 0) return body
  if (!body.trimStart().startsWith("{")) return body

  let parsed: { messages?: Array<Record<string, unknown>> }
  try {
    parsed = JSON.parse(body) as { messages?: Array<Record<string, unknown>> }
  } catch {
    return body
  }
  const messages = parsed.messages
  if (!Array.isArray(messages)) return body

  // Rule 3 at the entry to the replacement: an item without an address cannot be pointed at, so it
  // is dropped from the withholding set rather than replaced by a pointer that names nothing.
  const released = new Map<string, TdaHeld>()
  for (const item of set.held) {
    if (item.expiresAtTurn >= turn) continue
    if (!item.id) continue
    released.set(item.digest, item)
  }
  if (released.size === 0) return body

  let replaced = 0
  for (const message of messages) {
    const content = message.content
    if (!Array.isArray(content)) continue
    for (let index = 0; index < content.length; index++) {
      const entry = content[index]
      if (!entry || typeof entry !== "object") continue
      const url = payloadUrl(entry as Record<string, unknown>)
      if (url === undefined) continue
      const item = released.get(payloadDigest(url))
      if (item === undefined) continue
      content[index] = { type: "text", text: withheldPointer(item, url.length) }
      replaced++
    }
  }
  return replaced > 0 ? JSON.stringify(parsed) : body
}

/**
 * The set arrives in ONE header (`x-opencode-tda`, beside the other `x-opencode-*` session facts the
 * gateway already receives), so the parse and every one of its failure modes live here rather than in
 * the wiring.
 *
 * Every failure answers `undefined` — no header, malformed JSON, wrong shape, nothing held — because
 * this sits on the hot path of every request: an unreadable instruction must degrade to "nothing is
 * held", never to a throw and never to a half-applied set. That is the same rule the transform itself
 * follows when a body does not parse.
 *
 * `turn` travels WITH the set: expiry is counted in turns, and only the runtime knows which turn the
 * outgoing request belongs to.
 */
export function parseTdaHeader(value: string | undefined): { turn: number; set: TdaSet } | undefined {
  if (!value) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== "object") return undefined
  const candidate = parsed as { turn?: unknown; held?: unknown }
  if (typeof candidate.turn !== "number" || !Array.isArray(candidate.held)) return undefined
  const held = candidate.held.filter(isTdaHeld)
  return held.length === 0 ? undefined : { turn: candidate.turn, set: { held } }
}

const TDA_KINDS: ReadonlyArray<TdaKind> = ["image", "document", "source"]

function isTdaHeld(value: unknown): value is TdaHeld {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === "string" &&
    typeof item.reason === "string" &&
    typeof item.expiresAtTurn === "number" &&
    typeof item.digest === "string" &&
    TDA_KINDS.includes(item.kind as TdaKind) &&
    (item.reader === undefined || typeof item.reader === "string")
  )
}
