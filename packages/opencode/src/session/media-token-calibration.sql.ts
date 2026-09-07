import { sqliteTable, text, real, integer, primaryKey } from "drizzle-orm/sqlite-core"

/**
 * Per-model media token calibration (2026-09-07, Alexander).
 *
 * Media (video/images) does NOT count as text in the chars/4 estimate — the
 * provider bills it by duration/dimensions, not payload bytes. The REAL cost
 * is measured from the provider's usage response (prompt_tokens_details
 * image_tokens / video_tokens / audio_tokens) and stored per model here, so
 * subsequent estimates use the measured per-item price instead of a heuristic.
 *
 * EMA over observations; one row per (provider, model, modality).
 */
export const MediaTokenCalibrationTable = sqliteTable(
  "media_token_calibration",
  {
    provider_id: text().notNull(),
    model_id: text().notNull(),
    /** "video" | "image" — matches attachment kind vocabulary. */
    modality: text().notNull(),
    /** Exponential moving average of provider-reported tokens per media item. */
    tokens_per_item: real().notNull(),
    /** Number of measurements folded into the current EMA. */
    observations: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.provider_id, table.model_id, table.modality] })],
)
