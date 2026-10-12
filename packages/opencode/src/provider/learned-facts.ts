/**
 * Per-model facts the PROVIDER itself taught us — recorded at the rejection, read as a
 * plain lookup.
 *
 * WHY this exists: acceptance is not advertised. An OpenAI-compatible endpoint publishes
 * no request schema (`GET /models` is a model list) and the Zen Go docs declare no
 * per-model parameters (measured 2026-10-12, https://opencode.ai/docs/go) — there is no
 * `alt-svc` for body fields. So the authority is the provider's own answer: a
 * `400 [unknown_parameter] … json: unknown field "repetition_penalty"` names exactly what
 * not to send, and an overflow message names the model's true context limit (the
 * space-bunny class: published 1M, actual 450k). Those answers are recorded HERE, once,
 * and applied at the single packaging point (`ProviderTransform.providerOptions` →
 * `stripUnsupportedWireParams`) and by `TokenCalibration` — never as a per-incident code
 * edit.
 *
 * Planes: keyed state whose read sits on the request path is the FAST plane's shape, but
 * LMDB is not deployed yet (same situation as `session_epistemic`), so the blob lives in
 * the relational plane until it lands.
 *
 * The store is an ENHANCEMENT, never a precondition (mirrors `epistemic-store`): with no
 * instance context (unit tests, tooling) reads answer empty and writes report failure —
 * callers fall back to their compiled seed.
 *
 * Write semantics: `record*` returns true ONLY when a new value was actually persisted.
 * That single bit is what bounds the auto-heal: a rejection earns a retry only when the
 * fact was recorded NOW, so a repeat rejection of an already-known field cannot loop.
 */
import { eq } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@/storage/db"
import { ProviderFactTable } from "./facts.sql"

const log = Log.create({ service: "provider.learned-facts" })

export interface LearnedFacts {
  unsupportedParams: string[]
  contextLimit?: number
}

const emptyFacts = (): LearnedFacts => ({ unsupportedParams: [] })

/** `${providerID}/${modelID}` with the variant suffix stripped ("model:variant" → "model"). */
export function factsKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID.split(":")[0]}`
}

function storeFailure(op: string, key: string, cause: unknown) {
  const error = String(cause)
  const detail = { op, key, error }
  if (error.includes("No context found for database")) {
    log.debug("learned-facts store unavailable — falling back to compiled seed", detail)
    return
  }
  log.warn("bug: learned-facts store failed", detail)
}

function parse(key: string, data: string): LearnedFacts {
  try {
    const raw = JSON.parse(data) as Partial<LearnedFacts>
    return {
      unsupportedParams: Array.isArray(raw.unsupportedParams)
        ? raw.unsupportedParams.filter((field): field is string => typeof field === "string")
        : [],
      ...(typeof raw.contextLimit === "number" ? { contextLimit: raw.contextLimit } : {}),
    }
  } catch (cause) {
    // A corrupt blob must not take the request path down; the compiled seed still guards
    // the wire, and the next successful record rewrites the row.
    log.warn("bug: learned-facts blob unreadable", { key, error: String(cause) })
    return emptyFacts()
  }
}

export function loadFacts(providerID: string, modelID: string): LearnedFacts {
  const key = factsKey(providerID, modelID)
  try {
    const data = Database.use(
      (db) =>
        db.select({ data: ProviderFactTable.data }).from(ProviderFactTable).where(eq(ProviderFactTable.id, key)).all()[0]
          ?.data,
    )
    return data ? parse(key, data) : emptyFacts()
  } catch (cause) {
    storeFailure("load", key, cause)
    return emptyFacts()
  }
}

function updateFacts(
  providerID: string,
  modelID: string,
  change: (facts: LearnedFacts) => LearnedFacts | undefined,
): boolean {
  const key = factsKey(providerID, modelID)
  try {
    return Database.use((db) => {
      const data = db.select({ data: ProviderFactTable.data }).from(ProviderFactTable).where(eq(ProviderFactTable.id, key)).all()[0]
        ?.data
      const next = change(data ? parse(key, data) : emptyFacts())
      if (!next) return false
      const now = Date.now()
      const encoded = JSON.stringify(next)
      db.insert(ProviderFactTable)
        .values({ id: key, provider_id: providerID, model_id: modelID.split(":")[0], data: encoded, time_created: now, time_updated: now })
        .onConflictDoUpdate({ target: ProviderFactTable.id, set: { data: encoded, time_updated: now } })
        .run()
      log.info("learned provider fact recorded", { key, facts: next })
      return true
    })
  } catch (cause) {
    storeFailure("save", key, cause)
    return false
  }
}

/** Record that the model's upstream rejects `field` in the request body. True = newly persisted. */
export function recordUnsupportedParam(providerID: string, modelID: string, field: string): boolean {
  return updateFacts(providerID, modelID, (facts) =>
    facts.unsupportedParams.includes(field) ? undefined : { ...facts, unsupportedParams: [...facts.unsupportedParams, field] },
  )
}

/** Record the context limit the provider itself stated. True = newly persisted. */
export function recordContextLimit(providerID: string, modelID: string, limit: number): boolean {
  return updateFacts(providerID, modelID, (facts) => (facts.contextLimit === limit ? undefined : { ...facts, contextLimit: limit }))
}

export * as LearnedFacts from "./learned-facts"
