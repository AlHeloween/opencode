export * as PermissionV2 from "./permission"

import { Schema } from "effect"
import { Wildcard } from "./util/wildcard"
import { Identifier } from "./util/identifier"

/**
 * Permission ID — branded string, conventionally "per_" prefixed.
 */
export const PermissionID = Schema.String.pipe(Schema.brand("PermissionID"))
export type PermissionID = Schema.Schema.Type<typeof PermissionID>

/** Create a new ascending PermissionID with the "per_" prefix */
export function makePermissionID(id?: string): PermissionID {
  return ("per_" + (id ?? Identifier.ascending())) as PermissionID
}

export const Action = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "Permission.Action" })
export type Action = typeof Action.Type

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
}).annotate({ identifier: "Permission.Rule" })
export type Rule = typeof Rule.Type

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "Permission.Ruleset" })
export type Ruleset = typeof Ruleset.Type

const EDIT_TOOLS = ["edit", "write", "apply_patch"]

/**
 * Evaluate a permission against one or more rulesets.
 * Finds the last matching rule (most specific). Defaults to "ask".
 */
export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}

/** Merge multiple rulesets into one */
export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

/**
 * Return the set of tools disabled by a deny-* rule in the ruleset.
 * Edit tools (edit, write, apply_patch) are grouped under the "edit" permission.
 */
export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  return new Set(
    tools.filter((tool) => {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}
