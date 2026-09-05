import path from "path"
import { fileURLToPath } from "url"
import { applyProviderOverrides, writeRegistryOutputs } from "./provider-sync.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"
// Fetch and generate models.dev snapshot
const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await fetch(`${modelsUrl}/api.json`).then((x) => x.text())

// Providers configured in provider-sync.ts are rebuilt from their live source,
// overriding the (possibly stale) upstream registry entry.
const data = await applyProviderOverrides(JSON.parse(modelsData) as Record<string, unknown>, {
  continueOnError: true,
})

// Write per-provider JSON files + bundled snapshot
await writeRegistryOutputs(data, dir)
