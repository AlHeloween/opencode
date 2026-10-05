import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { Agent } from "@/agent/agent"
import { ModelID, ProviderID } from "@/provider/schema"
import { SessionID } from "../../src/session/schema"
import { toJsonSchema } from "@/util/effect-zod"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

/**
 * Description integrity — a check for a CLASS, not a fourth pass over instances.
 *
 * Measured 2026-10-05: tool descriptions and the model prompts had drifted from the code they
 * describe. `cmd.txt` recommended `type` (blocked by our own constitution); `bash.txt` hard-coded
 * truncation limits the renderer reads from config; `dbread.txt`, `logsearch.txt` and `fossilgrep.txt`
 * printed their opening lines twice; `recall.txt` taught a retired name in its `reason` example;
 * eleven tools' descriptions never named a parameter their schema declared; a phantom id
 * (`reasoninginenter`) sat in the normalizer's allowlist and fed bogus retry cycles («бредоциклы»).
 * Three manual passes had already been run — @KAIZEN forbids a fourth, so the countermeasure is a
 * check, not another caution.
 *
 * Two halves:
 *   • STATIC (no Instance): a RETIRED NAME and a DUPLICATED PROSE LINE cannot ship.
 *   • LIVE (registry): every parameter a tool declares must be NAMED in that tool's description —
 *     a description that never names a parameter is how one gets silently added to the schema and
 *     missed by every reader of the description.
 * A wrong DEFAULT (bash limits vs config) is a separate, lower-fidelity class and is NOT claimed
 * here — an unproven criterion is a residual, not a rounding error.
 */
const RETIRED_TOOL_IDS = ["applypatch", "multiedit"]
const MIN_DESCRIPTION_CHARS = 20
const DUPLICATE_LINE_MIN_CHARS = 20
/// Floor for the live half's control: the catalogue carries far more than this many parameters.
const MIN_PARAMETERS_CHECKED = 30
/// The synthetic tool the runtime calls for a malformed call — the model must never author it.
const SYNTHETIC_DESCRIPTION = "Do not use"

const srcToolDir = path.join(import.meta.dir, "../../src/tool")
const promptDir = path.join(import.meta.dir, "../../src/session/prompt")

// The live half needs the same service layer the registry tests use.
const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer))

async function descriptionFiles() {
  const names = (await fs.readdir(srcToolDir)).filter((name) => name.endsWith(".txt")).sort()
  return Promise.all(
    names.map(async (name) => ({
      name,
      path: path.join(srcToolDir, name),
      text: await fs.readFile(path.join(srcToolDir, name), "utf8"),
    })),
  )
}

function wholeWord(text: string, needle: string) {
  return new RegExp(`\\b${needle}\\b`).test(text)
}

describe("tool description integrity (static)", () => {
  test("the scan finds the corpus (control that MUST match)", async () => {
    // A control: an empty or mis-pathed scan must fail HERE, not pass as «no offenders».
    const files = await descriptionFiles()
    expect(files.length).toBeGreaterThan(20)
  })

  test("every description file is non-trivial", async () => {
    const offenders = (await descriptionFiles())
      .filter((file) => file.text.trim().length < MIN_DESCRIPTION_CHARS)
      .map((file) => file.name)
    expect(offenders).toEqual([])
  })

  test("no description or hand-maintained model prompt names a retired tool", async () => {
    const prompts = ["gpt.txt", "codex.txt"].map((name) => path.join(promptDir, name))
    const targets = [...(await descriptionFiles()).map((file) => file.path), ...prompts]
    const offenders: string[] = []
    for (const target of targets) {
      const text = await fs.readFile(target, "utf8")
      for (const retired of RETIRED_TOOL_IDS) {
        if (wholeWord(text, retired)) offenders.push(`${path.basename(target)} names retired tool \`${retired}\``)
      }
    }
    expect(offenders).toEqual([])
  })

  test("no description repeats a prose line verbatim", async () => {
    const offenders: string[] = []
    for (const file of await descriptionFiles()) {
      const lines = file.text.split(/\r?\n/).map((line) => line.trim())
      // Compare against EVERY previous line, not only the one before: the measured defect was a
      // BLOCK repeated (fossilgrep.txt lines 1-3 copied to 4-6), which a consecutive-only check misses.
      const firstSeen = new Map<string, number>()
      lines.forEach((line, index) => {
        if (line.length < DUPLICATE_LINE_MIN_CHARS) return
        const first = firstSeen.get(line)
        if (first !== undefined) offenders.push(`${file.name}: line ${index + 1} duplicates line ${first}`)
        else firstSeen.set(line, index + 1)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe("tool description integrity (parameters named)", () => {
  it.live(
    "every declared parameter is named in its tool's description",
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const agents = yield* Agent.Service
          const build = yield* agents.get("build")
          expect(build).toBeDefined()
          const base = {
            providerID: ProviderID.make("test"),
            modelID: ModelID.make("test-model"),
            agent: build!,
          }
          const tools = yield* registry.tools({ ...base, sessionID: SessionID.descending() })
          // Control: the enumeration must actually yield a catalogue, or «no offenders» is silence.
          expect(tools.length).toBeGreaterThan(20)
          const offenders: string[] = []
          let checked = 0
          for (const tool of tools) {
            // The synthetic tool must never be authored by the model, and its own description says
            // exactly that — so the exemption FOLLOWS FROM THE DESCRIPTION, not from a name list
            // that would grow silently. A parameter one must not pass needs no advertising.
            if (tool.description.trim() === SYNTHETIC_DESCRIPTION) continue
            // The registry hands back the Effect Schema itself, so convert it the same way the prompt
            // assembly does — reading `.properties` off the raw Schema yields nothing (measured).
            const json = toJsonSchema(tool.parameters as Schema.Top) as { properties?: Record<string, unknown> }
            for (const key of Object.keys(json.properties ?? {})) {
              checked++
              if (!tool.description.includes(key)) offenders.push(`${tool.id}: parameter \`${key}\` is not named in its description`)
            }
          }
          // Control: a conversion that produced nothing would make the loop above vacuous and this
          // pass a silence. The catalogue must contribute real parameters or the check has no subject.
          expect(checked).toBeGreaterThan(MIN_PARAMETERS_CHECKED)
          expect(offenders).toEqual([])
        }),
      ),
    20_000,
  )
})
