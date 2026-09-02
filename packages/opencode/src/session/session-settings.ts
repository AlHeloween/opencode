import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Session-specific settings — per-session overrides for agent models,
 * variants, and task() subagent allow-lists.
 *
 * File location: {worktree}/.opencode/data/sessions/{sessionID}.jsonc
 * (worktree-local — multi-project installs do not share these overrides.)
 *
 * Loading priority:
 *   1. Session file (if present) → session override
 *   2. Workspace state (model.json) → last model selected in that workspace
 *   3. Global config (opencode.jsonc) / native Agent.Info → defaults only
 */

// ── Types ──

export interface SessionAgentOverride {
  /** "providerID/modelID" */
  model?: string
  /** Variant name (e.g. "high", "fast", "reasoning") */
  variant?: string
  /**
   * Allowed task() subagent ids for this agent in this session only.
   * Canonical ids (explorer_agent, coder_agent, …). Omitted = use global Agent.Info.subagents.
   * Empty array = deny all task delegation.
   */
  subagents?: string[]
  /** Session-scoped OpenRouter routing (TUI /agents ctrl+o, session scope). Highest routing priority. */
  routing?: Record<string, unknown>
}

export interface SessionSettings {
  /** Per-agent model/variant overrides for this session */
  agent?: Record<string, SessionAgentOverride>
  /** Session-scoped recently used models list */
  recent?: Array<{ providerID: string; modelID: string }>
  /** Session-scoped favorite models list */
  favorite?: Array<{ providerID: string; modelID: string }>
  /** Session-scoped global variant overrides (key: "providerID/modelID") */
  variant?: Record<string, string>
  /** Session-scoped per-agent variant overrides (key: "agentName/providerID/modelID") */
  agentVariant?: Record<string, string>
  /** Session-scoped OpenRouter routing per model (key: "providerID/modelID", variant-stripped). */
  modelRouting?: Record<string, Record<string, unknown>>
}

export interface ModelRef {
  providerID: string
  modelID: string
}

export const DEFAULT_WORKSPACE_MODEL_SCOPE = "default"

/** A missing control-plane workspace still has an isolated worktree state file. */
export function workspaceModelScope(workspaceID: string | undefined): string {
  return workspaceID ?? DEFAULT_WORKSPACE_MODEL_SCOPE
}

/** Return a workspace model map with one agent selection updated. */
export function setWorkspaceAgentModel(
  workspaceAgent: Record<string, Record<string, ModelRef>>,
  workspaceID: string | undefined,
  agentName: string,
  model: ModelRef,
): Record<string, Record<string, ModelRef>> {
  const scope = workspaceModelScope(workspaceID)
  return {
    ...workspaceAgent,
    [scope]: {
      ...workspaceAgent[scope],
      [agentName]: model,
    },
  }
}

/** Read a valid agent model from the workspace-level state payload. */
export function workspaceAgentModel(agentName: string, workspaceID: string | undefined, state: unknown): ModelRef | undefined {
  if (typeof state !== "object" || state === null) return undefined
  const workspaceAgent = (state as Record<string, unknown>).workspaceAgent
  if (typeof workspaceAgent !== "object" || workspaceAgent === null) return undefined
  const workspace = (workspaceAgent as Record<string, unknown>)[workspaceModelScope(workspaceID)]
  if (typeof workspace !== "object" || workspace === null) return undefined
  const model = (workspace as Record<string, unknown>)[agentName]
  if (typeof model !== "object" || model === null) return undefined
  const value = model as Record<string, unknown>
  if (typeof value.providerID !== "string" || typeof value.modelID !== "string") return undefined
  if (!value.providerID || !value.modelID) return undefined
  return { providerID: value.providerID, modelID: value.modelID }
}

/** Read a per-session model selection for one agent. Invalid persisted values are ignored. */
export function sessionAgentModel(
  agentName: string,
  settings: SessionSettings | null | undefined,
): ModelRef | undefined {
  const value = settings?.agent?.[agentName]?.model
  if (!value) return undefined
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return undefined
  return {
    providerID: value.slice(0, slash),
    modelID: value.slice(slash + 1),
  }
}

/**
 * Resolve a session-scoped variant for an agent/model pair.
 *
 * `agentVariant` is the explicit TUI selection. `agent[].variant` is retained
 * for older session files. Model-level variant is the final session fallback.
 */
export function sessionAgentVariant(
  agentName: string,
  model: ModelRef,
  settings: SessionSettings | null | undefined,
): string | undefined {
  const modelKey = `${model.providerID}/${model.modelID}`
  return (
    settings?.agentVariant?.[`${agentName}/${modelKey}`] ??
    settings?.agent?.[agentName]?.variant ??
    settings?.variant?.[modelKey]
  )
}

// ── Unified resolution ──

/**
 * Read the workspace-level model state from disk (model.json).
 * Returns the raw state object or undefined on any error.
 */
export async function readModelState(): Promise<Record<string, unknown> | undefined> {
  const filePath = path.join(Global.Path.state, "model.json")
  try {
    const exists = await Filesystem.exists(filePath)
    if (!exists) return undefined
    const raw = await Filesystem.readText(filePath)
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Unified agent model resolution — single source of truth for ALL code paths.
 *
 * Resolution order (highest priority first):
 *   1. Session override    — sessionSettings.agent[name].model
 *   2. Workspace selection — workspaceAgentModel(name, workspaceID, modelState)
 *   3. (caller falls through to global config / default)
 *
 * Returns undefined when no session/workspace override exists,
 * letting the caller fall through to global Agent.Info.model or provider default.
 *
 * This replaces the ad-hoc chains previously duplicated in:
 *   task.ts, pipeline.ts, plan.ts, reasoning.ts, prompt.ts
 */
export async function resolveAgentModel(
  agentName: string,
  context: { sessionID: string; workspaceID?: string },
  opts?: {
    /** Pre-loaded session settings (avoids redundant disk read) */
    settings?: SessionSettings | null
    /** Pre-loaded model.json state (avoids redundant disk read) */
    modelState?: Record<string, unknown>
  },
): Promise<ModelRef | undefined> {
  // 1. Session override (highest priority)
  const settings = opts?.settings ?? (await loadSessionSettings(context.sessionID))
  const sessionModel = sessionAgentModel(agentName, settings)
  if (sessionModel) return sessionModel

  // 2. Workspace selection (last explicit pick in this worktree)
  const modelState = opts?.modelState ?? (await readModelState())
  const workspaceModel = workspaceAgentModel(agentName, context.workspaceID, modelState)
  if (workspaceModel) return workspaceModel

  // 3. No override — caller should fall through to global config / default
  return undefined
}

/**
 * Unified agent variant resolution — single source of truth for ALL code paths.
 *
 * Resolution order:
 *   1. Session agentVariant  — settings.agentVariant["agent/model"]
 *   2. Session agent variant — settings.agent[name].variant
 *   3. Session model variant — settings.variant["model"]
 *   4. (caller falls through to workspace/global variant)
 *
 * Returns undefined when no session variant exists.
 */
export async function resolveAgentVariant(
  agentName: string,
  model: ModelRef,
  context: { sessionID: string },
  opts?: {
    /** Pre-loaded session settings (avoids redundant disk read) */
    settings?: SessionSettings | null
  },
): Promise<string | undefined> {
  const settings = opts?.settings ?? (await loadSessionSettings(context.sessionID))
  return sessionAgentVariant(agentName, model, settings)
}

/** Session-scoped OpenRouter routing for one agent (TUI /agents ctrl+o, session scope).
 * Highest routing priority — llm.ts threads it before agent options (config). */
export function sessionAgentRouting(
  agentName: string,
  settings: SessionSettings | null | undefined,
): Record<string, unknown> | undefined {
  const value = settings?.agent?.[agentName]?.routing
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined
}

/** Session-scoped OpenRouter routing for a model (TUI /model ctrl+o, session scope).
 * Keys are variant-stripped "providerID/modelID" — callers normalize the id. */
export function sessionModelRouting(
  providerID: string,
  modelID: string,
  settings: SessionSettings | null | undefined,
): Record<string, unknown> | undefined {
  const value = settings?.modelRouting?.[`${providerID}/${modelID}`]
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined
}

// ── File path ──

// ── Save concurrency ──

const pendingWrites = new Map<string, Promise<void>>()

/** Get the session settings file path for a given session ID. */
export function getSessionSettingsPath(sessionID: string): string {
  return path.join(Global.Path.data, "sessions", `${sessionID}.jsonc`)
}

// ── Load ──

/**
 * Load session settings for a given session ID.
 * Returns null if no settings file exists.
 */
export async function loadSessionSettings(sessionID: string): Promise<SessionSettings | null> {
  const filePath = getSessionSettingsPath(sessionID)
  try {
    const exists = await Filesystem.exists(filePath)
    if (!exists) return null

    const raw = await Filesystem.readText(filePath)
    // Parse as JSON (jsonc-parser not needed — we store clean JSON)
    const data = JSON.parse(raw) as Record<string, unknown>
    return normalizeSessionSettings(data)
  } catch (e) {
    Log.Default.warn("bug: failed to load session settings", {
      sessionID,
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

function normalizeSessionSettings(raw: Record<string, unknown>): SessionSettings {
  const settings: SessionSettings = {}

  if (typeof raw.agent === "object" && raw.agent !== null && !Array.isArray(raw.agent)) {
    const agent: Record<string, SessionAgentOverride> = {}
    for (const [name, value] of Object.entries(raw.agent as Record<string, unknown>)) {
      if (typeof value === "object" && value !== null) {
        const override: SessionAgentOverride = {}
        const v = value as Record<string, unknown>
        if (typeof v.model === "string") override.model = v.model
        if (typeof v.variant === "string") override.variant = v.variant
        if (Array.isArray(v.subagents) && v.subagents.every((x) => typeof x === "string")) {
          override.subagents = v.subagents as string[]
        }
        if (v.routing && typeof v.routing === "object" && !Array.isArray(v.routing)) {
          override.routing = v.routing as Record<string, unknown>
        }
        if (override.model || override.variant || override.subagents || override.routing) agent[name] = override
      }
    }
    if (Object.keys(agent).length > 0) settings.agent = agent
  }

  if (Array.isArray(raw.recent)) {
    const items = raw.recent.filter(
      (x: unknown): x is { providerID: string; modelID: string } =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as Record<string, unknown>).providerID === "string" &&
        typeof (x as Record<string, unknown>).modelID === "string",
    )
    if (items.length > 0) settings.recent = items
  }

  if (Array.isArray(raw.favorite)) {
    const items = raw.favorite.filter(
      (x: unknown): x is { providerID: string; modelID: string } =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as Record<string, unknown>).providerID === "string" &&
        typeof (x as Record<string, unknown>).modelID === "string",
    )
    if (items.length > 0) settings.favorite = items
  }

  if (typeof raw.variant === "object" && raw.variant !== null && !Array.isArray(raw.variant)) {
    settings.variant = raw.variant as Record<string, string>
  }

  if (typeof raw.agentVariant === "object" && raw.agentVariant !== null && !Array.isArray(raw.agentVariant)) {
    settings.agentVariant = raw.agentVariant as Record<string, string>
  }

  if (typeof raw.modelRouting === "object" && raw.modelRouting !== null && !Array.isArray(raw.modelRouting)) {
    const map: Record<string, Record<string, unknown>> = {}
    for (const [key, value] of Object.entries(raw.modelRouting as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Array.isArray(value)) map[key] = value as Record<string, unknown>
    }
    if (Object.keys(map).length > 0) settings.modelRouting = map
  }

  return settings
}

// ── Save ──

/**
 * Save session settings for a given session ID.
 * Creates the file atomically (write to temp then rename).
 */
export async function saveSessionSettings(sessionID: string, settings: SessionSettings): Promise<void> {
  const filePath = getSessionSettingsPath(sessionID)
  const previous = pendingWrites.get(filePath) ?? Promise.resolve()
  const write = previous
    .catch((error) =>
      Log.Default.warn("bug: previous session settings save failed", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    .then(() => Filesystem.writeJson(filePath, settings))
  pendingWrites.set(filePath, write)
  try {
    await write
  } catch (e) {
    Log.Default.warn("bug: failed to save session settings", {
      sessionID,
      error: e instanceof Error ? e.message : String(e),
    })
  } finally {
    if (pendingWrites.get(filePath) === write) pendingWrites.delete(filePath)
  }
}

// ── Remove ──

/** Delete session settings file for a given session ID. */
export async function removeSessionSettings(sessionID: string): Promise<void> {
  const filePath = getSessionSettingsPath(sessionID)
  try {
    const exists = await Filesystem.exists(filePath)
    if (exists) {
      const { unlink } = await import("fs/promises")
      await unlink(filePath)
    }
  } catch (e) {
    Log.Default.warn("bug: failed to remove session settings", {
      sessionID,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * Effective task() allow-list for an agent in a session.
 * Session override wins when set; else global Agent.Info.subagents; else undefined (all allowed).
 */
export function effectiveSubagents(
  agentName: string,
  globalSubagents: string[] | undefined,
  settings: SessionSettings | null | undefined,
): string[] | undefined {
  const override = settings?.agent?.[agentName]?.subagents
  if (override !== undefined) return override
  return globalSubagents
}

export * as SessionSettings from "./session-settings"
