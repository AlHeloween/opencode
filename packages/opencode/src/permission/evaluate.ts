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
    if (agentDeny) return agentDeny
  }

  // Standard precedence: last matching rule wins among merged rules
  const rules = rulesets.flat()
  const match = rules.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}
