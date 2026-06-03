export * as AttachmentEmbedding from "./embedding"

import { Effect } from "effect"
import type { Info as UniversalAttachment } from "./schema"
import type { Embedding, EmbedOptions } from "./handler"
import type { Info as EmbeddingConfig } from "@/config/embedding"
import { registry } from "./registry"
import { type DbClient } from "@/storage/migration"

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i] }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

interface AttachmentWithIds extends UniversalAttachment {
  id?: string; sessionID?: string; messageID?: string
}

interface ScoredEmbedding extends Embedding {
  id: string; partId: string; model_id: string; model_dim: number
  provider_priority: number; similarity: number
}

export interface FusedResult {
  embeddingId: string; partId: string; attachmentId: string
  positionInDocument: number; contentLength: number; embeddingType: string
  modelId: string; similarity: number; rrfScore: number; contributingModels: string[]
}

export interface EmbeddingQuery {
  embedding: number[]; k?: number; embeddingType?: string | string[]
  modelId?: string | string[]; crossModal?: boolean; minSimilarity?: number; sessionID?: string
}

/** Generate embeddings for an attachment using all configured models for its kind. */
export function embedAttachment(
  db: DbClient, attachment: AttachmentWithIds, config: EmbeddingConfig,
): Effect.Effect<Embedding[], Error> {
  return Effect.gen(function* () {
    const providers = config.providers.filter((p) => p.type === attachment.kind)
    const allEmbeddings: Embedding[] = []
    if (providers.length === 0) return []

    for (const provider of providers) {
      for (const model of provider.models) {
        const existing = db.$client.prepare(
          `SELECT embedding, embedding_type, position_in_document, content_length FROM part_embedding WHERE part_id = ? AND model_id = ?`
        ).all(attachment.id, model.id) as Array<{ embedding: string; embedding_type: string; position_in_document: number; content_length: number }>

        if (existing.length > 0) {
          allEmbeddings.push(...existing.map((row) => ({
            type: row.embedding_type, vector: JSON.parse(row.embedding) as number[],
            position: row.position_in_document, length: row.content_length,
          })))
          continue
        }

        const handler = registry.getHandler(attachment.kind)
        if (!handler?.embed) continue

        const modelEmbeddings = yield* handler.embed(attachment, {
          modelId: model.id, dim: model.dim, endpoint: model.endpoint || undefined,
          headers: model.headers as Record<string, string> | undefined,
          batchSize: model.batch_size ?? 32, timeoutMs: model.timeout_ms ?? 30000,
        })

        for (const emb of modelEmbeddings) {
          const embId = `emb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
          db.$client.prepare(
            `INSERT INTO part_embedding (id, part_id, session_id, message_id, embedding_type, embedding, position_in_document, content_length, model_id, model_dim, provider_priority, time_created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(embId, attachment.id ?? "", attachment.sessionID ?? "", attachment.messageID ?? "",
            emb.type, JSON.stringify(emb.vector), emb.position, emb.length, model.id, model.dim, model.priority ?? 1, Date.now())
        }
        allEmbeddings.push(...modelEmbeddings)
      }
    }
    return allEmbeddings
  })
}

/** Cross-modal similarity query with RRF fusion. */
export function querySimilar(db: DbClient, query: EmbeddingQuery, config: EmbeddingConfig): FusedResult[] {
  const crossModal = query.crossModal ?? config.cross_modal?.enabled ?? true
  const rrfK = config.cross_modal?.rrf_k ?? 60
  const topK = query.k ?? config.cross_modal?.default_top_k ?? 20
  const weightByPriority = config.cross_modal?.weight_by_priority ?? true

  const compatibleModels = query.modelId
    ? config.providers.flatMap((p) => p.models.filter((m) => (query.modelId as string[])!.includes(m.id)))
    : config.providers.flatMap((p) => p.models)

  const perModelResults = new Map<string, ScoredEmbedding[]>()

  for (const model of compatibleModels) {
    if (query.embedding.length !== model.dim) continue
    let sql = `SELECT * FROM part_embedding WHERE model_id = ?`
    const params: unknown[] = [model.id]
    if (query.sessionID) { sql += ` AND session_id = ?`; params.push(query.sessionID) }
    if (query.embeddingType) {
      const types = Array.isArray(query.embeddingType) ? query.embeddingType : [query.embeddingType]
      sql += ` AND embedding_type IN (${types.map(() => "?").join(", ")})`
      params.push(...types)
    }

    const candidates = db.$client.prepare(sql).all(...params) as Array<{
      id: string; part_id: string; embedding: string; embedding_type: string
      position_in_document: number; content_length: number; model_id: string
      model_dim: number; provider_priority: number
    }>

    const scored = candidates.map((c) => ({
      ...c, type: c.embedding_type, vector: JSON.parse(c.embedding) as number[],
      position: c.position_in_document, length: c.content_length, partId: c.part_id,
      similarity: cosineSimilarity(query.embedding, JSON.parse(c.embedding) as number[]),
    })).filter((c) => query.minSimilarity === undefined || c.similarity >= query.minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)

    perModelResults.set(model.id, scored)
  }

  if (!crossModal || perModelResults.size <= 1) {
    const bestModel = [...perModelResults.entries()].sort((a, b) => {
      const priA = compatibleModels.find((m) => m.id === a[0])?.priority ?? 99
      const priB = compatibleModels.find((m) => m.id === b[0])?.priority ?? 99
      return priA - priB
    })[0]
    return (bestModel?.[1] ?? []).slice(0, topK).map((s) => ({
      embeddingId: s.id, partId: s.partId, attachmentId: s.partId,
      positionInDocument: s.position, contentLength: s.length, embeddingType: s.type,
      modelId: s.model_id, similarity: s.similarity, rrfScore: s.similarity, contributingModels: [s.model_id],
    }))
  }

  // RRF fusion
  const fused = new Map<string, { partId: string; rrfScore: number; contributors: Set<string>; best: ScoredEmbedding }>()
  for (const [modelId, results] of perModelResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank]
      const key = `${r.partId}:${r.type}:${r.position}`
      const weight = weightByPriority ? 1.0 / (r.provider_priority ?? 1) : 1.0
      const score = weight / (rrfK + rank + 1)
      const existing = fused.get(key)
      if (existing) {
        existing.rrfScore += score; existing.contributors.add(modelId)
        if (r.similarity > existing.best.similarity) existing.best = r
      } else {
        fused.set(key, { partId: r.partId, rrfScore: score, contributors: new Set([modelId]), best: r })
      }
    }
  }

  return [...fused.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, topK).map((f) => ({
    embeddingId: f.best.id, partId: f.best.partId, attachmentId: f.best.partId,
    positionInDocument: f.best.position, contentLength: f.best.length, embeddingType: f.best.type,
    modelId: f.best.model_id, similarity: f.best.similarity, rrfScore: f.rrfScore, contributingModels: [...f.contributors],
  }))
}
