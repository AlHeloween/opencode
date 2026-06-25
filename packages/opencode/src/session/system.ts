import { Context, Effect, Layer } from "effect"

import { Instance } from "../project/instance"
import { Ripgrep } from "../file/ripgrep"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import PROMPT_COPILOT_GPT_5 from "./prompt/copilot-gpt-5.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

interface PromptEntry {
  models: string[]
  family: string
  filename: string
  content: string
}

export function parseFrontmatter(raw: string): { models: string[]; family: string; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) return { models: ["*"], family: "General", content: raw }
  const yaml = match[1]!
  const content = raw.slice(match[0].length)
  const models: string[] = []
  let family = "General"
  for (const line of yaml.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("-")) {
      models.push(trimmed.replace(/^-\s*/, "").replace(/^"(.*)"$/, "$1").trim())
    } else if (trimmed.startsWith("family:")) {
      family = trimmed.replace(/^family:\s*/, "").trim()
    }
  }
  if (models.length === 0) models.push("*")
  return { models, family, content }
}

const PROMPT_REGISTRY: PromptEntry[] = [
  { ...parseFrontmatter(PROMPT_ANTHROPIC), filename: "anthropic.txt" },
  { ...parseFrontmatter(PROMPT_BEAST), filename: "beast.txt" },
  { ...parseFrontmatter(PROMPT_CODEX), filename: "codex.txt" },
  { ...parseFrontmatter(PROMPT_GEMINI), filename: "gemini.txt" },
  { ...parseFrontmatter(PROMPT_GPT), filename: "gpt.txt" },
  { ...parseFrontmatter(PROMPT_KIMI), filename: "kimi.txt" },
  { ...parseFrontmatter(PROMPT_TRINITY), filename: "trinity.txt" },
  { ...parseFrontmatter(PROMPT_DEFAULT), filename: "default.txt" },
  { ...parseFrontmatter(PROMPT_COPILOT_GPT_5), filename: "copilot-gpt-5.txt" },
]

function resolvePrompt(model: Provider.Model): PromptEntry {
  const id = model.api.id.toLowerCase()
  let best: PromptEntry | undefined
  let bestLen = 0

  for (const entry of PROMPT_REGISTRY) {
    for (const pattern of entry.models) {
      if (pattern === "*") continue
      if (id.includes(pattern.toLowerCase()) && pattern.length > bestLen) {
        best = entry
        bestLen = pattern.length
      }
    }
  }

  if (best) return best

  const fallback = PROMPT_REGISTRY.find((e) => e.models.includes("*"))
  if (fallback) return fallback
  throw new Error("No prompt matches and no wildcard fallback in registry")
}

export function provider(model: Provider.Model) {
  return [resolvePrompt(model).content]
}

export function providerName(model: Provider.Model) {
  return resolvePrompt(model).filename
}

export function promptFamily(model: Provider.Model) {
  return resolvePrompt(model).family
}

export interface Interface {
  readonly environment: (model: Provider.Model) => string[]
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const rg = yield* Ripgrep.Service

    const capabilities = () => [
      `## Capabilities`,
      ``,
      `You have powerful tools at your disposal. Here are some key capabilities you should be aware of:`,
      ``,
      `- **Document conversion**: The read tool can extract text and convert many file formats to markdown, including PDFs, Word documents (.docx, .odt), Excel spreadsheets (.xlsx, .ods, .csv), PowerPoint presentations (.pptx, .odp), and plain text formats (.txt, .md, .json, .xml, .html)`,
      `- **Archive reading**: You can read the contents of compressed archives including .zip, .tar, .gz, and .7z files`,
      `- **Media files**: You can read image metadata (EXIF data), and extract information from audio and video files`,
      `- **Web search**: The universalsearch tool can search the web, code repositories, or use an autonomous AI research agent via the Universal Search Service. All modes go through the same configured URL — never use any other port.`,
      `- **Code search**: Use universalsearch with source: "code" for direct code search via Sourcegraph`,
      `- **Conversation search**: The messagesearch tool provides full-text search with epistemic-weighted semantic ranking over your conversation history`,
      `- **Session reading**: The session-read tool reads full messages by index from any session, including summaries`,
      `- **Directory listing**: The list tool provides a tree-style directory listing with automatic ignore of common directories`,
      `- **Multi-edit**: The multiedit tool allows multiple sequential edits to a single file in one operation`,
      `- **Web fetching**: The webfetch tool can retrieve and convert web pages to markdown, text, or HTML format`,
      `- **Sub-agents**: The task tool can spawn specialized sub-agents for focused work on specific domains`,
      ``,
      `When a user asks you to read or analyze a file, consider using the read tool — it supports far more formats than plain text. If a file type is unfamiliar, try reading it rather than assuming you cannot.`,
    ].join("\n")

    return Service.of({
      environment(model) {
        const project = Instance.project
        const family = resolvePrompt(model).family
        const outputModalityLine = ((): string | undefined => {
          const out = model.capabilities.output
          const modalities = Object.entries(out)
            .filter(([_, supported]) => supported)
            .map(([mod]) => mod)
          if (modalities.length <= 1 && out.text) return undefined
          return `Output modalities: ${modalities.join(", ")}`
        })()
        return [
          [
            `You are a ${family} coding assistant.`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${Instance.directory}`,
            `  Workspace root folder: ${Instance.worktree}`,
            `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `</env>`,
            capabilities(),
            ...(outputModalityLine ? [outputModalityLine] : []),
          ].join("\n"),
        ]
      },

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),

    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer), Layer.provide(Ripgrep.defaultLayer))

export * as SystemPrompt from "./system"
