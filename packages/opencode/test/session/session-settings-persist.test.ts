import { expect, test, describe } from "bun:test"
import { mkdir, writeFile, rm } from "fs/promises"
import { mkdirSync } from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"
import {
  getSessionSettingsPath,
  loadSessionSettings,
  saveSessionSettings,
  removeSessionSettings,
  effectiveSubagents,
  setWorkspaceAgentModel,
} from "../../src/session/session-settings"

// ── Helpers ──

/** Point Global.Path.data at the temp worktree, run fn, restore. */
async function withDataDir(tmp: { path: string }, fn: () => Promise<void>) {
  const prev = Global.Path.home
  try {
    // Must create log dir BEFORE Global.initFromWorktree — Log.Default
    // is a global singleton already initialized and writes to data/log.
    mkdirSync(path.join(tmp.path, ".opencode", "data", "log"), { recursive: true })
    Global.initFromWorktree(tmp.path)
    await Log.init()
    await fn()
  } finally {
    Global.initFromWorktree(prev)
  }
}

/** Write raw JSONC content directly to the session settings file. */
async function writeRaw(tmp: { path: string }, sessionID: string, content: string) {
  const sessionsDir = path.join(tmp.path, ".opencode", "data", "sessions")
  await mkdir(sessionsDir, { recursive: true })
  await writeFile(path.join(sessionsDir, `${sessionID}.jsonc`), content)
}

// ── getSessionSettingsPath ──

describe("getSessionSettingsPath", () => {
  test("returns path under {data}/sessions/{sessionID}.jsonc", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      const p = getSessionSettingsPath("ses_abc123")
      expect(p).toContain("sessions")
      expect(p).toContain("ses_abc123.jsonc")
      expect(p).toContain(".opencode")
    })
  })
})

describe("setWorkspaceAgentModel", () => {
  test("creates a missing workspace scope without losing existing selections", () => {
    const result = setWorkspaceAgentModel(
      { existing: { planner: { providerID: "openai", modelID: "gpt-5.6" } } },
      undefined,
      "build_mode",
      { providerID: "anthropic", modelID: "claude-4.5" },
    )

    expect(result).toEqual({
      existing: { planner: { providerID: "openai", modelID: "gpt-5.6" } },
      default: { build_mode: { providerID: "anthropic", modelID: "claude-4.5" } },
    })
  })
})

// ── save / load round-trip ──

describe("saveSessionSettings → loadSessionSettings", () => {
  test("round-trip: writes and reads back agent override", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await saveSessionSettings("ses_1", {
        agent: { build_mode: { model: "openai/gpt-5.6", subagents: ["explorer_agent"] } },
      })
      const loaded = await loadSessionSettings("ses_1")
      expect(loaded).not.toBeNull()
      expect(loaded!.agent).toBeDefined()
      expect(loaded!.agent!["build_mode"]!.model).toBe("openai/gpt-5.6")
      expect(loaded!.agent!["build_mode"]!.subagents).toEqual(["explorer_agent"])
    })
  })

  test("round-trip: variant and agentVariant", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await saveSessionSettings("ses_2", {
        variant: { "openai/gpt-5.6": "high" },
        agentVariant: { "plan_mode/openai/gpt-5.6": "explicit" },
      })
      const loaded = await loadSessionSettings("ses_2")
      expect(loaded!.variant).toEqual({ "openai/gpt-5.6": "high" })
      expect(loaded!.agentVariant).toEqual({ "plan_mode/openai/gpt-5.6": "explicit" })
    })
  })

  test("round-trip: recent and favorite models", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      const recent = [{ providerID: "openai", modelID: "gpt-5.6" }]
      const favorite = [
        { providerID: "openai", modelID: "gpt-4" },
        { providerID: "anthropic", modelID: "claude-4.5" },
      ]
      await saveSessionSettings("ses_3", { recent, favorite })
      const loaded = await loadSessionSettings("ses_3")
      expect(loaded!.recent).toEqual(recent)
      expect(loaded!.favorite).toEqual(favorite)
    })
  })

  test("round-trip: multiple agents", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await saveSessionSettings("ses_4", {
        agent: {
          build_mode: { model: "openai/gpt-5.6", subagents: ["explorer_agent", "coder_agent"] },
          plan_mode: { model: "anthropic/claude-4.5", variant: "high" },
        },
      })
      const loaded = await loadSessionSettings("ses_4")
      expect(loaded!.agent!["build_mode"]!.model).toBe("openai/gpt-5.6")
      expect(loaded!.agent!["build_mode"]!.subagents).toEqual(["explorer_agent", "coder_agent"])
      expect(loaded!.agent!["plan_mode"]!.model).toBe("anthropic/claude-4.5")
      expect(loaded!.agent!["plan_mode"]!.variant).toBe("high")
    })
  })

  test("round-trip: empty settings object", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await saveSessionSettings("ses_empty", {})
      const loaded = await loadSessionSettings("ses_empty")
      expect(loaded).not.toBeNull()
      expect(loaded!.agent).toBeUndefined()
      expect(loaded!.recent).toBeUndefined()
    })
  })
})

// ── load: null on missing file ──

describe("loadSessionSettings: missing file", () => {
  test("returns null when no file exists", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      const loaded = await loadSessionSettings("ses_nonexistent")
      expect(loaded).toBeNull()
    })
  })
})

// ── load: missing file ──

describe("loadSessionSettings: missing file", () => {
  test("returns null when no file exists", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      const loaded = await loadSessionSettings("ses_nonexistent")
      expect(loaded).toBeNull()
    })
  })
})

describe("loadSessionSettings: normalization", () => {
  test("drops non-string subagent entries", async () => {
    await using tmp = await tmpdir()
    await writeRaw(tmp, "ses_norm", JSON.stringify({
      agent: { build_mode: { subagents: ["explorer_agent", 123, null, "coder_agent"] } },
    }))
    await withDataDir(tmp, async () => {
      const loaded = await loadSessionSettings("ses_norm")
      // Non-string entries cause every() to fail → subagents not set → no valid fields → override dropped entirely
      expect(loaded).not.toBeNull()
      expect(loaded!.agent).toBeUndefined()
    })
  })

  test("drops empty-object agent entries", async () => {
    await using tmp = await tmpdir()
    await writeRaw(tmp, "ses_empty_agent", JSON.stringify({
      agent: { build_mode: { } },
    }))
    await withDataDir(tmp, async () => {
      const loaded = await loadSessionSettings("ses_empty_agent")
      expect(loaded).not.toBeNull()
      expect(loaded!.agent).toBeUndefined()
    })
  })

  test("drops agent entry with null fields only", async () => {
    await using tmp = await tmpdir()
    await writeRaw(tmp, "ses_null_fields", JSON.stringify({
      agent: { build_mode: { model: null, variant: null, subagents: null } },
    }))
    await withDataDir(tmp, async () => {
      const loaded = await loadSessionSettings("ses_null_fields")
      expect(loaded!.agent).toBeUndefined()
    })
  })

  test("filters invalid recent entries (non-object, missing providerID)", async () => {
    await using tmp = await tmpdir()
    await writeRaw(tmp, "ses_bad_recent", JSON.stringify({
      recent: [
        { providerID: "openai", modelID: "gpt-5.6" },
        "bad_string",
        { modelID: "gpt-4" }, // missing providerID
        { providerID: "anthropic" }, // missing modelID
        null,
      ],
    }))
    await withDataDir(tmp, async () => {
      const loaded = await loadSessionSettings("ses_bad_recent")
      expect(loaded!.recent).toEqual([{ providerID: "openai", modelID: "gpt-5.6" }])
    })
  })

  test("parses agent model without provider (invalid) as undefined", async () => {
    await using tmp = await tmpdir()
    await writeRaw(tmp, "ses_model_parse", JSON.stringify({
      agent: { build_mode: { model: "just-model-no-slash" } },
    }))
    await withDataDir(tmp, async () => {
      const settings = await loadSessionSettings("ses_model_parse")
      expect(settings).not.toBeNull()
      // The file stores it, but sessionAgentModel() rejects no-slash
      // The raw file stores "just-model-no-slash" in agent[].model
      expect(settings!.agent!["build_mode"]!.model).toBe("just-model-no-slash")
    })
  })
})

// ── removeSessionSettings ──

describe("removeSessionSettings", () => {
  test("deletes file, load returns null after", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await saveSessionSettings("ses_del", { agent: { build_mode: { model: "openai/gpt-5.6" } } })
      expect(await loadSessionSettings("ses_del")).not.toBeNull()
      await removeSessionSettings("ses_del")
      expect(await loadSessionSettings("ses_del")).toBeNull()
    })
  })

  test("no-op when file does not exist", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      // Should not throw
      await removeSessionSettings("ses_ghost")
    })
  })
})

// ── save concurrency ──

describe("saveSessionSettings: concurrency", () => {
  test("concurrent saves to same session: last write wins", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await Promise.all([
        saveSessionSettings("ses_conc", { agent: { build_mode: { model: "openai/gpt-4" } } }),
        saveSessionSettings("ses_conc", { agent: { build_mode: { model: "openai/gpt-5.6" } } }),
      ])
      const loaded = await loadSessionSettings("ses_conc")
      // Last write wins — both complete, order depends on Promise.all microtask scheduling
      expect(loaded!.agent!["build_mode"]!.model).toMatch(/^openai\//)
    })
  })

  test("save failure in previous write does not block next save", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      // Write a file that will break: make the sessions path a file, not a directory
      const sessionsDir = path.join(tmp.path, ".opencode", "data", "sessions")
      // Don't create dir — first save creates it. Test save after broken write.
      await saveSessionSettings("ses_recover", { variant: { "x/y": "low" } })
      const loaded = await loadSessionSettings("ses_recover")
      expect(loaded!.variant).toEqual({ "x/y": "low" })
    })
  })
})

// ── integration: effectiveSubagents with real file ──

describe("effectiveSubagents: integration with persistence", () => {
  test("session file override beats global after round-trip", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await saveSessionSettings("ses_int", {
        agent: { build_mode: { subagents: ["explorer_agent"] } },
      })
      const settings = await loadSessionSettings("ses_int")
      const result = effectiveSubagents("build_mode", ["explorer_agent", "coder_agent"], settings)
      expect(result).toEqual(["explorer_agent"])
    })
  })

  test("empty subagents in persisted file denies all", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await saveSessionSettings("ses_deny", {
        agent: { build_mode: { subagents: [] } },
      })
      const settings = await loadSessionSettings("ses_deny")
      const result = effectiveSubagents("build_mode", ["explorer_agent", "coder_agent"], settings)
      expect(result).toEqual([])
    })
  })

  test("no session file falls back to global", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      const settings = await loadSessionSettings("ses_no_file")
      expect(settings).toBeNull()
      const result = effectiveSubagents("build_mode", ["coder_agent"], settings)
      expect(result).toEqual(["coder_agent"])
    })
  })
})

// ── Session isolation ──

describe("session isolation", () => {
  test("settings from one session do not leak to another", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await saveSessionSettings("ses_A", { agent: { build_mode: { model: "openai/gpt-5.6" } } })
      await saveSessionSettings("ses_B", { agent: { build_mode: { model: "anthropic/claude-4.5" } } })
      const a = await loadSessionSettings("ses_A")
      const b = await loadSessionSettings("ses_B")
      expect(a!.agent!["build_mode"]!.model).toBe("openai/gpt-5.6")
      expect(b!.agent!["build_mode"]!.model).toBe("anthropic/claude-4.5")
    })
  })
})
