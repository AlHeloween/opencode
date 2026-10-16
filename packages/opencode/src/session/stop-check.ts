/**
 * End-of-turn stop check — the mechanism half of kernel bug k2.
 *
 * Owner, 2026-10-13: «в кернеле критический баг. Он позволяет не доделывать работу».
 * Measured on this host: a turn may END on a prose question/offer to the owner
 * («Хотите, поищу…?», «Want me to…?») for work the request already covers
 * (docs/robot-protocol-log.md row 40), or by handing him an action after one failed
 * route (row 44). The audit and the decision: experiments/2026-10-13_kernel-exit-audit/REPORT.md
 * (cases B and A) — «Механизм + 2 строки».
 *
 * This module is the robots' host equivalent of the Claude host's Stop hook
 * (`C:\Users\Alexander\.claude\hooks\no_offer_stop.py`): the same two detectors, the same
 * quoted-span exclusion (a citation is not a hand-off), and the same «never blocks twice in
 * a row» latch. The check runs on the session loop's exit (prompt.ts `runLoop`, the
 * `exiting loop` branch): when the decision fires, the runtime continues the turn ONCE with
 * a synthetic user message carrying the reason instead of ending it.
 *
 * Not a claim about the model's will — a claim about where a turn may end. A real owner
 * decision belongs to the `question` tool (src/tool/question.ts), which this check never
 * blocks, and a sub-agent turn is never blocked at all.
 */

import { configValue } from "@opencode-ai/core/flag/flag"
import { isPrimaryModeIdentity } from "./mode-identity"
import { hasValidCleanNextState } from "../util/stop-claim"

/** Opt-out switch: OPENCODE_STOP_CHECK=0|false|off|no (the repo's convention — codegraph-mcp-auto.ts). */
export const OPT_OUT_ENV = "OPENCODE_STOP_CHECK"

/** Part-metadata key marking a continuation message — the «never twice in a row» latch. */
export const LATCH_KEY = "stop_check"

/** `stopped-exit` (was `stop-claim`, plan B3): the turn declared a stopped outcome without the exit form. */
export type StopCheckKind = "question" | "handoff" | "stopped-exit"
export interface StopCheckHit {
  kind: StopCheckKind
  /** The synthetic continuation text the model receives. */
  reason: string
}

export const QUESTION_REASON =
  "Turn ended on a prose question/offer to the owner. Do not offer — act: if the work is inside the request and your " +
  "envelope (read, search, check, install the update you were asked about, message the robot), DO IT now and report " +
  "the result. Only a decision that is truly the owner's (money, security, an irreversible or external effect, a " +
  "matter of his taste) is asked — through the question tool with options, never as a closing prose question. " +
  "(Отвечай владельцу по-русски.)"

export const HANDOFF_REASON =
  'Turn ends by handing the owner an action. Owner, 2026-10-13: «в кернеле критический баг — он позволяет не ' +
  "доделывать работу». Before any hand-off: is the action within YOUR capabilities? Try every route you have " +
  "(cmd_runner, the Terminal panel run_in_terminal, PowerShell/Bash, an MCP tool, a robot) and do it. Only a real " +
  "blocker goes to the owner — through the question tool, naming each route tried with its receipt (command → error)."

/**
 * The stopped-exit contract (plan 2026-10-15 B3, audit F2; was STOP_CLAIM_REASON): blocked is not
 * an exit — the kernel removed the BLOCKED terminal. Name the next action and do it; when the run
 * limit is really reached, the turn ends with a `## Clean next state` section, and THAT section,
 * not a stop claim, is what lets the turn close.
 */
export const STOPPED_EXIT_REASON =
  "Turn ends by declaring a blocked/stopped outcome. Blocked is not an exit — the kernel removed the BLOCKED " +
  "terminal: name the next action and DO it now. When the run limit is really reached, end the turn with a " +
  "`## Clean next state` section — completed, residual, next action, continuation receipt — and that section, " +
  "not a stop claim, is what lets the turn close. (Отвечай владельцу по-русски.)"

/** A trailing session-vector fence is bookkeeping, not the tail the owner reads. */
const SV_BLOCK = /```(?:yaml)?\s*\n\s*Keywords:[\s\S]*?```\s*$/
/** Trailing markdown emphasis / closers the reference strips before reading the last character. */
const TRAILING_MARKS = /[\s*_`»")\]]+$/
const FENCED_CODE = /```[\s\S]*?```/g
const QUOTED_SPAN = /«[^»]*»|"[^"\n]*"|`[^`\n]*`/g
const HANDOFF =
  /(нужно от тебя|от тебя нужно|тебе нужно (?:запустить|сделать|нажать)|запусти\s|нажми\s|выполни у себя|сделай сам|you need to (?:run|start|click)|please run|run it yourself)/i

/** The turn's last paragraph ends on a question (SV block and trailing marks stripped). */
export function endsOnQuestion(text: string): boolean {
  const body = text.trim().replace(SV_BLOCK, "").trim()
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return false
  const tail = paragraphs[paragraphs.length - 1].replace(TRAILING_MARKS, "")
  return tail.endsWith("?")
}

/**
 * The text hands the owner an action. Fenced code and quoted spans («…», "…", `…`) are
 * dropped first: the reference's measured false positive was a report QUOTING an earlier
 * «запусти bin\opencode.exe» as a case study, not asking for anything.
 */
export function handsOff(text: string): boolean {
  const body = text.replace(FENCED_CODE, "").replace(QUOTED_SPAN, "")
  return HANDOFF.test(body)
}

/** Stop-check disabled-state with priority env > config > default-on (t76-minimum). */
export function stopCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[OPT_OUT_ENV]
  if (raw !== undefined && raw.trim() !== "") {
    const value = raw.trim().toLowerCase()
    return value === "0" || value === "false" || value === "off" || value === "no"
  }
  const cfg = configValue(OPT_OUT_ENV)
  if (typeof cfg === "boolean") return !cfg
  return false
}

/** A turn whose last paragraph DECLARES the work stopped — the BLOCKED-family verdict line. */
const STOP_DECLARATION = /(\bblocked\b|заблокирован\w*|(?:не могу|невозможно) продолжить|\bpostponed\b|отложен\w*)/i

/**
 * The turn's last paragraph declares a blocked/stopped outcome. Read from the TAIL on purpose: a
 * report may narrate a blocked route and still finish («взял маршрут B и довёл до конца»), and the
 * exit claim is what the turn CLOSES on. Fenced code and quoted spans are dropped first, so a
 * report quoting «blocked by policy» is a citation, not a declaration.
 */
export function declaredStopped(text: string): boolean {
  const body = text.trim().replace(SV_BLOCK, "").trim()
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return false
  const tail = paragraphs[paragraphs.length - 1].replace(FENCED_CODE, "").replace(QUOTED_SPAN, "")
  return STOP_DECLARATION.test(tail)
}

/**
 * The whole decision, as data: what the turn ends on, and whether this turn may be
 * continued for it. `undefined` = the turn ends as it would have without the mechanism.
 */
export function stopCheckDecision(input: {
  /** Final assistant text of the turn (non-ignored text parts). */
  text: string
  /** The turn's agent identity (user message `agent`). */
  agent: string
  /** The turn already answers a continuation message this check injected. */
  alreadyContinued: boolean
  /** The turn called the `question` tool — a real owner decision is not blocked. */
  questionToolCalled: boolean
  env?: NodeJS.ProcessEnv
}): StopCheckHit | undefined {
  if (stopCheckDisabled(input.env)) return undefined
  if (!isPrimaryModeIdentity(input.agent)) return undefined
  if (input.alreadyContinued) return undefined
  if (input.questionToolCalled) return undefined
  if (endsOnQuestion(input.text)) return { kind: "question", reason: QUESTION_REASON }
  if (handsOff(input.text)) return { kind: "handoff", reason: HANDOFF_REASON }
  // The stopped-exit contract (plan 2026-10-15 B3, audit F2; was the stop-claim form): a turn may
  // END on a blocked/stopped verdict only when it carries `## Clean next state` — completed,
  // residual, next action, continuation receipt. A stop claim no longer ends a turn: blocked is
  // not an exit, the next action is.
  if (declaredStopped(input.text) && !hasValidCleanNextState(input.text)) {
    return { kind: "stopped-exit", reason: STOPPED_EXIT_REASON }
  }
  return undefined
}
