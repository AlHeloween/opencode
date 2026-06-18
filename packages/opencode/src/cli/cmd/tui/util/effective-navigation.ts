import os from "os"
import path from "path"
import type { Config } from "@/config/config"
import type { ConfigPermission } from "@/config/permission"

/** A single effective directory navigation rule with its provenance. */
export interface EffectiveRule {
  /** The glob pattern used for permission matching, e.g. "/home/user/projects/*" */
  pattern: string
  /** Human-readable display path, e.g. "/home/user/projects/" */
  displayPath: string
  /** "allow" or "deny" */
  action: ConfigPermission.Action
  /** Where this rule came from */
  source: "config-allow" | "config-deny" | "config-permission" | "auto"
}

/** Expand ~/ and $HOME/ prefixes in a path. */
export function expandPath(p: string): string {
  if (p.startsWith("~/")) return os.homedir() + p.slice(1)
  if (p === "~") return os.homedir()
  if (p.startsWith("$HOME/")) return os.homedir() + p.slice(5)
  if (p.startsWith("$HOME")) return os.homedir() + p.slice(5)
  return p
}

/** Derive a display path from a glob pattern by stripping the trailing `/*`. */
export function displayFromGlob(pattern: string): string {
  if (pattern.endsWith("/*")) return pattern.slice(0, -2) + "/"
  if (pattern.endsWith("*")) return pattern.slice(0, -1)
  return pattern
}

/**
 * Collect all effective external_directory rules from config and auto-whitelisted
 * sources. Rules are returned in evaluation order (first = lowest priority, last wins).
 * The caller can deduplicate by pattern to get the winning rule for each directory.
 */
export function collectNavigationRules(
  config: Config.Info,
  autoAllowedGlobs: string[],
): EffectiveRule[] {
  const rules: EffectiveRule[] = []

  // 1. navigation.deny — explicit user-configured denies
  for (const dir of config.navigation?.deny ?? []) {
    const resolved = path.resolve(expandPath(dir))
    const pattern = path.join(resolved, "*")
    rules.push({ pattern, displayPath: resolved + "/", action: "deny", source: "config-deny" })
  }

  // 2. navigation.allow — explicit user-configured allows
  for (const dir of config.navigation?.allow ?? []) {
    const resolved = path.resolve(expandPath(dir))
    const pattern = path.join(resolved, "*")
    rules.push({ pattern, displayPath: resolved + "/", action: "allow", source: "config-allow" })
  }

  // 3. Raw permission.external_directory rules
  const extDir = config.permission?.external_directory
  if (extDir && typeof extDir !== "string") {
    for (const [rawPattern, action] of Object.entries(extDir)) {
      if (rawPattern !== "*") {
        rules.push({
          pattern: rawPattern,
          displayPath: displayFromGlob(rawPattern),
          action,
          source: "config-permission",
        })
      }
    }
  }

  // 4. Auto-whitelisted directories (truncation, skills, etc.)
  for (const glob of autoAllowedGlobs) {
    rules.push({ pattern: glob, displayPath: displayFromGlob(glob), action: "allow", source: "auto" })
  }

  return rules
}

/**
 * Deduplicate rules by pattern, keeping only the last occurrence (highest priority).
 * Returns rules sorted by display path for readable output.
 */
export function deduplicateRules(rules: EffectiveRule[]): EffectiveRule[] {
  const seen = new Map<string, EffectiveRule>()
  for (const rule of rules) {
    seen.set(rule.pattern, rule)
  }
  return Array.from(seen.values()).sort((a, b) => a.displayPath.localeCompare(b.displayPath))
}

export * as EffectiveNavigation from "./effective-navigation"
