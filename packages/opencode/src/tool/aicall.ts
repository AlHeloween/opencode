import * as Tool from "./tool"
import DESCRIPTION from "./aicall.txt"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Schema } from "effect"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { generateText } from "ai"
import * as Log from "@opencode-ai/core/util/log"
import { canonicalIdentity } from "@/session/mode-identity"
import { loadChain } from "@/provider/model-chain/store"
import { chainHealthState } from "@/provider/model-chain/health-registry"
import { resolveChainAgentModel } from "@/session/session-settings"
import { isListMember, readGlobalRecents } from "@/session/global-recents"

const log = Log.create({ service: "tool.aicall" })

const id = "aicall"

export function isRouterModel(model: { providerID: string; id: string; name?: string }): boolean {
  const pid = String(model.providerID ?? "").toLowerCase()
  const mid = String(model.id ?? "").toLowerCase()
  const name = String((model as { name?: unknown }).name ?? "").toLowerCase()
  if (name.includes("router")) return true
  if (mid.includes("router")) return true
  if (mid.includes("switchyard")) return true
  const base = mid.split("/").pop() ?? mid
  if (base === "auto" || base === "auto-beta") return true
  if (pid === "openrouter") {
    if (base === "free" || base === "fusion" || base === "pareto-code") return true
    if (mid === "openrouter/auto" || mid === "openrouter/auto-beta" || mid === "openrouter/free" || mid === "openrouter/fusion" || mid === "openrouter/pareto-code") return true
  }
  if (base === "switchyard" || base === "fusion" || base === "pareto-code" || base === "jev-router") return true
  return false
}

/**
 * 2026-10-20: an EMPTY completion is a FAILURE, not an empty answer.
 *
 * Measured on the free tier (`minimax/minimax-m3.1-flash:free`, one prompt): `max_tokens` 1500
 * -> empty, 6000 -> empty, 20000 -> the full answer, while a 26-char control answered at
 * `max_tokens` 50. The request SUCCEEDS in that case - a reasoning model spends the budget on
 * reasoning tokens and the answer never reaches the text - so the tool printed its envelope
 * and nothing else, which reads exactly like a refusal and gets recorded as "the model
 * declined". Same doctrine as the rejection path below: a tool that cannot say why it failed
 * cannot be repaired.
 */
export function isEmptyCompletion(text: string | undefined): boolean {
  return !text?.trim()
}

export function emptyCompletionReport(model: Pick<Provider.Model, "providerID" | "id">, envelope: string) {
  return {
    title: `aicall FAILED (empty completion): ${model.providerID}/${model.id}`,
    metadata: {
      model: { providerID: model.providerID, modelID: model.id },
    },
    output: `${envelope}\n\nAICALL FAILED (empty completion): the request SUCCEEDED and the model returned no text. This is not a provider refusal - the usual cause is a reasoning model whose token budget (max_tokens) was consumed before the answer reached the text. Raise max_tokens and re-run: the same prompt answered at 20000 where it was empty at 6000. Nothing was written.`,
  }
}

export function requestEnvelope(
  model: Pick<Provider.Model, "providerID" | "id" | "api" | "parameters" | "model_type" | "cost" | "limit"> & { name?: string },
  userText: string,
) {
  const router = isRouterModel(model)
  const paid = (model.cost?.input ?? 0) > 0 || (model.cost?.output ?? 0) > 0
  const costLine = router
    ? "cost: UNKNOWN (router)"
    : paid
      ? `cost: $${model.cost?.input}/$${model.cost?.output} per Mtok`
      : "cost: free"
  return [
    "Direct AI call request:",
    `provider: ${model.providerID}`,
    `model: ${model.id}`,
    `api model: ${model.api.id}`,
    `sdk: ${model.api.npm ?? "built-in"}`,
    `endpoint: ${model.api.url ?? "provider default"}`,
    `type: ${model.model_type ?? "chat"}`,
    `parameters: ${model.parameters ? `${model.parameters}B` : "unknown"}`,
    costLine,
    `context: ${model.limit?.context ?? "unknown"} tokens`,
    "system: none (isolated aicall)",
    "tools: none (isolated aicall)",
    `user context: ${userText.length} chars`,
  ].join("\n")
}

const codeExts = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt", ".scala",
  ".rb", ".php", ".sh", ".bash", ".zsh", ".sql", ".r", ".jl",
])

export const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({ description: "The instructions or prompt to send to the LLM" }),
  files: Schema.optional(
    Schema.Array(Schema.String),
  ).annotate({ description: "File paths to read and include as context before the prompt" }),
  output_file: Schema.optional(Schema.String).annotate({
    description: "Save the response to this file instead of returning inline",
  }),
  model: Schema.optional(Schema.String).annotate({ description: "Model override. Uses session default if omitted" }),
  provider: Schema.optional(Schema.String).annotate({
    description: "Provider override. Uses session default if omitted",
  }),
  temperature: Schema.optional(Schema.Number).annotate({
    description: "Sampling temperature (0-2). Lower is more deterministic",
  }),
  top_p: Schema.optional(Schema.Number).annotate({ description: "Nucleus sampling mass (0-1)" }),
  top_k: Schema.optional(Schema.Number).annotate({ description: "Top-K sampling" }),
  max_tokens: Schema.optional(Schema.Number).annotate({ description: "Maximum output tokens" }),
  seed: Schema.optional(Schema.Number).annotate({ description: "Seed for (mostly) deterministic sampling" }),
  allow_paid: Schema.optional(Schema.Boolean).annotate({
    description: "Accept a routed-model charge. Routers (openrouter/auto, auto-beta) bill the routed model — without allow_paid:true such a call is REFUSED",
  }),
})

type Metadata = {
  model: { providerID: string; modelID: string }
}

export const AiCallTool = Tool.define(
  id,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context

          // Permission check
          yield* ctx.ask({
            permission: id,
            patterns: [params.prompt],
            always: ["*"],
            metadata: {
              files: params.files ?? [],
              output_file: params.output_file,
            },
          })

          // Resolve model (t72): explicit model/provider, else the caller's
          // session chain first UP (t68, resolveChainAgentModel). Routers bill
          // the routed model, so a router without allow_paid is REFUSED, never
          // run as "free". An omitted model with no chain is REFUSED, never a
          // silent free/default/router fallback.
          const allowPaid = params.allow_paid === true
          // t87: ONE lookup of ONE key (L4 `globalRecents`) — every call that spends tokens obeys the list.
          const aicallRecents = yield* Effect.tryPromise({
            try: () => readGlobalRecents(),
            catch: () => undefined,
          }).pipe(Effect.catch(() => Effect.succeed(undefined)))
          let model: Provider.Model | undefined
          if (params.model || params.provider) {
            const defaultModel = yield* provider.defaultModel()
            const rawProviderID = params.provider ?? defaultModel.providerID
            const providerID = ProviderID.make(rawProviderID)
            const modelID = ModelID.make(params.model ?? defaultModel.modelID)
            const resolved = yield* provider.getModel(providerID, modelID)
            // t87 decision 1: an explicit model/provider outside the list is REFUSED, with reason + list named.
            if (
              aicallRecents !== undefined &&
              !isListMember({ providerID: resolved.providerID, modelID: resolved.id }, aicallRecents)
            ) {
              log.warn("bug: aicall model not in global recents", {
                agent: canonicalIdentity(ctx.agent),
                model: `${resolved.providerID}/${resolved.id}`,
              })
              const refusedEnvelope = requestEnvelope(resolved, params.prompt)
              return {
                title: `aicall REFUSED (not in global recents): ${resolved.providerID}/${resolved.id}`,
                metadata: {
                  model: { providerID: resolved.providerID, modelID: resolved.id },
                },
                output: `${refusedEnvelope}\n\nREFUSED: ${resolved.providerID}/${resolved.id} is outside the owner's global recents list [${aicallRecents.join(", ")}]. Pass a list member explicitly or ask the owner to extend the list in the TUI.`
              }
            }
            if (isRouterModel(resolved) && !allowPaid) {
              const envelope = requestEnvelope(resolved, params.prompt)
              return {
                title: `aicall REFUSED (router): ${resolved.providerID}/${resolved.id}`,
                metadata: {
                  model: { providerID: resolved.providerID, modelID: resolved.id },
                },
                output: `${envelope}\n\nREFUSED: router ${resolved.providerID}/${resolved.id} bills the routed model (price UNKNOWN, not free). Re-call with allow_paid:true to accept the routed-model charge, or pass a free non-router model explicitly.`,
              }
            }
            model = resolved
          } else {
            const agent = canonicalIdentity(ctx.agent)
            const chain = loadChain(`session:${ctx.sessionID}`, agent)
            const member = resolveChainAgentModel(agent, String(ctx.sessionID), chainHealthState(), {
              chain,
              globalRecents: aicallRecents,
            })
            if (!member) {
              return {
                title: `aicall REFUSED (no model): ${agent}`,
                metadata: {
                  model: { providerID: "", modelID: "" },
                },
                output: `aicall REFUSED: no model given and no UP chain member for agent "${agent}" in session "${ctx.sessionID}". Pass model explicitly (a free non-router id) or set the session chain first; an omitted model never silently falls to a router or default.`,
              }
            }
            const resolved = yield* provider.getModel(
              ProviderID.make(member.providerID),
              ModelID.make(member.modelID),
            )
            if (isRouterModel(resolved) && !allowPaid) {
              const envelope = requestEnvelope(resolved, params.prompt)
              return {
                title: `aicall REFUSED (router): ${resolved.providerID}/${resolved.id}`,
                metadata: {
                  model: { providerID: resolved.providerID, modelID: resolved.id },
                },
                output: `${envelope}\n\nREFUSED: chain member ${resolved.providerID}/${resolved.id} is a router (price UNKNOWN, not free). Re-call with allow_paid:true to accept the routed-model charge, or pick a free non-router chain member.`,
              }
            }
            model = resolved
          }
          if (!model) {
            return {
              title: `aicall REFUSED (no model): ${canonicalIdentity(ctx.agent)}`,
              metadata: {
                model: { providerID: "", modelID: "" },
              },
              output: `aicall REFUSED: model resolution left no model; pass model explicitly (a free non-router id).`,
            }
          }

          // Build user message: file contents (if any) + prompt
          let userText = ""
          if (params.files) {
            for (const filepath of params.files) {
              const resolved = path.isAbsolute(filepath)
                ? filepath
                : path.join(ins.directory, filepath)
              try {
                const content = yield* fs.readFileString(resolved)
                userText += `\n\n--- BEGIN FILE: ${filepath} ---\n${content}\n--- END FILE: ${filepath} ---`
              } catch (e) {
                log.debug("file read failed for aicall", { filepath, error: e })
                userText += `\n\n--- FILE NOT FOUND: ${filepath} ---`
              }
            }
          }
          userText += `\n\n${params.prompt}`

          // Direct LLM call — no session, no system prompt, no tools.
          // This is a prose-only, isolated cognition accelerator.
          const envelope = requestEnvelope(model, userText)
          // 2026-09-29: resolution failure surfaces the same way a request failure does. `getModel`
          // above throws ProviderModelNotFoundError on its own, but `getLanguage` can fail for a model
          // the registry lists with a status the provider layer rejects — the catalog shows
          // nemotron-3-ultra-free as "pending" — and that path had the same opaque shape. The cause is
          // not carried here (orElseSucceed drops it), so the output names the SITE and the log is the
          // next instrument; a message that says where is worth more than one that says "error".
          const language = yield* provider.getLanguage(model).pipe(Effect.orElseSucceed(() => undefined))
          if (!language) {
            return {
              title: `aicall FAILED (language model): ${model.providerID}/${model.id}`,
              metadata: {
                model: { providerID: model.providerID, modelID: model.id },
              },
              output: `${envelope}\n\nAICALL FAILED (language model): provider.getLanguage returned no model for ${model.providerID}/${model.id}; the cause was not carried by this path — read the provider log and the registry entry.`,
            }
          }
          // 2026-09-29: the call reports ITS OWN failure. A rejected provider request used to fall
          // into the enclosing Effect and surface as the generic "An error occurred in
          // Effect.tryPromise" — which is how a model that WORKS (nemotron-3-ultra-free, verified
          // from the TUI by the owner) looked like a dead one from inside the tool: no provider,
          // no model, no message. A tool that cannot say why it failed cannot be repaired, so a
          // rejection is now an OUTPUT of the tool rather than a defect.
          const attempted = yield* Effect.tryPromise(() =>
            generateText({
              model: language,
              messages: [{ role: "user", content: userText }],
              ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
              ...(params.top_p !== undefined ? { topP: params.top_p } : {}),
              ...(params.top_k !== undefined ? { topK: params.top_k } : {}),
              ...(params.max_tokens !== undefined ? { maxOutputTokens: params.max_tokens } : {}),
              ...(params.seed !== undefined ? { seed: params.seed } : {}),
            }).then(
              (value) => ({ ok: true as const, value }),
              (error: unknown) => ({
                ok: false as const,
                message: error instanceof Error ? error.message : String(error),
              }),
            ),
          )

          if (!attempted.ok) {
            return {
              title: `aicall FAILED: ${model.providerID}/${model.id}`,
              metadata: {
                model: { providerID: model.providerID, modelID: model.id },
              },
              output: `${envelope}\n\nAICALL FAILED: ${attempted.message}`,
            }
          }

          const output = attempted.value.text

          // 2026-10-20: an empty completion is a failure, not an empty answer - and it must
          // not reach output_file, which would overwrite the target with nothing.
          if (isEmptyCompletion(output)) {
            return emptyCompletionReport(model, envelope)
          }

          // Optionally save to file
          if (params.output_file) {
            const outPath = path.isAbsolute(params.output_file)
              ? params.output_file
              : path.join(ins.directory, params.output_file)

            // Guard: if output_file looks like source code but content
            // is markdown (model returned summary instead of code), reject.
            const ext = path.extname(params.output_file).toLowerCase()
            if (codeExts.has(ext)) {
              const stripped = output.trimStart()
              // Check for a single code fence wrapping the entire output first
              // (model often wraps generated code in ```lang ... ```).
              // Must check BEFORE markdown detection: a leading ``` triggers
              // the markdown regex, which would reject valid fenced code.
              const fenceMatch = stripped.match(/^```[\w]*\n([\s\S]*?)\n```\s*$/)
              const content = fenceMatch ? fenceMatch[1] : stripped
              // Narrow heading match to ##+ (level 2+) to avoid false-positiving
              // on Python/Ruby/Shell comments starting with "# " (level-1 heading).
              const looksLikeMarkdown =
                /^(?:#{2,6}\s|```|[*-]\s|>\s|\d+\.\s|\[.+\]\(.+\))/.test(content.trimStart()) ||
                /^(?:The\s+refactoring\s+is\s+complete|Here(?:'s|\s+is)\s+(?:a\s+)?summary|##\s+Summary)/i.test(content.trimStart())
              if (looksLikeMarkdown) {
                return {
                  title: `aicall → ${params.output_file} REJECTED`,
                  metadata: {
                    model: { providerID: model.providerID, modelID: model.id },
                  },
                  output: `${envelope}\n\nREJECTED: output_file "${params.output_file}" has a code extension but the model returned markdown/prose instead of source code. The file was NOT overwritten. First 200 chars of rejected output:\n${output.slice(0, 200)}`,
                }
              }
              if (fenceMatch) {
                yield* fs.writeWithDirs(outPath, content)
                return {
                  title: `aicall → ${params.output_file}`,
                  metadata: {
                    model: { providerID: model.providerID, modelID: model.id },
                  },
                  output: `${envelope}\n\nResponse saved to ${params.output_file} (${content.length} chars, code fence stripped)`,
                }
              }
            }

            yield* fs.writeWithDirs(outPath, output)
            return {
              title: `aicall → ${params.output_file}`,
              metadata: {
                model: { providerID: model.providerID, modelID: model.id },
              },
              output: `${envelope}\n\nResponse saved to ${params.output_file} (${output.length} chars)`,
            }
          }

          return {
            title: `aicall: ${params.prompt.slice(0, 40)}${params.prompt.length > 40 ? "..." : ""}`,
            metadata: {
              model: { providerID: model.providerID, modelID: model.id },
            },
            output: `${envelope}\n\n${output}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
