import { Wildcard } from "@/util/wildcard"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  // When multiple rulesets are provided (agent + user config), agent denies are absolute
  // — user config cannot override them. The first ruleset is always the agent's built-in
  // permission rules based on all call sites of Permission.merge and Permission.evaluate.
  if (rulesets.length > 1) {
    const agentDeny = rulesets[0].findLast(
      (rule) =>
        rule.action === "deny" &&
        Wildcard.match(permission, rule.permission) &&
        Wildcard.match(pattern, rule.pattern),
    )
    if (agentDeny) {
      // A wildcard deny (e.g. "*": "deny") should not be absolute when the same
      // agent ruleset has a more specific rule for this permission later in the
      // array. Otherwise the catch-all shadows the specific allows (e.g. explore
      // agent: "*": "deny" + "grep": "allow" → grep wrongly denied).
      const denyIdx = rulesets[0].lastIndexOf(agentDeny)
      const hasSpecificOverride = rulesets[0].slice(denyIdx + 1).some(
        (rule) => rule.permission === permission,
      )
      if (!hasSpecificOverride) return agentDeny
    }
  }

  // Standard precedence: last matching rule wins among merged rules
  const rules = rulesets.flat()
  const match = rules.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}
