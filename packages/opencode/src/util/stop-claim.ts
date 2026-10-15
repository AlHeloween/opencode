/**
 * «## Stop claim» — the ONE form a claim that work STOPPED must carry.
 *
 * Owner decision 2026-10-14 («Да + механизм»), t42 report §1.5/§2/§2.2: BLOCKED is a universal
 * negative over the route space («no path found on these routes») — it cannot be verified, only
 * scoped (routes tried, each with a receipt and the failing component; untried routes named) and
 * falsified by one action (the first route that reaches). An empty routes list is Guess, and Guess
 * decides nothing (@GUESS_DECIDES_NOTHING) — but nothing connected that rule to the terminal.
 *
 * The measured case this module exists for (docs/robot-protocol-log.md:49): a delegate parked a plan
 * as BLOCKED after ONE refused route — reason = the refusal text, lift signal = a tautology, no
 * routes list, no component split. Two surfaces now DEMAND the form:
 *   - `util/plan-status.ts` audits a parked or blocked plan and REPORTS a missing/empty claim;
 *   - `session/stop-check.ts` continues a primary-agent turn that declares a stop without one.
 *
 * Leaf module on purpose (no imports): both consumers above can use it without a cycle, and the
 * predicate is one home — a second copy would be two answers to «does this claim hold».
 */

/** The section heading, exact: `## Stop claim` — any case, optional trailing spaces. */
const SECTION = /^##\s+stop\s+claim\s*$/im
const NEXT_HEADING = /^##\s/m
const TABLE_ROW = /^\s*\|.*\|\s*$/
const SEPARATOR_CELL = /^:?-{3,}:?$/
/** A cell whose whole content is a placeholder states nothing — a dash is not a receipt. */
const EMPTY_CELL = /^(?:[-—–]*|n\/a|tbd|todo)$/i
/** A bare «none» names no route: the route space is open, so «none» is the Codex tautology. */
const BARE_NOTHING = /^(?:none|нет|n\/a|tbd)$/i

/** The `## Stop claim` body — from the heading to the next level-2 heading, or `undefined`. */
export function findStopClaimSection(text: string): string | undefined {
  const match = SECTION.exec(text)
  if (!match) return undefined
  const rest = text.slice(match.index + match[0].length)
  const next = rest.search(NEXT_HEADING)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim())
}

function isEmptyCell(value: string): boolean {
  const cleaned = value.replace(/[`*_]/g, "").trim()
  return cleaned.length === 0 || EMPTY_CELL.test(cleaned)
}

/** Markdown tables of a section: a header row followed by its separator and data rows. */
function tables(section: string): { header: string[]; rows: string[][] }[] {
  const lines = section.split("\n")
  const out: { header: string[]; rows: string[][] }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_ROW.test(lines[i]!)) continue
    const header = cells(lines[i]!)
    const rows: string[][] = []
    let j = i + 1
    for (; j < lines.length && TABLE_ROW.test(lines[j]!); j++) {
      const row = cells(lines[j]!)
      if (row.every((cell) => SEPARATOR_CELL.test(cell.replace(/\s/g, "")))) continue
      rows.push(row)
    }
    out.push({ header, rows })
    i = j - 1
  }
  return out
}

/**
 * A field carried either inline (`untried routes: …` / `reopen_when: …` / `lift signal: …`) or as
 * a heading with its body (`### Untried routes`). A reader that knows one spelling declares the
 * rest absent — the plan files have used both since they existed.
 */
function field(lines: string[], inline: RegExp, heading: RegExp): string | undefined {
  for (const line of lines) {
    const match = line.match(inline)
    if (match) return match[1]!.trim()
  }
  const at = lines.findIndex((line) => heading.test(line))
  if (at === -1) return undefined
  const body: string[] = []
  for (let i = at + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i]!)) break
    if (lines[i]!.trim()) body.push(lines[i]!.trim())
  }
  return body.join(" ")
}

const UNTRIED_INLINE = /^\s*[-*]?\s*\**untried routes?\**\s*:\s*(.*)$/i
const UNTRIED_HEADING = /^#{3,6}\s*untried routes?\s*$/i
const REOPEN_INLINE = /^\s*[-*]?\s*\**(?:reopen[ _]when|lift signal)\**\s*:\s*(.*)$/i
const REOPEN_HEADING = /^#{3,6}\s*(?:reopen[ _]when|lift signal)\s*$/i

/**
 * Validation of a `## Stop claim` BODY. `[]` = the form holds; every missing or empty piece is a
 * named problem (the reader must be able to say WHAT is absent, not only THAT something is).
 */
export function stopClaimProblems(section: string): string[] {
  const problems: string[] = []
  const lines = section.split("\n")

  const routes = tables(section)
    .map((table) => {
      const route = table.header.findIndex((cell) => /^route$/i.test(cell))
      const receipt = table.header.findIndex((cell) => /^receipt/i.test(cell))
      const component = table.header.findIndex((cell) => /component/i.test(cell))
      return { table, route, receipt, component }
    })
    .find((entry) => entry.route >= 0 && entry.receipt >= 0 && entry.component >= 0)

  if (!routes) {
    problems.push("routes table missing (need a markdown table with columns: route | receipt | failing component)")
  } else if (routes.table.rows.length === 0) {
    problems.push("routes table has no data rows")
  } else {
    routes.table.rows.forEach((row, index) => {
      const number = index + 1
      if (isEmptyCell(row[routes.route] ?? "")) problems.push(`routes table row ${number}: route empty`)
      if (isEmptyCell(row[routes.receipt] ?? "")) problems.push(`routes table row ${number}: receipt empty`)
      if (isEmptyCell(row[routes.component] ?? "")) problems.push(`routes table row ${number}: failing component empty`)
    })
  }

  const untried = field(lines, UNTRIED_INLINE, UNTRIED_HEADING)
  const untriedBare = untried !== undefined && BARE_NOTHING.test(untried.replace(/[`*_.]/g, "").trim())
  if (untried === undefined || untried.length === 0 || untriedBare) {
    problems.push("untried routes missing or empty (name the routes not yet tried, or say why the route space is closed)")
  }

  const reopen = field(lines, REOPEN_INLINE, REOPEN_HEADING)
  if (reopen === undefined || reopen.length === 0) {
    problems.push("reopen_when missing or empty (name the condition that reopens this work)")
  }

  return problems
}

/** The whole-text predicate both consumers use: a section that exists and holds the form. */
export function hasValidStopClaim(text: string): boolean {
  const section = findStopClaimSection(text)
  if (section === undefined) return false
  return stopClaimProblems(section).length === 0
}

// ── «## Clean next state» — the ONE form that lets a turn END (plan 2026-10-15 B3, audit F2) ──
// The kernel removed the BLOCKED terminal: blocked is not an exit — name the next action and do
// it; when the run limit is really reached, the turn ends with a `## Clean next state` section
// (completed, residual, next action, continuation receipt). That section, not a stop claim, is
// what lets the turn end. The stop-claim form above stays for the PLAN side (plans/postponed/
// audits in util/plan-status.ts) — the two forms answer different questions, so neither is a
// second copy of the other.
const CLEAN_SECTION = /^##\s+clean\s+next\s+state\s*$/im
const COMPLETED_INLINE = /^\s*[-*]?\s*\**completed\**\s*:\s*(.*)$/i
const COMPLETED_HEADING = /^#{3,6}\s*completed\s*$/i
const RESIDUAL_INLINE = /^\s*[-*]?\s*\**residual\**\s*:\s*(.*)$/i
const RESIDUAL_HEADING = /^#{3,6}\s*residual\s*$/i
const NEXT_ACTION_INLINE = /^\s*[-*]?\s*\**next[ _]action\**\s*:\s*(.*)$/i
const NEXT_ACTION_HEADING = /^#{3,6}\s*next[ _]action\s*$/i
const RECEIPT_INLINE = /^\s*[-*]?\s*\**continuation[ _]receipt\**\s*:\s*(.*)$/i
const RECEIPT_HEADING = /^#{3,6}\s*continuation[ _]receipt\s*$/i

/** The `## Clean next state` body — from the heading to the next level-2 heading, or `undefined`. */
export function findCleanNextStateSection(text: string): string | undefined {
  const match = CLEAN_SECTION.exec(text)
  if (!match) return undefined
  const rest = text.slice(match.index + match[0].length)
  const next = rest.search(NEXT_HEADING)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}

/**
 * Validation of a `## Clean next state` BODY: the four fields the kernel's CLEAN_NEXT_STATE
 * contract names. `[]` = the form holds; every missing or empty piece is a named problem — a dash
 * is not a field (the same empty rule the stop-claim table cells use).
 */
export function cleanNextStateProblems(section: string): string[] {
  const problems: string[] = []
  const lines = section.split("\n")
  for (const [name, inline, heading] of [
    ["completed", COMPLETED_INLINE, COMPLETED_HEADING],
    ["residual", RESIDUAL_INLINE, RESIDUAL_HEADING],
    ["next action", NEXT_ACTION_INLINE, NEXT_ACTION_HEADING],
    ["continuation receipt", RECEIPT_INLINE, RECEIPT_HEADING],
  ] as const) {
    const value = field(lines, inline, heading)
    if (value === undefined || isEmptyCell(value)) problems.push(`${name} missing or empty`)
  }
  return problems
}

/** The whole-text predicate the stop-check consumes: a section that exists and holds the form. */
export function hasValidCleanNextState(text: string): boolean {
  const section = findCleanNextStateSection(text)
  if (section === undefined) return false
  return cleanNextStateProblems(section).length === 0
}
