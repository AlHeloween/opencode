import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

function number(key: string) {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

// Config-derived flag values. Populated by Flag.fromConfig() at config load time.
// Getters will check this cache first (config), then fall back to env vars.
let _configValues: Record<string, unknown> = {}

/**
 * Initialize Flag overrides from config-derived values.
 * Call once per config load, before any getters are read.
 * Only stores non-undefined values; undefined values leave the
 * env-var fallback intact.
 */
export function fromConfig(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) _configValues[key] = value
  }
}

/** Reset config overrides (for testing). */
export function resetConfig(): void {
  _configValues = {}
}

const OPENCODE_EXPERIMENTAL = truthy("OPENCODE_EXPERIMENTAL")
const OPENCODE_DISABLE_CLAUDE_CODE = truthy("OPENCODE_DISABLE_CLAUDE_CODE")
const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS =
  OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS")
const copy = process.env["OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {  get OPENCODE_AUTO_SHARE() { return (_configValues["OPENCODE_AUTO_SHARE"] as boolean) ?? truthy("OPENCODE_AUTO_SHARE") },
  get OPENCODE_AUTO_HEAP_SNAPSHOT() { return (_configValues["OPENCODE_AUTO_HEAP_SNAPSHOT"] as boolean) ?? truthy("OPENCODE_AUTO_HEAP_SNAPSHOT") },
  OPENCODE_GIT_BASH_PATH: process.env["OPENCODE_GIT_BASH_PATH"],
  OPENCODE_CONFIG: process.env["OPENCODE_CONFIG"],
  OPENCODE_CONFIG_CONTENT: process.env["OPENCODE_CONFIG_CONTENT"],

  get OPENCODE_DISABLE_PRUNE() { return (_configValues["OPENCODE_DISABLE_PRUNE"] as boolean) ?? truthy("OPENCODE_DISABLE_PRUNE") },
  get OPENCODE_DISABLE_TERMINAL_TITLE() { return (_configValues["OPENCODE_DISABLE_TERMINAL_TITLE"] as boolean) ?? truthy("OPENCODE_DISABLE_TERMINAL_TITLE") },
  get OPENCODE_SHOW_TTFD() { return (_configValues["OPENCODE_SHOW_TTFD"] as boolean) ?? truthy("OPENCODE_SHOW_TTFD") },
  OPENCODE_PERMISSION: process.env["OPENCODE_PERMISSION"],
  get OPENCODE_DISABLE_DEFAULT_PLUGINS() { return (_configValues["OPENCODE_DISABLE_DEFAULT_PLUGINS"] as boolean) ?? truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS") },
  get OPENCODE_DISABLE_LSP_DOWNLOAD() { return (_configValues["OPENCODE_DISABLE_LSP_DOWNLOAD"] as boolean) ?? truthy("OPENCODE_DISABLE_LSP_DOWNLOAD") },
  get OPENCODE_ENABLE_EXPERIMENTAL_MODELS() { return (_configValues["OPENCODE_ENABLE_EXPERIMENTAL_MODELS"] as boolean) ?? truthy("OPENCODE_ENABLE_EXPERIMENTAL_MODELS") },
  get OPENCODE_DISABLE_AUTOCOMPACT() { return (_configValues["OPENCODE_DISABLE_AUTOCOMPACT"] as boolean) ?? truthy("OPENCODE_DISABLE_AUTOCOMPACT") },
  get OPENCODE_DISABLE_MODELS_FETCH() { return (_configValues["OPENCODE_DISABLE_MODELS_FETCH"] as boolean) ?? truthy("OPENCODE_DISABLE_MODELS_FETCH") },
  get OPENCODE_DISABLE_MOUSE() { return (_configValues["OPENCODE_DISABLE_MOUSE"] as boolean) ?? truthy("OPENCODE_DISABLE_MOUSE") },
  OPENCODE_DISABLE_CLAUDE_CODE,
  OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT"),
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS,
  OPENCODE_DISABLE_EXTERNAL_SKILLS: OPENCODE_DISABLE_CLAUDE_CODE_SKILLS || truthy("OPENCODE_DISABLE_EXTERNAL_SKILLS"),
  OPENCODE_FAKE_VCS: process.env["OPENCODE_FAKE_VCS"],
  OPENCODE_SERVER_PASSWORD: process.env["OPENCODE_SERVER_PASSWORD"],
  OPENCODE_SERVER_USERNAME: process.env["OPENCODE_SERVER_USERNAME"],
  get OPENCODE_ENABLE_QUESTION_TOOL() { return (_configValues["OPENCODE_ENABLE_QUESTION_TOOL"] as boolean) ?? truthy("OPENCODE_ENABLE_QUESTION_TOOL") },

  // Experimental
  OPENCODE_EXPERIMENTAL,
  OPENCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY"),
  OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OPENCODE_ENABLE_EXA: truthy("OPENCODE_ENABLE_EXA") || OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_EXA"),
  OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: number("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: number("OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  OPENCODE_EXPERIMENTAL_OXFMT: OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_OXFMT"),
  get OPENCODE_EXPERIMENTAL_LSP_TY() { return (_configValues["OPENCODE_EXPERIMENTAL_LSP_TY"] as boolean) ?? truthy("OPENCODE_EXPERIMENTAL_LSP_TY") },
  OPENCODE_EXPERIMENTAL_LSP_TOOL: OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_LSP_TOOL"),
  OPENCODE_EXPERIMENTAL_PLAN_MODE: OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_PLAN_MODE"),
  OPENCODE_EXPERIMENTAL_MARKDOWN: !falsy("OPENCODE_EXPERIMENTAL_MARKDOWN"),
  OPENCODE_MODELS_URL: process.env["OPENCODE_MODELS_URL"],
  OPENCODE_MODELS_PATH: process.env["OPENCODE_MODELS_PATH"],
  get OPENCODE_DISABLE_EMBEDDED_WEB_UI() { return (_configValues["OPENCODE_DISABLE_EMBEDDED_WEB_UI"] as boolean) ?? truthy("OPENCODE_DISABLE_EMBEDDED_WEB_UI") },
  OPENCODE_DB: process.env["OPENCODE_DB"],
  get OPENCODE_DISABLE_CHANNEL_DB() { return (_configValues["OPENCODE_DISABLE_CHANNEL_DB"] as boolean) ?? truthy("OPENCODE_DISABLE_CHANNEL_DB") },
  get OPENCODE_STRICT_CONFIG_DEPS() { return (_configValues["OPENCODE_STRICT_CONFIG_DEPS"] as boolean) ?? truthy("OPENCODE_STRICT_CONFIG_DEPS") },

  OPENCODE_WORKSPACE_ID: process.env["OPENCODE_WORKSPACE_ID"],
  get OPENCODE_EXPERIMENTAL_HTTPAPI() { return (_configValues["OPENCODE_EXPERIMENTAL_HTTPAPI"] as boolean) ?? truthy("OPENCODE_EXPERIMENTAL_HTTPAPI") },
  OPENCODE_EXPERIMENTAL_WORKSPACES: OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OPENCODE_DISABLE_PROJECT_CONFIG() {
    return (_configValues["OPENCODE_DISABLE_PROJECT_CONFIG"] as boolean) ?? truthy("OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  get OPENCODE_TUI_CONFIG() {
    return process.env["OPENCODE_TUI_CONFIG"]
  },
  get OPENCODE_CONFIG_DIR() {
    return process.env["OPENCODE_CONFIG_DIR"]
  },
  get OPENCODE_PURE() {
    return (_configValues["OPENCODE_PURE"] as boolean) ?? truthy("OPENCODE_PURE")
  },
  get OPENCODE_PLUGIN_META_FILE() {
    return (_configValues["OPENCODE_PLUGIN_META_FILE"] as string) ?? process.env["OPENCODE_PLUGIN_META_FILE"]
  },
  get OPENCODE_CLIENT() {
    return (_configValues["OPENCODE_CLIENT"] as string) ?? process.env["OPENCODE_CLIENT"] ?? "cli"
  },

  // Initialize overrides from config-derived values (sub-goal 4 bridge).
  fromConfig,
  resetConfig,

  /** Directly set a config override — for test setup only. */
  _setTest(key: string, value: unknown) {
    _configValues[key] = value
  },
}
