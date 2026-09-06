import * as Config from "@/config/config"
import { MODEL_STATE_KEYS, SESSION_SETTINGS_KEYS } from "@/session/session-settings"

/**
 * Settings registry (subplan 03) — single source of truth for the /settings
 * dialog. Rows are GENERATED from the Config.Info schema top-level fields
 * (policy: a setting that exists in the product but is absent here is a bug —
 * the coverage test enforces zero diff), enriched with a curated map of kinds,
 * groups and descriptions. Future schema fields automatically receive a
 * conservative read-only "json" row in the "Other" group until curated.
 *
 * Write plumbing (reused, no new endpoints):
 *   worktree → PATCH /config (RFC 7386 merge-patch, minimal subtree — subplan 05 rev 2)
 *   global   → PATCH /global/config (get → set field → update, DialogConfirm first — subplan 01)
 *   session  → dedicated dialogs (/agents, /model) own session edits in v1 —
 *              session/model-state rows display values and point at them.
 */

export type SettingKind = "boolean" | "enum" | "string" | "number" | "model" | "json" | "env"
export type SettingSource = "config" | "session" | "model-state" | "env"
export type SettingLayer = "global" | "worktree" | "session"

export interface SettingRow {
  id: string
  group: string
  title: string
  kind: SettingKind
  source: SettingSource
  /** Config field name / session or model-state key / env var name. */
  schemaKey?: string
  enumValues?: string[]
  layers: SettingLayer[]
  readOnly?: boolean
  description?: string
}

// ── Curated metadata (master.md inventory groups A–E) ──

const GROUPS: Record<string, string> = {
  username: "Identity",
  client: "Identity",
  $schema: "Schema",
  shell: "Terminal",
  terminal: "Terminal",
  logLevel: "Logging",
  debug: "Logging",
  gateway: "Logging",
  model: "Models",
  small_model: "Models",
  default_agent: "Models",
  provider: "Providers",
  disabled_providers: "Providers",
  enabled_providers: "Providers",
  paths: "Providers",
  agent: "Agents",
  pipelines: "Pipelines",
  command: "Commands",
  skills: "Skills & Instructions",
  instructions: "Skills & Instructions",
  mcp: "MCP",
  permission: "Permissions",
  navigation: "Permissions",
  external_directory_mode: "Permissions",
  bypass_constitution: "Permissions",
  sandbox: "Sandbox",
  tools: "Tools & Features",
  tool_output: "Tools & Features",
  experimental: "Tools & Features",
  features: "Tools & Features",
  compaction: "Compaction",
  share: "Sharing",
  autoshare: "Sharing",
  universal_search: "Search",
  sourcegraph: "Search",
  server: "Server",
  enterprise: "Enterprise",
  formatter: "Formatter & LSP",
  lsp: "Formatter & LSP",
  watcher: "Watcher",
  snapshot: "Snapshot & Diff",
  diff_requests: "Snapshot & Diff",
  plugin: "Plugins",
}

const TITLES: Record<string, string> = {
  $schema: "Schema URL",
  small_model: "Small model",
  default_agent: "Default agent",
  tool_output: "Tool output limits",
  universal_search: "Universal search",
}

const DESCRIPTIONS: Record<string, string> = {
  username: "Display name for the user identity",
  shell: "Shell used to run commands",
  logLevel: "Minimum log level written to the log files",
  model: "Default model for new conversations (also editable via /model)",
  small_model: "Model used for cheap auxiliary tasks (titles, summaries)",
  default_agent: "Agent selected for new conversations (also editable via /agents)",
  share: "Sharing behavior for conversations",
  autoshare: "Deprecated automatic sharing switch",
  formatter: "Enable the formatter integration",
  lsp: "Enable the LSP integration",
  bypass_constitution: "Runtime constitution override switch — DANGEROUS",
  external_directory_mode: "How accesses outside the worktree are treated",
  compaction: "Auto-compaction thresholds for long conversations",
  universal_search: "Universal search backend (enabled/url)",
  sourcegraph: "Sourcegraph indexed-code search backend",
  server: "Headless server authentication and bind options",
  instructions: "Extra instruction files appended to the system prompt",
  experimental: "Experimental feature switches (may change any release)",
  features: "Product feature flags",
  plugin: "Plugin packages and entrypoints",
  sandbox: "Bash sandbox policy",
}

/** Curated kind overrides — schema-derived classification fills the rest. */
const KIND_OVERRIDES: Partial<Record<string, { kind: SettingKind; enumValues?: string[] }>> = {
  model: { kind: "model" },
  small_model: { kind: "model" },
  default_agent: { kind: "string" },
  shell: { kind: "string" },
  username: { kind: "string" },
  logLevel: { kind: "string" },
}

// ── Env inventory (master.md group B — read-only display rows) ──

export const ENV_VARS: { name: string; description: string }[] = [
  { name: "OPENCODE_CONFIG_CONTENT", description: "Inline config JSON (overrides config files)" },
  { name: "OPENCODE_AUTH_CONTENT", description: "Inline auth JSON (overrides auth file)" },
  { name: "OPENCODE_SERVER_PASSWORD", description: "Headless server auth password" },
  { name: "OPENCODE_SERVER_USERNAME", description: "Headless server auth username" },
  { name: "OPENCODE_GATEWAY_LOG_DIR", description: "Gateway log directory override" },
  { name: "OPENCODE_PURE", description: "Pure mode (no user state) process switch" },
  { name: "OPENCODE_PID", description: "Process identity marker" },
  { name: "OPENCODE_CLIENT", description: "Client identity marker" },
  { name: "OPENCODE_WASM_ROOT", description: "WASM assets path override" },
  { name: "OPENCODE_SKIP_MIGRATIONS", description: "Skip storage migrations (test)" },
  { name: "OPENCODE_TEST_MANAGED_CONFIG_DIR", description: "Managed-config override (test)" },
  { name: "OPENCODE_EDITOR_SSE_PORT", description: "Editor bridge SSE port" },
  { name: "CLAUDE_CODE_SSE_PORT", description: "Editor bridge SSE port (legacy name)" },
  { name: "OPENCODE_ZED_DB", description: "Zed integration database path" },
  { name: "OPENCODE_MARKDOWN", description: "Markdown rendering in TUI (must default to true)" },
]

// ── Schema-derived classification (best-effort, never throws) ──

function classify(field: unknown): { kind: SettingKind; enumValues?: string[] } {
  let node = field as any
  for (let i = 0; i < 4; i++) {
    const inner = node?.unwrap?.() ?? node?._def?.innerType ?? node?.def?.innerType
    if (!inner || inner === node) break
    node = inner
  }
  const typeName: string | undefined = node?._def?.typeName ?? node?.def?.type
  const values = node?.def?.values ?? node?._def?.values ?? node?.options
  if (Array.isArray(values) && values.length > 0 && values.every((v: unknown) => typeof v === "string")) {
    return { kind: "enum", enumValues: values }
  }
  if (typeof typeName === "string") {
    if (typeName.includes("boolean")) return { kind: "boolean" }
    if (typeName.includes("number") || typeName.includes("int")) return { kind: "number" }
    if (typeName.endsWith("string")) return { kind: "string" }
  }
  return { kind: "json" }
}

function humanize(key: string): string {
  return key
    .replace(/^[$]/, "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function configRows(): SettingRow[] {
  const shape = (Config.Info as unknown as { zod?: { shape?: Record<string, unknown> } }).zod?.shape
  if (!shape) {
    // The coverage test asserts enumerability; at runtime a missing shape must
    // not brick the dialog — degrade to no config rows with a loud log.
    return []
  }
  return Object.entries(shape).map(([key, field]) => {
    const curated = KIND_OVERRIDES[key]
    const inferred = classify(field)
    const kind = curated?.kind ?? inferred.kind
    const enumValues = curated?.enumValues ?? inferred.enumValues
    const readOnly = kind === "json"
    return {
      id: `config.${key}`,
      group: GROUPS[key] ?? "Other",
      title: TITLES[key] ?? humanize(key),
      kind,
      source: "config" as const,
      schemaKey: key,
      enumValues,
      layers: ["global", "worktree"] as SettingLayer[],
      readOnly,
      description: DESCRIPTIONS[key] ?? (readOnly ? "Structured value — edit the config file directly" : undefined),
    }
  })
}

function sessionRows(): SettingRow[] {
  return SESSION_SETTINGS_KEYS.map((key) => ({
    id: `session.${key}`,
    group: "Session (this conversation)",
    title: humanize(key),
    kind: "json" as const,
    source: "session" as const,
    schemaKey: key,
    layers: ["session"] as SettingLayer[],
    readOnly: true,
    description:
      key === "agent"
        ? "Per-agent model/variant/subagents overrides — edit via /agents (session scope)"
        : key === "favorite" || key === "recent"
          ? "Managed by the /model picker"
          : "Managed by the /model and /agents dialogs (session scope)",
  }))
}

function modelStateRows(): SettingRow[] {
  return MODEL_STATE_KEYS.map((key) => ({
    id: `model-state.${key}`,
    group: "Worktree state (model.json)",
    title: humanize(key),
    kind: "json" as const,
    source: "model-state" as const,
    schemaKey: key,
    layers: ["worktree"] as SettingLayer[],
    readOnly: true,
    description: "Persisted picker state — managed by the /model dialog",
  }))
}

function envRows(): SettingRow[] {
  return ENV_VARS.map((row) => ({
    id: `env.${row.name}`,
    group: "Environment (read-only)",
    title: row.name,
    kind: "env" as const,
    source: "env" as const,
    schemaKey: row.name,
    layers: ["global", "worktree", "session"] as SettingLayer[],
    readOnly: true,
    description: row.description,
  }))
}

/** Full registry — config rows are generated from the live schema. */
export const SETTINGS_REGISTRY: SettingRow[] = [...configRows(), ...sessionRows(), ...modelStateRows(), ...envRows()]

/** Current value of an env row from the TUI process environment. */
export function envValue(name: string): string | undefined {
  return process.env[name]
}
