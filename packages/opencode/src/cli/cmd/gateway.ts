import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import * as ConfigManager from "../../provider/gateway/config-manager"
import type { GatewayConfig, GatewayModelConfig } from "../../provider/gateway/config-manager"
import { Global } from "@opencode-ai/core/global"
import path from "path"

export const GatewayCommand = cmd({
  command: "gateway [action] [model]",
  describe: "manage gateway configuration and view model parameters",
  builder: (yargs: Argv) => {
    return yargs
      .positional("action", {
        describe: "action to perform: list, show, init",
        type: "string",
        choices: ["list", "show", "init"],
        default: "list",
      })
      .positional("model", {
        describe: "specific model to show (provider/model format)",
        type: "string",
      })
      .option("provider", {
        alias: "p",
        describe: "filter by provider ID",
        type: "string",
      })
      .option("format", {
        alias: "f",
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("global", {
        alias: "g",
        describe: "use global gateway config path",
        type: "boolean",
      })
      .option("local", {
        alias: "l",
        describe: "use local project gateway config path (.opencode/gateway.jsonc)",
        type: "boolean",
      })
  },
  handler: async (args) => {
    const action = args.action as string
    const format = args.format as "table" | "json"
    const modelArg = args.model as string | undefined

    if (action === "init") {
      await handleInit(args)
      return
    }

    if (action === "show" && modelArg) {
      await handleShow(modelArg, format)
      return
    }

    if (action === "show" && !modelArg) {
      UI.error("Model reference required for 'show' action")
      UI.println("Usage: opencode gateway show <provider/model>")
      return
    }

    await handleList(args.provider as string | undefined, format)
  },
})

async function handleList(providerFilter?: string, format: "table" | "json" = "table") {
  const config = await ConfigManager.loadGatewayConfig()
  const providers = config.providers

  const entries: Array<{ providerID: string; modelID: string; model: GatewayModelConfig }> = []

  for (const [providerID, provider] of Object.entries(providers)) {
    if (providerFilter && providerID !== providerFilter) continue
    for (const [modelID, model] of Object.entries(provider.models)) {
      entries.push({ providerID, modelID, model })
    }
  }

  if (entries.length === 0) {
    UI.println("No models configured in gateway.")
    if (providerFilter) {
      UI.println(`(filtered by provider: ${providerFilter})`)
    }
    UI.println("")
    UI.println("Run 'opencode gateway init' to create a gateway configuration template.")
    return
  }

  if (format === "json") {
    const output: Record<string, Record<string, GatewayModelConfig>> = {}
    for (const { providerID, modelID, model } of entries) {
      if (!output[providerID]) output[providerID] = {}
      output[providerID][modelID] = model
    }
    UI.println(JSON.stringify(output, null, 2))
    return
  }

  UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Gateway configured models" + UI.Style.TEXT_NORMAL)
  UI.println("")

  let currentProvider = ""
  for (const { providerID, modelID, model } of entries) {
    if (providerID !== currentProvider) {
      currentProvider = providerID
      UI.println(UI.Style.TEXT_HIGHLIGHT + providerID + UI.Style.TEXT_NORMAL)
    }

    const metadata = model.metadata
    const contextWindow = metadata?.context_window?.toLocaleString() ?? "-"
    const maxOutput = metadata?.max_output?.toLocaleString() ?? "-"
    const reasoning = metadata?.supports_reasoning ? "Yes" : "No"
    const attachments = metadata?.supports_attachments ? "Yes" : "No"

    UI.println(`  ${modelID}`)
    UI.println(`    Context window:  ${contextWindow}`)
    UI.println(`    Max output:      ${maxOutput}`)
    UI.println(`    Reasoning:       ${reasoning}`)
    UI.println(`    Attachments:     ${attachments}`)
    if (metadata?.cost_per_million) {
      const cost = metadata.cost_per_million
      UI.println(`    Cost (per 1M):   $${cost.input ?? 0} input / $${cost.output ?? 0} output`)
    }
    UI.println("")
  }

  UI.println("Use 'opencode gateway show <provider/model>' for full details.")
}

async function handleShow(modelRef: string, format: "table" | "json" = "table") {
  const parts = modelRef.split("/")
  if (parts.length !== 2) {
    UI.error("Model reference must be in format: provider/model")
    UI.println(`Example: streamlake/kat-coder-pro-v2`)
    return
  }

  const [providerID, modelID] = parts
  const config = await ConfigManager.loadGatewayConfig()
  const provider = config.providers[providerID]

  if (!provider) {
    UI.error(`Provider not found: ${providerID}`)
    return
  }

  const model = provider.models[modelID]
  if (!model) {
    UI.error(`Model not found: ${providerID}/${modelID}`)
    UI.println("Available models:")
    for (const [mid] of Object.entries(provider.models)) {
      UI.println(`  ${mid}`)
    }
    return
  }

  if (format === "json") {
    UI.println(JSON.stringify(model, null, 2))
    return
  }

  UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Model: ${providerID}/${modelID}` + UI.Style.TEXT_NORMAL)
  UI.println("")

  UI.println("Basic info:")
  UI.println(`  Name:      ${model.name ?? "-"}`)
  UI.println(`  ID:        ${model.id ?? "-"}`)
  UI.println(`  Base URL:  ${model.baseURL ?? "-"}`)
  UI.println("")

  if (model.gateway) {
    UI.println("Gateway settings:")
    UI.println(`  Enabled:   ${model.gateway.enabled !== false ? "Yes" : "No"}`)
    if (model.gateway.logging) {
      UI.println(
        `  Logging:   ${model.gateway.logging.enabled ? "Yes" : "No"} (${model.gateway.logging.format ?? "json"})`,
      )
    }
    UI.println("")
  }

  if (model.provider) {
    UI.println("Provider connectivity:")
    UI.println(`  NPM:  ${model.provider.npm ?? "-"}`)
    UI.println(`  API:  ${model.provider.api ?? "-"}`)
    UI.println("")
  }

  if (model.metadata) {
    UI.println("Model metadata:")
    const m = model.metadata
    UI.println(`  Context window:    ${m.context_window?.toLocaleString() ?? "-"} tokens`)
    UI.println(`  Max output:        ${m.max_output?.toLocaleString() ?? "-"} tokens`)
    UI.println(`  Supports reasoning: ${m.supports_reasoning ? "Yes" : "No"}`)
    UI.println(`  Attachments:       ${m.supports_attachments ? "Yes" : "No"}`)
    if (m.cost_per_million) {
      UI.println(`  Cost (per 1M tokens):`)
      UI.println(`    Input:  $${m.cost_per_million.input ?? 0}`)
      UI.println(`    Output: $${m.cost_per_million.output ?? 0}`)
      if (m.cost_per_million.cache_read !== undefined) {
        UI.println(`    Cache read:  $${m.cost_per_million.cache_read}`)
      }
      if (m.cost_per_million.cache_write !== undefined) {
        UI.println(`    Cache write: $${m.cost_per_million.cache_write}`)
      }
    }
    UI.println("")
  }

  if (model.options) {
    UI.println("Options:")
    UI.println(`  ${JSON.stringify(model.options, null, 2)}`)
    UI.println("")
  }

  UI.println("Config file locations:")
  UI.println(`  Global: ${path.join(Global.Path.config, "gateway.jsonc")}`)
  UI.println(`  Local:  ${path.join(process.cwd(), ".opencode", "gateway.jsonc")}`)
}

async function handleInit(args: { global?: boolean; local?: boolean }) {
  const config: GatewayConfig = {
    $schema: "https://opencode.ai/config.json",
    providers: {},
    gateway: {
      enabled: true,
      logging: {
        enabled: true,
        format: "json",
      },
    },
  }

  if (args.local || (!args.global && !args.local)) {
    const localPath = path.join(process.cwd(), ".opencode", "gateway.jsonc")
    await ConfigManager.writeConfigFile(localPath, config)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Created local gateway config: ${localPath}` + UI.Style.TEXT_NORMAL)
  }

  if (args.global) {
    const globalPath = path.join(Global.Path.config, "gateway.jsonc")
    await ConfigManager.writeConfigFile(globalPath, config)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Created global gateway config: ${globalPath}` + UI.Style.TEXT_NORMAL)
  }

  UI.println("")
  UI.println("Next steps:")
  UI.println("  1. Run 'opencode gateway list' to see configured models")
  UI.println("  2. Edit the gateway.jsonc file to customize providers and models")
}
