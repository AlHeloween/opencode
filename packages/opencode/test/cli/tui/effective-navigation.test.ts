import { describe, test, expect } from "bun:test"
import { EffectiveNavigation } from "@/cli/cmd/tui/util/effective-navigation"
import type { Config } from "@/config/config"
import path from "path"
import os from "os"

function makeConfig(overrides: Partial<Config.Info> = {}): Config.Info {
  return {
    $schema: "https://opencode.ai/config.json",
    ...overrides,
  }
}

describe("EffectiveNavigation.expandPath", () => {
  test("expands ~/ prefix", () => {
    const result = EffectiveNavigation.expandPath("~/projects")
    expect(result).toBe(os.homedir() + "/projects")
  })

  test("expands bare ~", () => {
    const result = EffectiveNavigation.expandPath("~")
    expect(result).toBe(os.homedir())
  })

  test("expands $HOME/ prefix", () => {
    const result = EffectiveNavigation.expandPath("$HOME/projects")
    expect(result).toBe(os.homedir() + "/projects")
  })

  test("passes through absolute paths", () => {
    const result = EffectiveNavigation.expandPath("/mnt/data")
    expect(result).toBe("/mnt/data")
  })
})

describe("EffectiveNavigation.collectNavigationRules", () => {
  test("collects allow rules from navigation config", () => {
    const config = makeConfig({
      navigation: { allow: ["~/projects", "/mnt/data"] },
    })
    const rules = EffectiveNavigation.collectNavigationRules(config, [])
    const allowRules = rules.filter((r) => r.source === "config-allow")
    expect(allowRules.length).toBe(2)
    expect(allowRules[0].action).toBe("allow")
    expect(allowRules[1].action).toBe("allow")
  })

  test("collects deny rules from navigation config", () => {
    const config = makeConfig({
      navigation: { deny: ["~/secrets"] },
    })
    const rules = EffectiveNavigation.collectNavigationRules(config, [])
    const denyRules = rules.filter((r) => r.source === "config-deny")
    expect(denyRules.length).toBe(1)
    expect(denyRules[0].action).toBe("deny")
    expect(denyRules[0].displayPath).toBe(path.resolve(os.homedir() + "/secrets") + "/")
  })

  test("collects auto-whitelisted globs", () => {
    const config = makeConfig({})
    const autoGlobs = ["/tmp/cache/*", "/var/skills/*"]
    const rules = EffectiveNavigation.collectNavigationRules(config, autoGlobs)
    const autoRules = rules.filter((r) => r.source === "auto")
    expect(autoRules.length).toBe(2)
    expect(autoRules[0].action).toBe("allow")
  })

  test("collects raw permission external_directory rules", () => {
    const config = makeConfig({
      permission: {
        external_directory: {
          "/home/user/shared/*": "allow",
          "/etc/*": "deny",
          "*": "ask",
        },
      },
    } as any)
    const rules = EffectiveNavigation.collectNavigationRules(config, [])
    const permRules = rules.filter((r) => r.source === "config-permission")
    // * is filtered out
    expect(permRules.length).toBe(2)
    expect(permRules.some((r) => r.pattern === "/home/user/shared/*" && r.action === "allow")).toBe(true)
    expect(permRules.some((r) => r.pattern === "/etc/*" && r.action === "deny")).toBe(true)
  })

  test("empty config returns auto rules only", () => {
    const config = makeConfig({})
    const autoGlobs = ["/auto/dir/*"]
    const rules = EffectiveNavigation.collectNavigationRules(config, autoGlobs)
    expect(rules.length).toBe(1)
    expect(rules[0].source).toBe("auto")
  })
})

describe("EffectiveNavigation.deduplicateRules", () => {
  test("keeps last occurrence of duplicate patterns", () => {
    const rules: EffectiveNavigation.EffectiveRule[] = [
      { pattern: "/dir/*", displayPath: "/dir/", action: "allow", source: "config-allow" },
      { pattern: "/dir/*", displayPath: "/dir/", action: "deny", source: "config-deny" },
    ]
    const deduped = EffectiveNavigation.deduplicateRules(rules)
    expect(deduped.length).toBe(1)
    expect(deduped[0].action).toBe("deny")
    expect(deduped[0].source).toBe("config-deny")
  })

  test("sorts by display path", () => {
    const rules: EffectiveNavigation.EffectiveRule[] = [
      { pattern: "/c/*", displayPath: "/c/", action: "allow", source: "config-allow" },
      { pattern: "/a/*", displayPath: "/a/", action: "allow", source: "config-allow" },
      { pattern: "/b/*", displayPath: "/b/", action: "allow", source: "config-allow" },
    ]
    const deduped = EffectiveNavigation.deduplicateRules(rules)
    expect(deduped.map((r) => r.displayPath)).toEqual(["/a/", "/b/", "/c/"])
  })
})
