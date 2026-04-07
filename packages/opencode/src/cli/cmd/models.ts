import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ProviderID } from "../../provider/schema"
import { ModelsDev } from "../../provider/models"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import * as ModelResolver from "../../provider/model-resolver"
import { Config } from "../../config/config"
import { ConfigPaths } from "../../config/paths"
import path from "path"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import * as readline from "readline"

export const ModelsCommand = cmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      })
      .option("resolve", {
        alias: "r",
        describe:
          "resolve and display full parameters for a model. Use fuzzy search (e.g. 'kat' matches 'streamlake/kat-coder-pro-v2'). Use --interactive for fuzzy selection.",
        type: "string",
      })
      .option("interactive", {
        alias: "i",
        describe: "interactive fuzzy search for model resolution. Type to filter, Enter to select, Ctrl+C to cancel.",
        type: "boolean",
      })
      .option("expand", {
        describe: "expand config file with resolved model parameters from cache",
        type: "boolean",
      })
  },
  handler: async (args) => {
    if (args.refresh) {
      await ModelsDev.refresh(true)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    if (args.interactive || (!args.resolve && args.resolve !== "")) {
      await resolveInteractive()
      return
    }

    if (args.resolve) {
      await resolveModelQuery(args.resolve)
      return
    }

    if (args.expand) {
      await expandConfigWithCache()
      return
    }

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const providers = await Provider.list()

        function printModels(providerID: ProviderID, verbose?: boolean) {
          const provider = providers[providerID]
          const sortedModels = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
          for (const [modelID, model] of sortedModels) {
            process.stdout.write(`${providerID}/${modelID}`)
            process.stdout.write(EOL)
            if (verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
        }

        if (args.provider) {
          const provider = providers[ProviderID.make(args.provider)]
          if (!provider) {
            UI.error(`Provider not found: ${args.provider}`)
            return
          }

          printModels(ProviderID.make(args.provider), args.verbose)
          return
        }

        const providerIDs = Object.keys(providers).sort((a, b) => {
          const aIsOpencode = a.startsWith("opencode")
          const bIsOpencode = b.startsWith("opencode")
          if (aIsOpencode && !bIsOpencode) return -1
          if (!aIsOpencode && bIsOpencode) return 1
          return a.localeCompare(b)
        })

        for (const providerID of providerIDs) {
          printModels(ProviderID.make(providerID), args.verbose)
        }
      },
    })
  },
})

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t.includes(q)) return true
  const parts = q.split(/[\s\-_]+/)
  return parts.every((part) => t.includes(part))
}

function scoreMatch(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t === q) return 100
  if (t.startsWith(q)) return 90
  if (t.includes(q)) return 80
  const parts = q.split(/[\s\-_]+/)
  const targetParts = t.split(/[\s\-_]+/)
  const matchedParts = parts.filter((p) => targetParts.some((tp) => tp.includes(p)))
  return matchedParts.length * 10
}

async function resolveModelQuery(query: string) {
  const modelsDev = await ModelsDev.get()
  const allModels: string[] = []

  for (const [providerID, provider] of Object.entries(modelsDev)) {
    for (const modelID of Object.keys(provider.models)) {
      allModels.push(`${providerID}/${modelID}`)
    }
  }

  const matches = allModels
    .filter((m) => fuzzyMatch(query, m))
    .sort((a, b) => scoreMatch(query, b) - scoreMatch(query, a))

  if (matches.length === 0) {
    UI.error(`No models match: "${query}"`)
    UI.println("Run 'opencode models --interactive' for fuzzy search.")
    return
  }

  if (matches.length === 1) {
    const [providerID, modelID] = matches[0].split("/")
    await displayResolved(providerID, modelID)
    return
  }

  UI.println(`Found ${matches.length} matches for "${query}":`)
  for (const match of matches.slice(0, 10)) {
    UI.println(`  ${match}`)
  }
  if (matches.length > 10) {
    UI.println(`  ... and ${matches.length - 10} more`)
  }
  UI.println("")
  UI.println("Use a more specific query or 'opencode models --interactive' for selection.")
}

async function displayResolved(providerID: string, modelID: string) {
  const resolved = await ModelResolver.resolveModel(providerID, modelID)
  if (!resolved) {
    UI.error(`Model not found in cache: ${providerID}/${modelID}`)
    UI.println("Run 'opencode models --refresh' to update the cache.")
    return
  }
  UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Resolved parameters for ${providerID}/${modelID}` + UI.Style.TEXT_NORMAL)
  UI.println(`Source: ${resolved.source}`)
  UI.println(`Fields from cache: ${resolved.resolvedFields.join(", ") || "(none)"}`)
  UI.println("")
  UI.println(JSON.stringify(resolved.parameters, null, 2))
}

async function resolveInteractive() {
  const modelsDev = await ModelsDev.get()
  const allModels: string[] = []

  for (const [providerID, provider] of Object.entries(modelsDev)) {
    for (const modelID of Object.keys(provider.models)) {
      allModels.push(`${providerID}/${modelID}`)
    }
  }

  UI.println("Interactive model search. Type to filter, Enter to select, Ctrl+C to cancel.")
  UI.println("")

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  const keyPressPromise = new Promise<string>((resolve) => {
    let input = ""
    const raw = process.stdin as NodeJS.ReadStream
    raw.setRawMode?.(true)
    raw.resume()

    const onData = (data: Buffer) => {
      const key = data.toString()

      if (key === "\x03" || key === "\x1b") {
        raw.setRawMode?.(false)
        raw.pause()
        raw.removeListener("data", onData)
        resolve("\x03")
        return
      }

      if (key === "\r" || key === "\n") {
        raw.setRawMode?.(false)
        raw.pause()
        raw.removeListener("data", onData)
        resolve(input.trim())
        return
      }

      if (key === "\x7f" || key === "\b") {
        input = input.slice(0, -1)
      } else if (key.length === 1 && key >= " ") {
        input += key
      }

      const matches = input
        ? allModels.filter((m) => fuzzyMatch(input, m)).sort((a, b) => scoreMatch(input, b) - scoreMatch(input, a))
        : allModels

      process.stdout.write("\x1B[2J\x1B[0;0H")
      UI.println(`Search: ${input}_`)
      UI.println("Enter to select, Ctrl+C to cancel")
      UI.println("")

      const display = matches.slice(0, 15)
      for (let i = 0; i < display.length; i++) {
        UI.println(`  ${i + 1}. ${display[i]}`)
      }
      if (matches.length > 15) {
        UI.println(`  ... and ${matches.length - 15} more`)
      }
      if (matches.length === 0) {
        UI.println("  (no matches)")
      }
    }

    raw.on("data", onData)
  })

  const result = await keyPressPromise

  if (result === "\x03") {
    UI.println("\nCancelled.")
    return
  }

  const trimmed = result.trim()
  if (!trimmed) {
    UI.error("No selection made.")
    return
  }

  const modelsDev2 = await ModelsDev.get()
  const allModels2: string[] = []
  for (const [providerID, provider] of Object.entries(modelsDev2)) {
    for (const modelID of Object.keys(provider.models)) {
      allModels2.push(`${providerID}/${modelID}`)
    }
  }

  const matches = allModels2
    .filter((m) => fuzzyMatch(trimmed, m))
    .sort((a, b) => scoreMatch(trimmed, b) - scoreMatch(trimmed, a))

  if (matches.length === 0) {
    UI.error(`No models match: "${trimmed}"`)
    return
  }

  const selected = matches[0]
  const [providerID, modelID] = selected.split("/")
  await displayResolved(providerID, modelID)
}

async function expandConfigWithCache() {
  const configPaths = [
    path.join(process.cwd(), "opencode.json"),
    path.join(process.cwd(), "opencode.jsonc"),
    path.join(process.cwd(), ".opencode", "config.jsonc"),
    path.join(Global.Path.config, "opencode.json"),
    path.join(Global.Path.config, "opencode.jsonc"),
  ]

  let configPath: string | undefined
  for (const p of configPaths) {
    try {
      await Filesystem.readText(p)
      configPath = p
      break
    } catch {
      continue
    }
  }

  if (!configPath) {
    UI.error("No config file found")
    return
  }

  const text = await Filesystem.readText(configPath)
  const parsed = Config.Info.parse(await ConfigPaths.parseText(text, { source: configPath, dir: process.cwd() }))

  if (!parsed?.provider) {
    UI.println("No providers configured")
    return
  }

  const modelsDev = await ModelsDev.get()
  let modified = false

  for (const [providerID, providerConfig] of Object.entries(parsed.provider)) {
    if (!providerConfig.models) continue
    for (const [modelID, modelConfig] of Object.entries(providerConfig.models)) {
      if ((modelConfig as any)._resolved_from_cache) continue

      const cacheModel = modelsDev[providerID]?.models?.[modelID]
      if (!cacheModel) continue

      const resolved = await ModelResolver.resolveWithConfig(providerID, modelID, modelConfig)

      if (resolved.configOverrides.length === 0) {
        UI.println(`Expanding ${providerID}/${modelID} with cache defaults`)
      } else {
        UI.println(`Expanding ${providerID}/${modelID} (overrides: ${resolved.configOverrides.join(", ")})`)
      }

      const expandedModel: Record<string, unknown> = {
        ...(modelConfig as Record<string, unknown>),
      }

      if (!expandedModel.provider && resolved.parameters.provider) {
        expandedModel.provider = resolved.parameters.provider
      }
      if (!expandedModel.limit && resolved.parameters.limit?.context) {
        expandedModel.limit = resolved.parameters.limit
      }
      if (expandedModel.temperature === undefined && resolved.parameters.capabilities?.temperature !== undefined) {
        expandedModel.temperature = resolved.parameters.capabilities.temperature
      }
      if (expandedModel.reasoning === undefined && resolved.parameters.capabilities?.reasoning !== undefined) {
        expandedModel.reasoning = resolved.parameters.capabilities.reasoning
      }
      if (expandedModel.tool_call === undefined && resolved.parameters.capabilities?.toolcall !== undefined) {
        expandedModel.tool_call = resolved.parameters.capabilities.toolcall
      }
      if (expandedModel.attachment === undefined && resolved.parameters.capabilities?.attachment !== undefined) {
        expandedModel.attachment = resolved.parameters.capabilities.attachment
      }

      expandedModel._resolved_from_cache = true
      providerConfig.models[modelID] = expandedModel
      modified = true
    }
  }

  if (!modified) {
    UI.println("Config already expanded")
    return
  }

  const output = JSON.stringify(parsed, null, 2)
  await Filesystem.write(configPath, output)
  UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Config expanded: ${configPath}` + UI.Style.TEXT_NORMAL)
}
