import { Permission } from "@/permission"
import { Wildcard } from "@/util/wildcard"
import type { Agent } from "./agent"
import type { Def } from "@/tool/tool"

export type ToolLike = Pick<Def, "id" | "policy">

/** Tool policies that reach `ctx.ask({ permission: "edit" })` as the edit family. */
const EDIT_FAMILY = ["edit", "write"] as const

/** The permission keys a tool policy is evaluated under — mirrors `SessionTools.denied`. */
export function policyPermissionKeys(policy: string): string[] {
  const keys = new Set<string>([policy])
  if ((EDIT_FAMILY as readonly string[]).includes(policy)) keys.add("edit")
  return [...keys]
}

function permissionForKey(key: string): string {
  return (EDIT_FAMILY as readonly string[]).includes(key) ? "edit" : key
}

function hasScopedEditAllow(agent: Agent.Info, perm: string): boolean {
  return (
    perm === "edit" &&
    agent.permission.some(
      (rule) =>
        Wildcard.match(perm, rule.permission) &&
        rule.pattern !== "*" &&
        (rule.action === "allow" || rule.action === "ask"),
    )
  )
}

/**
 * Whether the identity's own ruleset denies a tool policy.
 *
 * This is the agent-scoped half of `SessionTools.denied` (the Gate A runtime refusal) —
 * `session.permission` is applied on top of it at runtime. It is the single formula behind:
 *   - `script/kernel-tools-manifest.ts` (the manifest the kernel add-ons are filled from),
 *   - `test/agent/kernel-identity-tools.test.ts` (the parity guard against the rendered kernel).
 *
 * Semantics: a policy is denied when `Permission.evaluate(perm, "*")` says deny and no
 * path-scoped edit allow (`plans/*: allow`) carves it back — the same rule the runtime uses.
 * A boundary that exists only as a `deny(...)` key which does not match the tool's policy
 * is dead: see the 2026-09-28 `jobkill`/`job_kill` finding in the plan — the two-spelling
 * layer is gone (2026-09-29): a tool has ONE identity and its policy IS that identity.
 */
export function agentDeniesPolicy(agent: Agent.Info, policy: string): boolean {
  for (const key of policyPermissionKeys(policy)) {
    const perm = permissionForKey(key)
    const ruled = Permission.evaluate(perm, "*", agent.permission)
    if (ruled.action === "deny" && !hasScopedEditAllow(agent, perm)) return true
  }
  return false
}

/** Allowed view of a tool catalogue for one identity, from its native ruleset. */
export function resolveTools(agent: Agent.Info, availableTools: ToolLike[]): Record<string, boolean> {
  return Object.fromEntries(availableTools.map((tool) => [tool.id, !agentDeniesPolicy(agent, tool.policy)]))
}
