/**
 * Unsaved GLOBAL edits made in `/agents`.
 *
 * The global layer applies to every project, so a pick there is STAGED, not written: the row shows
 * the staged value as unsaved, and the form's own «Save settings» item writes everything in one
 * pass. This replaced a per-pick save question (owner, 2026-10-02: «при выборе модели спрашивает
 * сохранять или нет, сделай обычный пункт в меню сохранить настройки и все»).
 *
 * The stage is in-memory and lives for the TUI process: closing `/agents` does not discard it, so
 * reopening the form still shows what is waiting for Save.
 */
import { createStore, reconcile } from "solid-js/store"

/** One agent's unsaved edit. `variant: undefined` means the model default — the key is removed on save. */
export interface StagedAgentEdit {
  readonly model?: { providerID: string; modelID: string }
  readonly variant?: string
}

export type GlobalStage = Readonly<Record<string, StagedAgentEdit>>

/** Every staging is a variant choice; a variant-only pick keeps the model staged before it. */
export function stageEdit(stage: GlobalStage, agent: string, edit: StagedAgentEdit): GlobalStage {
  return { ...stage, [agent]: { model: edit.model ?? stage[agent]?.model, variant: edit.variant } }
}

/** A model pick keeps the agent's variant only when the new model declares it; otherwise the default. */
export function carriedVariant(variant: string | undefined, list: readonly string[]): string | undefined {
  return variant && list.includes(variant) ? variant : undefined
}

/**
 * Write the stage one agent at a time. Each write is a get → update of the WHOLE global config, so
 * two in flight would lose one of them — the loop awaits each write before starting the next.
 * A failure is reported and does not stop the rest; only saved agents leave the stage.
 */
export async function commitStage(
  stage: GlobalStage,
  write: (agent: string, edit: StagedAgentEdit) => Promise<unknown>,
): Promise<{ saved: string[]; failed: { agent: string; error: string }[] }> {
  const saved: string[] = []
  const failed: { agent: string; error: string }[] = []
  for (const [agent, edit] of Object.entries(stage)) {
    await write(agent, edit).then(
      () => saved.push(agent),
      (error: unknown) => failed.push({ agent, error: error instanceof Error ? error.message : String(error) }),
    )
  }
  return { saved, failed }
}

const [store, setStore] = createStore<{ edits: Record<string, StagedAgentEdit> }>({ edits: {} })

export const globalStage = {
  edits: (): GlobalStage => store.edits,
  get: (agent: string): StagedAgentEdit | undefined => store.edits[agent],
  count: () => Object.keys(store.edits).length,
  /** Stage a model pick, carrying the agent's current variant when the new model declares it. */
  stageModel: (
    agent: string,
    model: { providerID: string; modelID: string },
    current: string | undefined,
    list: readonly string[],
  ) => globalStage.stage(agent, { model, variant: carriedVariant(current, list) }),
  stage: (agent: string, edit: StagedAgentEdit) => setStore("edits", reconcile(stageEdit(store.edits, agent, edit))),
  drop: (agents: readonly string[]) =>
    setStore(
      "edits",
      reconcile(Object.fromEntries(Object.entries(store.edits).filter(([agent]) => !agents.includes(agent)))),
    ),
}
