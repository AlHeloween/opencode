# Universal Multimodal Attachment System

**Created:** 2026-06-01
**Status:** Plan — validated against codebase 2026-06-01
**Replaces:** Hardcoded `isMedia()`, boolean `supportsMediaInToolResults`, inline mime-type dispatch
**Validation:** 3 blockers identified and fixed (see §Validation Corrections below)

---

## Motivation

The current attachment pipeline is fragile against change:
- `isMedia()` hardcodes `image/*` + `application/pdf`
- Provider capability checks are boolean switches per-SDK
- New media types require if-else additions at 5+ call sites
- No audio, video, spatial, or industrial sensor support
- Config schema for image processing exists but is unimplemented
- No embedding/vector infrastructure for multimodal retrieval

**Goal:** A universal attachment system where adding a new media type means registering one handler, not touching 5 files. Provider capabilities are declarative, not hardcoded. Industrial data (HDF5, sensor JSON) is first-class. Multimodal search via embeddings works across all types.

---

## Architecture Overview

```
                        ┌──────────────────────────────┐
                        │     AttachmentRegistry        │
                        │  kind → Handler               │
                        │  classify / describe /        │
                        │  normalize / render /         │
                        │  capability                   │
                        └──────┬───────┬───────┬────────┘
                               │       │       │
              ┌────────────────┼───────┼───────┼──────────────────┐
              │                │       │       │                   │
     ┌────────▼─────┐  ┌──────▼──┐ ┌──▼───┐ ┌─▼──────────┐ ┌─────▼──────┐
     │ image/*      │  │ audio/* │ │video │ │ document   │ │ sensor     │
     │ handler      │  │handler  │ │hdlr  │ │ handler    │ │ handler    │
     └──────┬───────┘  └────┬────┘ └──┬───┘ └──┬─────────┘ └──┬─────────┘
            │               │         │         │              │
            ▼               ▼         ▼         ▼              ▼
     ┌──────────────────────────────────────────────────────────────┐
     │                   UniversalAttachment                        │
     │  kind | mime | url | metadata | display | provenance         │
     └──────────────────────────┬───────────────────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
            ┌──────────┐ ┌──────────┐ ┌──────────┐
            │ Provider │ │  Tool    │ │   TUI    │
            │ Cap.Matrix│ │ Viewers │ │ Renderers│
            └──────────┘ └──────────┘ └──────────┘
                    │
                    ▼
            ┌──────────────────┐
            │ Embeddings Table │
            │ Query by vector  │
            │ similarity       │
            └──────────────────┘
```

---

## Phase 1: Core Infrastructure

### 1.1 Attachment Kind Taxonomy

Replace `isMedia()` boolean with a tagged union of all supported kinds:

```ts
// packages/opencode/src/attachment/kind.ts
const AttachmentKind = Schema.Literals([
  "image",          // image/png, image/jpeg, image/gif, image/webp
  "image_vector",   // image/svg+xml
  "audio",          // audio/wav, audio/mp3, audio/ogg, audio/flac
  "video",          // video/mp4, video/webm, video/avi
  "document",       // application/pdf
  "spreadsheet",    // application/vnd.ms-excel, text/csv
  "presentation",   // application/vnd.ms-powerpoint
  "spatial",        // model/gltf+json, 3D meshes, point clouds
  "sensor",         // application/x-hdf5, application/x-sensor+json
  "archive",        // application/zip, application/gzip, application/x-7z-compressed
  "data",           // application/json, application/x-parquet
  "text",           // text/plain, text/markdown
  "code",           // text/x-python, text/typescript, etc.
  "binary",         // application/octet-stream, unknown
])
```

### 1.2 UniversalAttachment Schema

```ts
// packages/opencode/src/attachment/schema.ts

/** Kind-specific metadata — discriminated by parent's `kind` field.
 *  The `_tag` literal is used for Schema.Union discrimination only;
 *  it matches the parent `UniversalAttachment.kind` value. */
const AttachmentMetadata = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("image"), width: Schema.Number, height: Schema.Number, colorSpace: Schema.optional(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("audio"), duration: Schema.Number, sampleRate: Schema.Number, channels: Schema.Number, codec: Schema.optional(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("video"), duration: Schema.Number, width: Schema.Number, height: Schema.Number, fps: Schema.Number, codec: Schema.optional(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("document"), pages: Schema.optional(Schema.Number), author: Schema.optional(Schema.String), title: Schema.optional(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("sensor"), channels: Schema.Array(Schema.String), sampleRate: Schema.Number, duration: Schema.Number, units: Schema.String, range: Schema.optional(Schema.Struct({ min: Schema.Number, max: Schema.Number })), format: Schema.Literals(["hdf5", "json", "csv"]) }),
  Schema.Struct({ _tag: Schema.Literal("spatial"), format: Schema.String, vertexCount: Schema.optional(Schema.Number), bounds: Schema.optional(Schema.Struct({ min: Schema.Tuple(Schema.Number, Schema.Number, Schema.Number), max: Schema.Tuple(Schema.Number, Schema.Number, Schema.Number) })) }),
  Schema.Struct({ _tag: Schema.Literal("archive"), fileCount: Schema.Number, compressedSize: Schema.Number, uncompressedSize: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("data"), schema_: Schema.optional(Schema.Unknown), rowCount: Schema.optional(Schema.Number), columnCount: Schema.optional(Schema.Number) }),
  Schema.Struct({ _tag: Schema.Literal("text"), lines: Schema.Number, chars: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("code"), language: Schema.String, lines: Schema.Number, chars: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("binary"), size: Schema.Number }),
)

const UniversalAttachment = Schema.Struct({
  id: PartID,
  sessionID: SessionID,
  messageID: MessageID,
  type: Schema.Literal("file"),          // Preserved for Part union compatibility
  kind: AttachmentKind,                   // NEW — detected by registry
  mime: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
  source: Schema.optional(Schema.Unknown), // Preserved from FilePart
  // All new fields are OPTIONAL for backward compatibility with existing DB rows
  metadata: Schema.optional(AttachmentMetadata).withDefault(() => ({})),
  display: Schema.optional(Schema.Struct({
    badge: Schema.String,
    label: Schema.String,
  })),
  provenance: Schema.optional(Schema.Struct({
    source: Schema.Literals(["user_upload", "tool_output", "model_generated"]),
    toolName: Schema.optional(Schema.String),
    transformHistory: Schema.optional(Schema.Array(Schema.String)),
  })),
})
```

### 1.3 AttachmentHandler Interface

```ts
// packages/opencode/src/attachment/handler.ts

type ProviderCapability = "native" | "describe" | "extract" | "unsupported"

interface AttachmentHandler {
  readonly kind: AttachmentKind
  
  /** Does this handler claim this mime type? */
  detect(mime: string, bytes?: Uint8Array): boolean
  
  /** Classify a raw attachment into a UniversalAttachment */
  classify(part: FilePart): Effect<UniversalAttachment, AttachmentError>
  
  /** Generate a text description for models that can't natively handle this kind */
  describe(attachment: UniversalAttachment): string
  
  /** Optional: normalize/compress/resize before storage */
  normalize?(attachment: UniversalAttachment, config: AttachmentConfig): Effect<UniversalAttachment, AttachmentError>
  
  /** Render for TUI display (badge, preview, chart) */
  render(attachment: UniversalAttachment): TuiRenderResult
  
  /** What can a given model do with this attachment? */
  capability(model: Provider.Model, attachment: UniversalAttachment): ProviderCapability

  /** Optional: generate embeddings for this attachment kind */
  embed?(attachment: UniversalAttachment, model: string): Effect<Embedding[], AttachmentError>
}

interface TuiRenderResult {
  badge: { text: string; color: string }
  label: string
  preview?: string       // inline preview (truncated text, ASCII chart, etc.)
  expandable?: boolean   // can be expanded for full view
}
```

### 1.4 AttachmentRegistry

```ts
// packages/opencode/src/attachment/registry.ts

class AttachmentRegistry {
  private handlers: Map<AttachmentKind, AttachmentHandler>
  
  register(handler: AttachmentHandler): void
  classify(raw: FilePart): Effect<UniversalAttachment, AttachmentError>
  describe(attachment: UniversalAttachment): string
  normalize(attachment: UniversalAttachment, config: AttachmentConfig): Effect<UniversalAttachment, AttachmentError>
  render(attachment: UniversalAttachment): TuiRenderResult
  capability(model: Provider.Model, attachment: UniversalAttachment): ProviderCapability
  embed(attachment: UniversalAttachment, model: string): Effect<Embedding[], AttachmentError>
  
  /** Get all registered handlers for extension */
  getHandlers(): ReadonlyMap<AttachmentKind, AttachmentHandler>
}

// Service layer
class AttachmentService extends Context.Service<AttachmentService, AttachmentRegistry>()("@opencode/Attachment")
```

---

## Phase 2: Per-Kind Handlers

### 2.1 Image Handler

**File:** `packages/opencode/src/attachment/handlers/image.ts`

- `detect`: `image/*` except `image/svg+xml`
- `classify`: Extract dimensions from data URL or file header
- `normalize`: Resize via `sharp`/`jimp`/`canvas` based on `ConfigAttachment.image.max_width/max_height`
- `describe`: "Image: 1920×1080 PNG, 450KB"
- `render`: Badge = `img`, color = accent. Preview = dimensions + size
- `capability`: Checks `model.capabilities.input.image` → native, else → describe
- `embed`: Patch-based embeddings for image similarity search

### 2.2 Audio Handler

**File:** `packages/opencode/src/attachment/handlers/audio.ts`

- `detect`: `audio/*`
- `classify`: Extract duration, sample rate, channels from WAV/MP3 headers or ffprobe
- `describe`: "Audio: 2.3s, 44.1kHz stereo WAV"
- `render`: Badge = `wav`, color = secondary.
- `capability`: Checks `model.capabilities.input.audio` → native, else → describe
- `embed`: Windowed embeddings for audio similarity search

### 2.3 Video Handler

**File:** `packages/opencode/src/attachment/handlers/video.ts`

- `detect`: `video/*`
- `classify`: Extract duration, dimensions, fps from container headers
- `normalize`: Optional keyframe extraction
- `describe`: "Video: 15s, 1920×1080, 30fps MP4"
- `capability`: Checks `model.capabilities.input.video` → extract keyframes, else → describe
- `embed`: Keyframe-based embeddings + temporal ordering

### 2.4 Document Handler (PDF, DOCX, etc.)

**File:** `packages/opencode/src/attachment/handlers/document.ts`

- `detect`: `application/pdf`, `application/vnd.openxmlformats-officedocument.*`
- `classify`: Extract pages, author, title
- `normalize`: Optional text extraction for content indexing
- `describe`: "PDF: 12 pages, by Author Name"
- `capability`: Checks for PDF input support or → describe
- `embed`: Chunked text embeddings

### 2.5 Sensor Handler (HDF5 + JSON)

**File:** `packages/opencode/src/attachment/handlers/sensor.ts`

- `detect`: `application/x-hdf5`, `application/x-hdf`, `application/x-sensor+json`
- `classify`: 
  - For HDF5: Parse header with `h5wasm` (in-browser/Node) → extract dataset names, shapes, dtype
  - For JSON: Parse channel metadata directly
- `describe`: Generated summary of channels, sample rate, duration, range
- `render`: ASCII sparkline chart or structured table
- `capability`: Always → describe (no current model accepts raw sensor data natively)
- `embed`: Sliding-window embeddings over time series (each window = one row in embeddings table)

**HDF5 handling details:**
```
h5wasm is a WASM-based HDF5 reader that works in Bun, Node, and browser.
No native binaries needed. For large files (>100MB), we extract metadata
only and store the raw file path for later processing.

Embedding strategy for sensor data:
- Sliding window of W samples (e.g., 256 samples)
- Each window becomes one row in `part_embedding` with:
  - embedding_type = "sensor_window"
  - position_in_document = window_start / total_samples
  - content_length = window_samples
  - embedding = flattened statistical feature vector:
    [mean, std, min, max, skew, kurtosis] × N_channels
  Or: raw window samples flattened to fixed-length input for a sensor embedding model
```

### 2.6 Spatial Handler (3D Models)

**File:** `packages/opencode/src/attachment/handlers/spatial.ts`

- `detect`: `model/gltf+json`, `model/gltf-binary`, `application/octet-stream` (with GLB magic)
- `classify`: Extract vertex count, bounds, materials
- `describe`: "3D Model: GLB, 12,450 vertices, bounding box 2.3×1.5×0.8m"
- `capability`: Always → describe (no model accepts 3D natively; VR/AR viewers could later)

### 2.7 Archive Handler

**File:** `packages/opencode/src/attachment/handlers/archive.ts`

- `detect`: `application/zip`, `application/gzip`, `application/x-7z-compressed`, `application/x-tar`
- `classify`: List files, sizes, compression ratio
- `describe`: "ZIP archive: 14 files, 2.3MB compressed (4.1MB uncompressed)"
- `render`: File listing preview

### 2.8 Data Handler (JSON, CSV, Parquet)

**File:** `packages/opencode/src/attachment/handlers/data.ts`

- `detect`: `application/json`, `text/csv`, `application/x-parquet`
- `classify`: Schema detection, row/column count
- `describe`: "CSV: 1,240 rows × 8 columns (temperature, pressure, humidity, ...)"
- `render`: Table preview
- `embed`: Column-level or row-level embeddings

### 2.9 Text/Code Handlers

**File:** `packages/opencode/src/attachment/handlers/text.ts`, `code.ts`

- `detect`: `text/*` + language-specific mime types
- `classify`: Line/char count, language detection
- `describe`: "Python source: 342 lines, 8.4KB"
- `embed`: Chunked text embeddings (reuse existing chunking if available)

### 2.10 Binary Handler (Fallback)

**File:** `packages/opencode/src/attachment/handlers/binary.ts`

- `detect`: Everything unmatched
- `classify`: File size only, magic byte sniffing for known formats
- `describe`: "Binary file: 1.2MB, application/octet-stream"
- `capability`: Always → unsupported (don't send to model)

---

## Phase 3: Embedding Config & Provider-Per-Type System

### 3.0 Design Philosophy

Every attachment kind can have **multiple embedding models** configured per-type. One image generates embeddings from CLIP (visual), text-embedding-3 (OCR caption), and SigLIP (alternative visual) — each stored as separate rows in `part_embedding`. On query, results from all models are **cross-modally fused** via Reciprocal Rank Fusion, ordered by config priority. 

Adding a new embedding model for any type is a **config change, not a code change**.

### 3.1 Embedding Config Schema

```ts
// packages/opencode/src/config/embedding.ts

/** One embedding model entry */
const EmbeddingModel = Schema.Struct({
  id: Schema.String,                     // unique identifier: "openai/clip-vit-base-patch32"
  endpoint: Schema.String,               // API endpoint for embeddings (empty = local computation)
  dim: NonNegativeInt,                   // embedding dimension
  priority: Schema.optional(Schema.Int.withDefault(() => 1)),  // lower = preferred (used in fusion)
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  batch_size: Schema.optional(PositiveInt.withDefault(() => 32)),
  timeout_ms: Schema.optional(PositiveInt.withDefault(() => 30000)),
  description: Schema.optional(Schema.String),  // human-readable
})

/** Provider group: one attachment type → N embedding models */
const EmbeddingProvider = Schema.Struct({
  type: AttachmentKind,                  // which attachment kind this handles
  models: Schema.Array(EmbeddingModel),  // ordered by priority (first = default)
})

/** Cross-modal fusion settings */
const CrossModal = Schema.Struct({
  enabled: Schema.Boolean.withDefault(() => true),
  fusion: Schema.Literals(["rrf", "weighted_sum"]).withDefault(() => "rrf"),
  rrf_k: Schema.optional(Schema.Int.withDefault(() => 60)),
  default_top_k: Schema.Int.withDefault(() => 20),
  weight_by_priority: Schema.Boolean.withDefault(() => true),
  min_models_for_cross: Schema.optional(Schema.Int.withDefault(() => 1)),  // fuse only if ≥ N models have results
})

export const Info = Schema.Struct({
  providers: Schema.Array(EmbeddingProvider),
  cross_modal: Schema.optional(CrossModal),
  auto_embed: Schema.Boolean.withDefault(() => false),  // auto-embed on attachment ingestion
})
```

### 3.2 Auto-Generated Default Configuration

On first run, the system generates a default embedding config that the user or agent can extend:

```yaml
# Auto-generated in opencode.config.ts / opencode.json
embedding:
  providers:
    - type: text
      models:
        - id: local/bge-m3                  # local model, no endpoint needed
          endpoint: ""
          dim: 1024
          priority: 1
          description: "Local BGE-M3 — text, code, multilingual"
        - id: openai/text-embedding-3-small
          endpoint: https://api.openai.com/v1/embeddings
          dim: 1536
          priority: 2
          description: "OpenAI text embeddings — requires API key"
    - type: image
      models:
        - id: local/siglip-base-patch16
          endpoint: ""
          dim: 768
          priority: 1
          description: "Local SigLIP — visual embeddings"
        - id: openai/clip-vit-base-patch32
          endpoint: https://api.openai.com/v1/embeddings
          dim: 512
          priority: 2
          description: "OpenAI CLIP — visual + text alignment"
    - type: audio
      models:
        - id: local/wavlm-base
          endpoint: ""
          dim: 768
          priority: 1
          description: "Local WavLM — audio embeddings"
    - type: sensor
      models:
        - id: local/statistical-features
          endpoint: ""                       # pure local computation
          dim: 256
          priority: 1
          description: "Statistical features — mean, std, skew, kurtosis per channel"

  cross_modal:
    enabled: true
    fusion: rrf
    rrf_k: 60
    default_top_k: 20
    weight_by_priority: true

  auto_embed: false
```

### 3.3 Embeddings Table (updated)

The `part_embedding` table is added via a **Drizzle migration**. Updated schema with provider tracking:

```sql
-- Generated by: bun run db generate --name part_embedding
-- Migration file: migration/<timestamp>_part_embedding/migration.sql
CREATE TABLE IF NOT EXISTS "part_embedding" (
  id text PRIMARY KEY NOT NULL,
  part_id text NOT NULL REFERENCES part(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  message_id text NOT NULL,
  embedding_type text NOT NULL,       -- "text_chunk" | "image_patch" | "audio_window" | "sensor_window" | "document_chunk" | "video_keyframe"
  embedding text NOT NULL,            -- JSON array of float32
  position_in_document real NOT NULL, -- normalized position (0.0-1.0) or absolute offset
  content_length integer NOT NULL,    -- chars, samples, pixels, bytes covered
  model_id text NOT NULL,             -- matches EmbeddingModel.id from config
  model_dim integer NOT NULL,         -- embedding dimension
  provider_priority integer NOT NULL DEFAULT 1,  -- from EmbeddingModel.priority
  time_created integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "part_embedding_part_idx" ON "part_embedding" ("part_id");
CREATE INDEX IF NOT EXISTS "part_embedding_session_idx" ON "part_embedding" ("session_id");
CREATE INDEX IF NOT EXISTS "part_embedding_type_idx" ON "part_embedding" ("embedding_type");
CREATE INDEX IF NOT EXISTS "part_embedding_model_idx" ON "part_embedding" ("model_id");
```

### 3.4 Multi-Model Embedding Generation

When an attachment is ingested (or lazily on first query), embeddings are generated for **all configured models** for its kind:

```ts
// packages/opencode/src/attachment/embedding.ts

function embedAttachment(
  attachment: UniversalAttachment,
  config: EmbeddingConfig.Info,
): Effect<Embedding[], EmbeddingError> {
  return Effect.gen(function* () {
    const providers = config.providers.filter(p => p.type === attachment.kind)
    const allEmbeddings: Embedding[] = []

    for (const provider of providers) {
      for (const model of provider.models) {
        // Check cache: do embeddings already exist for this part+model?
        const existing = yield* db.select().from(PartEmbeddingTable)
          .where(and(
            eq(PartEmbeddingTable.part_id, attachment.id),
            eq(PartEmbeddingTable.model_id, model.id),
          ))
          .all()
        if (existing.length > 0) {
          allEmbeddings.push(...existing)
          continue  // Already computed — skip
        }

        const handler = registry.getHandler(attachment.kind)
        if (!handler.embed) continue

        // Generate embeddings specific to this model
        const modelEmbeddings = yield* handler.embed(attachment, {
          modelId: model.id,
          dim: model.dim,
          endpoint: model.endpoint || undefined,  // empty = local computation
          headers: model.headers,
          batchSize: model.batch_size ?? 32,
          timeoutMs: model.timeout_ms ?? 30000,
        })

        // Store in DB
        const rows = modelEmbeddings.map(e => ({
          id: Identifier.ascending("emb"),
          part_id: attachment.id,
          session_id: attachment.sessionID,
          message_id: attachment.messageID,
          embedding_type: e.type,
          embedding: e.vector,
          position_in_document: e.position,
          content_length: e.length,
          model_id: model.id,
          model_dim: model.dim,
          provider_priority: model.priority ?? 1,
          time_created: Date.now(),
        }))

        if (rows.length > 0) {
          yield* db.insert(PartEmbeddingTable).values(rows)
        }
        allEmbeddings.push(...rows)
      }
    }
    return allEmbeddings
  })
}
```

**Result:** One image attachment produces multiple `part_embedding` rows:
```
part_id=img123, model_id=local/siglip,     dim=768,  priority=1, embedding=[...]
part_id=img123, model_id=openai/clip-vit,  dim=512,  priority=2, embedding=[...]
part_id=img123, model_id=openai/text-emb3, dim=1536, priority=3, embedding=[...]  (OCR caption)
```

### 3.5 Cross-Modal Fusion Query

The query function fuses results across all configured models using Reciprocal Rank Fusion:

```ts
interface EmbeddingQuery {
  embedding: number[]                     // query vector (any dim — matched to compatible models)
  k?: number                             // top-K results (default: from config)
  embeddingType?: string | string[]      // filter by attachment kind
  modelId?: string | string[]            // restrict to specific models
  crossModal?: boolean                   // enable cross-modal fusion (default: from config)
  minSimilarity?: number                 // per-model cosine threshold
  sessionID?: string
}

interface FusedResult {
  embeddingId: string
  partId: string
  attachmentId: string
  positionInDocument: number
  contentLength: number
  embeddingType: string
  modelId: string
  similarity: number                     // within-model cosine similarity
  rrfScore: number                       // fused score across all models
  contributingModels: string[]           // which models contributed to this result
}

function querySimilar(
  db: Database.Interface,
  query: EmbeddingQuery,
  config: EmbeddingConfig.Info,
): Effect<FusedResult[], EmbeddingError> {
  return Effect.gen(function* () {
    const crossModal = query.crossModal ?? config.cross_modal?.enabled ?? true
    const fusion = config.cross_modal?.fusion ?? "rrf"
    
    // Step 1: Determine which models are compatible with the query embedding
    const compatibleModels = query.modelId
      ? config.providers.flatMap(p => p.models.filter(m => query.modelId!.includes(m.id)))
      : config.providers.flatMap(p => p.models)
    
    // Step 2: For each compatible model, compute similarity independently
    const perModelResults = new Map<string, ScoredEmbedding[]>()
    
    for (const model of compatibleModels) {
      // Skip if query dim doesn't match model dim (only for same-dim models)
      if (query.embedding.length !== model.dim) continue
      
      const candidates = yield* db.select().from(PartEmbeddingTable)
        .where(and(
          eq(PartEmbeddingTable.model_id, model.id),
          query.sessionID ? eq(PartEmbeddingTable.session_id, query.sessionID) : undefined,
          query.embeddingType 
            ? Array.isArray(query.embeddingType)
              ? inArray(PartEmbeddingTable.embedding_type, query.embeddingType)
              : eq(PartEmbeddingTable.embedding_type, query.embeddingType)
            : undefined,
        ))
        .all()
      
      const scored = candidates
        .map(c => ({ ...c, similarity: cosineSimilarity(query.embedding, c.embedding) }))
        .filter(c => query.minSimilarity === undefined || c.similarity >= query.minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
      
      perModelResults.set(model.id, scored)
    }
    
    // Step 3: Cross-modal fusion
    if (crossModal && perModelResults.size > 1) {
      if (fusion === "rrf") {
        return reciprocalRankFusion(perModelResults, config, query.k)
      }
      // weighted_sum: normalize scores by priority, then sum
      return weightedSumFusion(perModelResults, config, query.k)
    }
    
    // Single-model: return top-K from best model
    const bestModel = [...perModelResults.entries()]
      .sort((a, b) => {
        const priA = compatibleModels.find(m => m.id === a[0])?.priority ?? 99
        const priB = compatibleModels.find(m => m.id === b[0])?.priority ?? 99
        return priA - priB
      })[0]
    
    return (bestModel?.[1] ?? []).slice(0, query.k ?? config.cross_modal?.default_top_k ?? 20)
  })
}

function reciprocalRankFusion(
  perModelResults: Map<string, ScoredEmbedding[]>,
  config: EmbeddingConfig.Info,
  k?: number,
): FusedResult[] {
  const rrfK = config.cross_modal?.rrf_k ?? 60
  const weightByPriority = config.cross_modal?.weight_by_priority ?? true
  
  // Build RRF scores: for each document, sum 1/(rrfK + rank) across all models
  const fused = new Map<string, { partId: string; rrfScore: number; contributors: Set<string>; best: ScoredEmbedding }>()
  
  for (const [modelId, results] of perModelResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank]
      const key = `${r.part_id}:${r.embedding_type}:${r.position_in_document}`
      const weight = weightByPriority ? (1.0 / (r.provider_priority ?? 1)) : 1.0
      const rrfScore = weight / (rrfK + rank + 1)
      
      const existing = fused.get(key)
      if (existing) {
        existing.rrfScore += rrfScore
        existing.contributors.add(modelId)
        if (r.similarity > existing.best.similarity) existing.best = r
      } else {
        fused.set(key, {
          partId: r.part_id,
          rrfScore,
          contributors: new Set([modelId]),
          best: r,
        })
      }
    }
  }
  
  return [...fused.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, k ?? config.cross_modal?.default_top_k ?? 20)
    .map(f => ({
      embeddingId: f.best.id,
      partId: f.best.part_id,
      attachmentId: f.best.part_id,  // derived from part
      positionInDocument: f.best.position_in_document,
      contentLength: f.best.content_length,
      embeddingType: f.best.embedding_type,
      modelId: f.best.model_id,
      similarity: f.best.similarity,
      rrfScore: f.rrfScore,
      contributingModels: [...f.contributors],
    }))
}
```
### 3.6 Query Example: Cross-Modal Sensor Search

```ts
// User asks: "Show me sensor readings similar to this anomaly description"
const textEmbedding = yield* embedText("magnetic field spike at 1.2s", "local/bge-m3")
const results = yield* querySimilar(db, {
  embedding: textEmbedding, k: 10, crossModal: true, sessionID: currentSession
}, embeddingConfig)
// Results:
// 1. sensor_window at pos 0.3 — RRF score 0.82 (from local/statistical-features)
// 2. text_chunk describing anomaly — RRF score 0.75 (from local/bge-m3)
// 3. image_patch of chart — RRF score 0.61 (from local/siglip via cross-modal)
//   contributingModels: ["local/bge-m3", "local/siglip", "local/statistical-features"]
```

### 3.7 Universal Nature

The key property: **zero code changes to add new embedding capabilities**.

| Action | What changes |
|--------|-------------|
| Add visual embedding for .glb 3D models | Add `type: spatial` + model entry to config |
| Agent discovers a new sensor format | Add `type: sensor` + model entry to config |
| User wants cross-modal image↔audio search | Already works — RRF fuses separate model results |
| Switch from OpenAI to local embeddings | Change `endpoint` in config, keep model `id` |

**Priority ordering:** For same-type results, models with lower `priority` rank higher in RRF. For cross-type results, the fusion algorithm naturally normalizes across different score distributions.

### 3.8 Embedding Endpoint Integration

For API-based models: `POST { input, model }` → `{ data: [{ embedding }] }`.  
For local models (`endpoint: ""`): handler computes directly (e.g., sensor statistical features).

---

## Phase 4: Provider Capability Matrix

### 4.1 Declaration

Replace hardcoded `if (model.api.npm === "@ai-sdk/anthropic") return true` with a declarative matrix:

```ts
// packages/opencode/src/attachment/capability.ts

/** Maps model → attachmentKind → capability */
const ProviderCapabilityMatrix: Record<string, Record<AttachmentKind, ProviderCapability>> = {
  // Anthropic: native image+pdf, describe everything else
  "@ai-sdk/anthropic": {
    image: "native", document: "native",
    audio: "describe", video: "describe", sensor: "describe",
    spatial: "describe", archive: "unsupported", data: "describe",
    text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // OpenAI: native image, describe audio (whisper context), native text
  "@ai-sdk/openai": {
    image: "native", document: "native",
    audio: "describe", video: "describe", sensor: "describe",
    spatial: "describe", archive: "unsupported", data: "describe",
    text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // Google Gemini: native image+audio+video+pdf, native text
  "@ai-sdk/google": {
    image: "native", audio: "native", video: "native", document: "native",
    sensor: "describe", spatial: "describe", archive: "unsupported",
    data: "describe", text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // xAI: native images only
  "@ai-sdk/xai": {
    image: "native",
    audio: "describe", video: "describe", document: "describe",
    sensor: "describe", spatial: "describe", archive: "unsupported",
    data: "describe", text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
  // Fallback: "unknown" provider
  unknown: {
    image: "describe", audio: "describe", video: "describe", document: "describe",
    sensor: "describe", spatial: "describe", archive: "unsupported",
    data: "describe", text: "native", code: "native", binary: "unsupported",
    image_vector: "describe", spreadsheet: "describe", presentation: "describe",
  },
}

function getCapability(model: Provider.Model, kind: AttachmentKind): ProviderCapability {
  const matrix = ProviderCapabilityMatrix[model.api.npm] ?? ProviderCapabilityMatrix.unknown
  return matrix[kind] ?? "describe"  // safe default: describe rather than unsupported
}
```

### 4.2 Integration into toModelMessagesEffect

Replace the boolean `supportsMediaInToolResults` with:

```ts
// OLD:
const supportsMediaInToolResults = (() => { ... })()
if (!supportsMediaInToolResults && mediaAttachments.length > 0) { ... }

// NEW:
for (const attachment of mediaAttachments) {
  const cap = registry.capability(model, attachment)
  switch (cap) {
    case "native":
      finalAttachments.push(attachment)  // pass through
      break
    case "describe":
      finalAttachments.push(describeAsText(attachment))  // text fallback
      break
    case "extract":
      finalAttachments.push(...extractStructuredData(attachment))  // structured fallback
      break
    case "unsupported":
      // omit silently (or warn)
      break
  }
}
```

---

## Phase 5: HDF5 & Industrial Data

### 5.1 HDF5 Reader

Use [h5wasm](https://github.com/usnistgov/h5wasm) — a WASM-based HDF5 reader that works in Bun, Node.js, and browser:

```json
// packages/opencode/package.json
{
  "dependencies": {
    "h5wasm": "^0.7.0"
  }
}
```

### 5.2 Metadata Extraction

```ts
// packages/opencode/src/attachment/handlers/sensor-hdf5.ts

import { File as H5File } from "h5wasm"

interface HDF5SensorMetadata {
  kind: "sensor"
  channels: string[]           // dataset names: ["magnetic_field_x", "magnetic_field_y", "magnetic_field_z"]
  shapes: number[][]           // dataset shapes: [[1000], [1000], [1000]]
  dtypes: string[]             // dataset dtypes: ["float32", "float32", "float32"]
  sampleRate: number           // from attributes or inference
  duration: number             // total samples / sampleRate
  units: string                // from attributes: "nT", "μT", "m/s²", "°C"
  range: { min: number, max: number }
  format: "hdf5"
}

function extractHDF5Metadata(bytes: Uint8Array): HDF5SensorMetadata {
  const file = new H5File(bytes, "r")
  const datasets = file.keys()
  const channels: string[] = []
  const shapes: number[][] = []
  const dtypes: string[] = []
  
  for (const name of datasets) {
    const ds = file.get(name)
    if (ds?.shape) {
      channels.push(name)
      shapes.push(Array.from(ds.shape))
      dtypes.push(ds.dtype)
    }
  }
  
  // Extract attributes for sample rate, units if available
  const attrs = file.attrs
  const sampleRate = attrs?.sample_rate ?? inferSampleRate(shapes)
  const units = attrs?.units ?? "unknown"
  
  file.close()
  return { kind: "sensor", channels, shapes, dtypes, sampleRate, duration: shapes[0]?.[0] / sampleRate, units, range: computeRange(bytes, shapes[0]), format: "hdf5" }
}
```

### 5.3 Sensor Embedding Strategy

For sensor data, embeddings are computed as sliding-window statistical features:

```ts
function embedSensorData(
  attachment: UniversalAttachment,
  modelId: string
): Embedding[] {
  const metadata = attachment.metadata as SensorMetadata
  const windowSize = 256   // samples per window
  const stride = 128        // 50% overlap
  const totalSamples = metadata.shapes[0]?.[0] ?? 0
  const embeddings: Embedding[] = []
  
  for (let start = 0; start < totalSamples - windowSize; start += stride) {
    const window = extractWindow(attachment, start, windowSize)  // N_channels × windowSize
    const features = computeStatisticalFeatures(window)           // [mean, std, min, max, skew, kurtosis] × N_channels
    embeddings.push({
      type: "sensor_window",
      vector: features,        // or: pass through a pre-trained sensor embedding model
      position: start / totalSamples,
      length: windowSize,
    })
  }
  return embeddings
}
```

---

## Phase 6: TUI Renderers & Tool Viewers

### 6.1 Per-Kind Render Results

```ts
// Each handler.render() returns:
type TuiRenderResult = {
  badge: { text: string; color: Color }
  label: string
  inline?: string       // short inline preview
  expanded?: string     // full view on expand
}

// Examples:
// image     → badge="img"(accent), label="screenshot.png", inline="1920×1080 PNG 450KB"
// sensor    → badge="h5"(primary), label="magnetometer.h5", inline="3 ch, 100Hz, 4.2s", expanded=asciiChart
// audio     → badge="wav"(secondary), label="recording.wav", inline="2.3s 44.1kHz stereo"
// archive   → badge="zip"(secondary), label="data.zip", inline="14 files, 2.3MB", expanded=fileList
```

### 6.2 Sensor ASCII Chart Renderer

```ts
function renderSensorChart(attachment: UniversalAttachment): string {
  const meta = attachment.metadata as SensorMetadata
  const width = 40  // character width
  const max = meta.range.max
  const min = meta.range.min
  
  let output = `┌─ ${meta.channels.length} channels @ ${meta.sampleRate}Hz ─┐\n`
  for (const [i, ch] of meta.channels.entries()) {
    const normalized = clamp((ch.mean - min) / (max - min), 0, 1)
    const bar = "█".repeat(Math.round(normalized * width))
    const spacer = "░".repeat(width - bar.length)
    output += `│ ${ch.padEnd(20)} [${bar}${spacer}] ${ch.mean.toFixed(1)}${meta.units} │\n`
  }
  output += `└──────────────────────────────────────────────┘`
  return output
}
```

---

## Migration Strategy

### From Current System

| Old | New | Migration |
|-----|-----|-----------|
| `isMedia(mime)` | `registry.classify(part).kind` | Replace all call sites |
| `isImageAttachment(mime)` | `attachment.kind === "image"` | Replace all call sites |
| `isPdfAttachment(mime)` | `attachment.kind === "document"` | Replace all call sites |
| `supportsMediaInToolResults` (boolean) | `registry.capability(model, attachment)` | Replace with declarative matrix |
| `mimeToModality(mime)` | `attachment.kind` → `Modality` mapping | Replace function |
| `MIME_BADGE` map | `handler.render(attachment).badge` | Replace static map |
| `SYNTHETIC_ATTACHMENT_PROMPT` | `handler.describe(attachment)` | Replace string constant |
| `FilePart` schema | `UniversalAttachment` extends `FilePart` | Add `kind` + `metadata` fields |
| Inline mime checks in `message-v2.ts` | Delegate to `registry` | Replace 5+ dispatch points |

### Backward Compatibility

Existing `FilePart` instances in the database have no `kind` field. On deserialization:
- If `kind` is missing, run through `registry.classify()` to backfill
- This is a one-time lazy migration — first read classifies, subsequent reads use stored `kind`

---

## Implementation Order

| Phase | Scope | Files | Effort |
|-------|-------|-------|--------|
| **1. Foundation** | `AttachmentKind`, `UniversalAttachment` schema, `AttachmentHandler` interface, `AttachmentRegistry` (stub with image handler), replace `isMedia()` call sites | `attachment/kind.ts`, `attachment/schema.ts`, `attachment/handler.ts`, `attachment/registry.ts`, `attachment/service.ts`, modify `util/media.ts` (deprecate), modify `message-v2.ts` (5 sites), update FTS trigger | 3-4h |
| **2. Image/Doc handlers** | Port existing image+pdf handling to handlers with `normalize()`, wire config enforcement, update TUI | `attachment/handlers/image.ts`, `attachment/handlers/document.ts`, modify `routes/session/index.tsx` | 2-3h |
| **3. Embedding config + table + query** | `EmbeddingConfig` schema, auto-generated defaults, `part_embedding` migration, multi-model `embedAttachment()`, cross-modal `querySimilar()` with RRF, config-driven provider-per-type | `config/embedding.ts`, `attachment/embedding.ts`, `migration/<ts>_part_embedding/`, modify `db.ts` (Drizzle table), modify `session.sql.ts` | 4-5h |
| **4. Provider capability matrix** | `ProviderCapabilityMatrix`, replace boolean switch in `toModelMessagesEffect`, wire `describe()` fallback | `attachment/capability.ts`, modify `message-v2.ts` | 2h |
| **5. Audio/Video handlers** | New handlers with metadata extraction, TUI badges, optional `embed()` for audio windows / video keyframes | `attachment/handlers/audio.ts`, `attachment/handlers/video.ts` | 2h |
| **6. Sensor/Spatial/Industrial** | HDF5 handler (h5wasm), sensor embedding (statistical features), ASCII chart renderer, spatial handler | `attachment/handlers/sensor.ts`, `attachment/handlers/sensor-hdf5.ts`, `attachment/handlers/spatial.ts` | 3-4h |
| **7. Remaining handlers** | Archive, data, text, code, binary handlers + per-kind `embed()` where applicable | `attachment/handlers/archive.ts`, `attachment/handlers/data.ts`, `attachment/handlers/text.ts`, `attachment/handlers/code.ts`, `attachment/handlers/binary.ts` | 2h |
| **8. Cleanup** | Remove deprecated `isMedia()`, `isImageAttachment()`, `mimeToModality()`, old `MIME_BADGE`, old boolean switch, old query function | Multiple files | 1h |

**Total estimated effort:** 19-24 hours across 8 phases

---

## Verification

### Per Phase
- Phase 1: Existing tests pass (`message-v2` tests, `processor` tests); `registry.classify()` classifies existing mime types correctly
- Phase 2: Image resizing works, config limits enforced, image+pdf attachments render in TUI
- Phase 3: All provider combos return correct capability; describe fallback generates correct text
- Phase 4: Audio/video metadata extracted correctly from test fixtures
- Phase 5: Embedding insert/query returns correct cosine similarity results; `getOrComputeEmbeddings` caches correctly
- Phase 6: HDF5 test file parsed correctly; sensor chart renders; spatial metadata extracted

### End-to-End
1. Attach an image → resized per config → stored → rendered in TUI → sent to model
2. Attach HDF5 sensor data → metadata extracted → describe() text sent to model → chart rendered in TUI
3. Query embeddings for a text chunk → returns similar text + image patches from same session
4. Switch provider mid-session → attachment handling adapts via capability matrix
5. Add new handler via `registry.register()` → works without touching core code

---

## Dependencies

| Package | Purpose | Phase |
|---------|---------|-------|
| `sharp` or `jimp` | Image resizing | Phase 2 |
| `h5wasm` | HDF5 file reading (WASM, works in Bun/Node) | Phase 6 |
| `music-metadata` | Audio metadata extraction | Phase 5 |
| `effect` | Already available | All |
| `immer` | Already available | All |
| `drizzle-orm` | Embeddings table definition | Phase 3 |

---

## Validation Corrections

The initial plan was audited against the actual codebase on 2026-06-01. The following issues were identified and corrected:

### Blocker A: `model.modalities.input.includes()` → `model.capabilities.input.*` ✅ Fixed
**Finding:** The runtime `Provider.Model` type uses `model.capabilities.input.image` (boolean), NOT `model.modalities.input` (array). The `modalities` field exists only on the **models.dev** catalog schema and is transformed away during provider resolution.
**Fix:** All `capability()` method signatures and examples now reference `model.capabilities.input.image/audio/video/pdf` (booleans).

### Blocker B: `part_embedding` deployment mechanism ✅ Fixed
**Finding:** Adding a table to `CORE_SCHEMA_SQL` would not create it for existing installations. The idempotent `CREATE TABLE IF NOT EXISTS` pattern works for new installs only.
**Fix:** The table is now created via a proper Drizzle migration (`bun run db generate --name part_embedding`).

### Blocker C: `AttachmentMetadata` duplicate `kind` field ✅ Fixed
**Finding:** The metadata union variants had their own `kind` field, conflicting with the parent `UniversalAttachment.kind`.
**Fix:** Renamed to `_tag` for Schema.Union discrimination only. Metadata variants are discriminated by `_tag` which must match the parent's `kind` value.

### Discrepancy D: `UniversalAttachment` backward compatibility ✅ Fixed
**Finding:** Existing `part` rows in the DB have no `kind`, `metadata`, `display`, or `provenance` fields. New required fields would break deserialization.
**Fix:** All new fields (`metadata`, `display`, `provenance`) are now `Schema.optional` with defaults. `type: "file"` is preserved for Part union compatibility. Lazy backfill via `registry.classify()` on first read.

### Discrepancy E: FTS trigger coverage
**Finding:** The `part_fts` trigger does not extract `$.kind` or `$.metadata` fields from `part.data`.
**Fix (in Phase 1):** Update the FTS trigger in `db.ts` to include `json_extract(new.data, '$.kind')` and `json_extract(new.data, '$.display.label')` for searchability.

### Discrepancy F: `ExecuteResult.attachments` type change
**Finding:** Tools return `Omit<FilePart, "id" | "sessionID" | "messageID">`. UniversalAttachment adds fields.
**Resolution:** Two options:
  (A) Change `ExecuteResult.attachments` to accept `Omit<UniversalAttachment, "id" | "sessionID" | "messageID">` — a breaking change for all tools.
  (B) Keep tools returning minimal `FilePart` shapes; the registry's `classify()` method enriches them into `UniversalAttachment` at the processor boundary. **Option B chosen** — tools remain unchanged, classification happens at storage time.

### Summary of Remaining Surface Area

| Component | Files touched | Risk |
|-----------|--------------|------|
| `Part` union discriminator | `message-v2.ts:409-422` | Medium — add `UniversalAttachment` as variant or replace `FilePart` |
| `ToolStateCompleted.attachments` | `message-v2.ts:324` | Low — type change from `FilePart[]` to file parts carrying optional new fields |
| `part()` hydration function | `message-v2.ts:667-684` | Low — add lazy `kind` backfill |
| `MIME_BADGE` + inline color logic | `routes/session/index.tsx:1251,1346` | Low — replace with `handler.render()` |
| `supportsMediaInToolResults` | `message-v2.ts:742,877,880` | Medium — replace with `ProviderCapabilityMatrix` |
| `isMedia()` / `isImageAttachment()` | `util/media.ts` + 6 call sites | Low — replace with `registry.classify()` |
| FTS trigger | `db.ts:247-262` | Low — add `$.kind` extraction |
| `part_embedding` migration | `migration/<ts>_part_embedding/` | Low — standard Drizzle migration |

