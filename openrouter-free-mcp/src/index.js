#!/usr/bin/env node
// openrouter-free-mcp — MCP server exposing isolated, bounded LLM calls
// routed to free-tier OpenRouter models by default (aicall-style
// "cognition accelerator": one prompt in, one answer out, no tools,
// no repo discovery, no working-tree authority).
//
// Tools:
//   list_free_models — list currently free (cost 0/0) OpenRouter models
//   call_model       — send a prompt (+ optional files) to a model;
//                      auto-selects the largest-context free model unless
//                      an explicit model is given and allow_paid is set.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_LIST_TTL_MS = 10 * 60 * 1000; // 10 minutes

const CODE_EXTS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt", ".scala",
  ".rb", ".php", ".sh", ".bash", ".zsh", ".sql", ".r", ".jl",
]);

let modelCache = { at: 0, models: [] };

function isFree(m) {
  const p = m.pricing || {};
  return p.prompt === "0" && p.completion === "0";
}

// Text-only output: excludes audio/image-generation models (e.g. Lyria)
// that are priced free and report a huge context window but return song
// lyrics / binary media instead of following a chat instruction — live
// discovered 2026-09-10 via google/lyria-3-pro-preview.
function isTextGeneration(m) {
  const out = m.architecture?.output_modalities;
  return Array.isArray(out) && out.length === 1 && out[0] === "text";
}

// Group order for the free-model listing: text-output models first (what
// call_model can actually use today), then other modalities. Mirrors
// opencode's own `capability` tool (list_all / modality lookup), which
// surfaces every model's modality rather than hiding non-text ones.
const MODALITY_GROUP_ORDER = ["text", "text+image", "image", "audio", "video"];

function outputModalityLabel(m) {
  const out = m.architecture?.output_modalities;
  return Array.isArray(out) && out.length ? out.join("+") : "text";
}

function modalityGroupKey(label) {
  const idx = MODALITY_GROUP_ORDER.indexOf(label);
  return idx === -1 ? MODALITY_GROUP_ORDER.length : idx;
}

// ALL free models (any modality), sorted by output-modality group first
// (text-output first — that's what call_model's auto-select can use),
// then by context window size within each group. Unlike pickFreeModels(),
// this does not hide image/audio-output models — it labels them instead,
// same spirit as opencode's `capability` tool listing every model's
// modality rather than filtering it away.
function listFreeModels(models, { minContext = 0 } = {}) {
  return models
    .filter(isFree)
    .filter((m) => (m.context_length ?? 0) >= minContext)
    .map((m) => ({ model: m, modality: outputModalityLabel(m) }))
    .sort((a, b) => {
      const ga = modalityGroupKey(a.modality);
      const gb = modalityGroupKey(b.modality);
      if (ga !== gb) return ga - gb;
      return (b.model.context_length ?? 0) - (a.model.context_length ?? 0);
    });
}

async function fetchModels({ force = false } = {}) {
  const fresh = !force && Date.now() - modelCache.at < MODEL_LIST_TTL_MS && modelCache.models.length > 0;
  if (fresh) return modelCache.models;

  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter /models failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  const models = Array.isArray(body?.data) ? body.data : [];
  modelCache = { at: Date.now(), models };
  return models;
}

function pickFreeModels(models, { minContext = 0 } = {}) {
  return models
    .filter(isFree)
    .filter(isTextGeneration)
    .filter((m) => (m.context_length ?? 0) >= minContext)
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0));
}

function findModel(models, id) {
  return models.find((m) => m.id === id);
}

function requestEnvelope({ modelId, modelInfo, promptChars, filesIncluded }) {
  const free = modelInfo ? isFree(modelInfo) : /:free$/.test(modelId);
  const context = modelInfo?.context_length ?? "unknown";
  const lines = [
    "openrouter-free-mcp direct call:",
    `model: ${modelId}`,
    `cost: ${free ? "free" : "PAID — confirm this was intentional"}`,
    `context: ${context} tokens`,
    `files attached: ${filesIncluded}`,
    `prompt+context size: ${promptChars} chars`,
    "system: isolated call — no repo tools, no working-tree authority",
  ];
  return lines.join("\n");
}

async function readAttachedFiles(files) {
  if (!files || files.length === 0) return "";
  let out = "";
  for (const filepath of files) {
    const resolved = path.resolve(filepath);
    try {
      const content = await readFile(resolved, "utf8");
      out += `\n\n--- BEGIN FILE: ${filepath} ---\n${content}\n--- END FILE: ${filepath} ---`;
    } catch (e) {
      out += `\n\n--- FILE NOT FOUND: ${filepath} (${e.message}) ---`;
    }
  }
  return out;
}

async function callOpenRouter({ apiKey, model, messages, sampling }) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_APP_NAME) headers["X-Title"] = process.env.OPENROUTER_APP_NAME;

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, ...sampling }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`OpenRouter returned non-JSON (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const msg = body?.error?.message || text.slice(0, 500);
    throw new Error(`OpenRouter chat completion failed (${res.status}): ${msg}`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`Unexpected OpenRouter response shape: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return { content, usage: body?.usage };
}

function looksLikeMarkdownInsteadOfCode(text) {
  const stripped = text.trimStart();
  const fenceMatch = stripped.match(/^```[\w]*\n([\s\S]*?)\n```\s*$/);
  const content = fenceMatch ? fenceMatch[1] : stripped;
  const looksLikeMarkdown =
    /^(?:#{2,6}\s|```|[*-]\s|>\s|\d+\.\s|\[.+\]\(.+\))/.test(content.trimStart()) ||
    /^(?:Here(?:'s|\s+is)\s+(?:a\s+)?summary|##\s+Summary)/i.test(content.trimStart());
  return { fenceMatch, content, looksLikeMarkdown };
}

const server = new McpServer({ name: "openrouter-free-mcp", version: "1.0.0" });

server.tool(
  "list_free_models",
  "List every OpenRouter model that currently costs 0/0 (free tier), grouped by output modality (text first — that's what call_model's auto-select can use; then text+image, image, audio, video) and sorted by context window size within each group. Non-text-output models are shown, not hidden — pick one explicitly via call_model's `model` param if you actually want that modality (e.g. music/lyrics generation). Cached for 10 minutes; pass refresh:true to bypass the cache.",
  {
    min_context: z.number().optional().describe("Only include models with at least this many tokens of context"),
    refresh: z.boolean().optional().describe("Bypass the 10-minute cache and refetch from OpenRouter"),
  },
  async ({ min_context, refresh }) => {
    const models = await fetchModels({ force: !!refresh });
    const free = listFreeModels(models, { minContext: min_context ?? 0 });

    if (free.length === 0) {
      return {
        content: [{ type: "text", text: "No free models found (or OpenRouter's free-tier list is currently empty)." }],
      };
    }

    const idWidth = Math.max(...free.map((r) => r.model.id.length), 8);
    const modWidth = Math.max(...free.map((r) => r.modality.length), 8);
    const rows = [];
    let lastGroup = null;
    for (const { model, modality } of free) {
      const group = modalityGroupKey(modality);
      if (group !== lastGroup) {
        rows.push(`-- ${modality} ${modality === "text" ? "(usable by call_model auto-select)" : "(pass model: explicitly to use)"} --`);
        lastGroup = group;
      }
      const ctx = model.context_length ?? "?";
      rows.push(`  ${model.id.padEnd(idWidth)}  [${modality.padEnd(modWidth)}]  ctx:${ctx}  — ${model.name}`);
    }

    return { content: [{ type: "text", text: rows.join("\n") }] };
  },
);

server.tool(
  "call_model",
  [
    "Isolated LLM call — one prompt in, one answer out. No tools, no repo discovery, no file",
    "writes unless output_file is given. Not a subagent: use it for bounded work you can fully",
    "specify up front (refactor a pasted/attached file, draft plan text, summarize, propose a diff),",
    "never for multi-step work that needs tool results between reasoning steps, and never as a",
    "substitute for a real test/build/oracle.",
    "",
    "Free-first by default: if `model` is omitted, auto-selects the free, text-output OpenRouter model",
    "(cost 0/0, excludes audio/image-generation models) with the largest context window, falling",
    "through to the next free candidate (up to 4 tries) if one refuses the call (some free models are",
    "restricted to agentic-harness callers only and 403 on a plain chat request). Passing an explicit",
    "`model` never falls back. A `model` that turns out to be paid requires allow_paid:true, or the",
    "call is refused before it can spend money.",
  ].join("\n"),
  {
    prompt: z.string().describe("The instructions/question to send to the model"),
    files: z.array(z.string()).optional().describe("File paths to read and embed as context before the prompt"),
    system: z.string().optional().describe("Optional system prompt (omit for a fully isolated call, like aicall)"),
    model: z.string().optional().describe("Explicit OpenRouter model id, e.g. 'meta-llama/llama-3.3-70b-instruct:free'. Omit for free-first auto-select"),
    allow_paid: z.boolean().optional().describe("Must be true to use a model that isn't free — safety default is false"),
    output_file: z.string().optional().describe("Save the response to this path instead of returning it inline"),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().optional(),
    presence_penalty: z.number().optional(),
    frequency_penalty: z.number().optional(),
    seed: z.number().optional(),
  },
  async (params) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return {
        isError: true,
        content: [{ type: "text", text: "OPENROUTER_API_KEY is not set in the MCP server's environment. Add it to .mcp.json's env block or the shell that launches this server." }],
      };
    }

    const models = await fetchModels().catch((e) => {
      throw new Error(`Could not fetch OpenRouter model list (needed for free/paid classification): ${e.message}`);
    });

    let modelId = params.model;
    let modelInfo;
    let autoCandidates = null;
    if (modelId) {
      modelInfo = findModel(models, modelId);
      const free = modelInfo ? isFree(modelInfo) : /:free$/.test(modelId);
      if (!free && !params.allow_paid) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Refused: model "${modelId}" is not a known free-tier model and allow_paid was not set to true. ` +
              `Call list_free_models to see current free options, or pass allow_paid:true if a paid model is genuinely intended.`,
          }],
        };
      }
    } else {
      autoCandidates = pickFreeModels(models);
      if (autoCandidates.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: "No free-tier model currently available on OpenRouter, and no explicit model was given." }],
        };
      }
      modelInfo = autoCandidates[0];
      modelId = modelInfo.id;
    }

    const filesText = await readAttachedFiles(params.files);
    const userText = `${filesText}\n\n${params.prompt}`.trim();

    const messages = [];
    if (params.system) messages.push({ role: "system", content: params.system });
    messages.push({ role: "user", content: userText });

    const sampling = {};
    for (const k of ["temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty", "seed"]) {
      if (params[k] !== undefined) sampling[k] = params[k];
    }

    // Auto-selected free models: some free-tier models reject direct API
    // calls (e.g. "only available on agentic harnesses", 403) despite being
    // priced 0/0 — live-observed 2026-09-10 with thinkingmachines/inkling.
    // Fall through the sorted free candidates instead of failing on the
    // first (largest-context) one; an explicit model:param never falls back.
    const MAX_AUTO_ATTEMPTS = 4;
    let output;
    if (autoCandidates) {
      const failures = [];
      let attempts = 0;
      for (const candidate of autoCandidates) {
        if (attempts >= MAX_AUTO_ATTEMPTS) break;
        attempts++;
        modelInfo = candidate;
        modelId = candidate.id;
        try {
          output = (await callOpenRouter({ apiKey, model: modelId, messages, sampling })).content;
          break;
        } catch (e) {
          failures.push(`${modelId}: ${e.message}`);
          output = undefined;
        }
      }
      if (output === undefined) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `All ${attempts} auto-selected free models failed:\n${failures.join("\n")}\n\n` +
              `Call list_free_models and pass an explicit model, or retry.`,
          }],
        };
      }
    } else {
      output = (await callOpenRouter({ apiKey, model: modelId, messages, sampling })).content;
    }
    const envelope = requestEnvelope({
      modelId,
      modelInfo,
      promptChars: userText.length,
      filesIncluded: params.files?.length ?? 0,
    });

    if (params.output_file) {
      const outPath = path.resolve(params.output_file);
      const ext = path.extname(params.output_file).toLowerCase();
      if (CODE_EXTS.has(ext)) {
        const { fenceMatch, content, looksLikeMarkdown } = looksLikeMarkdownInsteadOfCode(output);
        if (looksLikeMarkdown) {
          return {
            content: [{
              type: "text",
              text: `${envelope}\n\nREJECTED: output_file "${params.output_file}" has a code extension but the model returned markdown/prose. File was NOT written. First 200 chars:\n${output.slice(0, 200)}`,
            }],
          };
        }
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, fenceMatch ? content : output, "utf8");
        return {
          content: [{ type: "text", text: `${envelope}\n\nSaved to ${params.output_file} (${(fenceMatch ? content : output).length} chars${fenceMatch ? ", code fence stripped" : ""})` }],
        };
      }
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, output, "utf8");
      return {
        content: [{ type: "text", text: `${envelope}\n\nSaved to ${params.output_file} (${output.length} chars)` }],
      };
    }

    return {
      content: [{ type: "text", text: `${envelope}\n\n${output}` }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
