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
 *   1. Session file (if present) → overrides global agent definition for that field
 *   2. Global config (opencode.jsonc) / state (model.json) / native Agent.Info
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
}

export interface ModelRef {
  providerID: string
  modelID: string
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
 * for seeded native-agent defaults and older session files. Model-level variant
 * is the final session fallback.
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
        if (override.model || override.variant || override.subagents) agent[name] = override
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
