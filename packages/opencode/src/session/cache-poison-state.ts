/** Shared cache-poison state tracking, imported by both llm.ts and processor.ts to avoid circular deps. */

export type CachePoisonState = {
  healthy: boolean
  collapsed: number
  poisoned: boolean
  consecutiveCold: number
  previousRatio?: number
  previousMessageID?: string
  previousInputTokens?: number
}

export const cachePoisonStates = new Map<string, CachePoisonState>()

export function resetCachePoisonState(key: string) {
  cachePoisonStates.delete(key)
}
