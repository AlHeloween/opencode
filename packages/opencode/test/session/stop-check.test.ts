import { describe, expect, it } from "bun:test"
import { endsOnQuestion, handsOff, stopCheckDecision, stopCheckDisabled } from "../../src/session/stop-check"

// The two detectors and the decision are transcribed from the Claude host's Stop hook
// (C:\Users\Alexander\.claude\hooks\no_offer_stop.py) — kernel bug k2, cases B and A of
// experiments/2026-10-13_kernel-exit-audit/REPORT.md. Every case below is the reference's own
// case or a measured one from docs/robot-protocol-log.md rows 40 and 44.

describe("stop-check / endsOnQuestion", () => {
  it("fires on the measured offer (log row 40)", () => {
    expect(endsOnQuestion("Установка закончена.\n\nХотите, поищу такие ссылки по всему проекту?")).toBe(true)
  })

  it("fires on an English closing offer", () => {
    expect(endsOnQuestion("All checks are green.\n\nWant me to run the full suite?")).toBe(true)
  })

  it("fires when the question sits before the turn's SV block", () => {
    const text = [
      "Отчёт готов.",
      "",
      "Продолжить и доделать механизм?",
      "",
      "```yaml",
      "Keywords: stop-check 1.0",
      "Semantic dominant: x.",
      "md5: 8f3c1d6a29b47e05c8d4f1a6b3e90725",
      "```",
    ].join("\n")
    expect(endsOnQuestion(text)).toBe(true)
  })

  it("strips markdown emphasis and closers after the question, as the reference does", () => {
    expect(endsOnQuestion("**Хотите, поищу?**")).toBe(true)
    expect(endsOnQuestion("Он спросил «Хотите, поищу?»")).toBe(true)
  })

  it("does not fire on a statement", () => {
    expect(endsOnQuestion("Сборка прошла, тесты зелёные, коммит a1b2c3d.")).toBe(false)
  })

  it("does not fire when the last paragraph is a statement even if an earlier one asked", () => {
    expect(endsOnQuestion("А это точно нужно?\n\nСделано и проверено.")).toBe(false)
  })

  it("does not fire on an SV-block-only tail after a statement", () => {
    const text = [
      "Готово.",
      "",
      "```yaml",
      "Keywords: x 1.0",
      "Semantic dominant: y.",
      "md5: 8f3c1d6a29b47e05c8d4f1a6b3e90725",
      "```",
    ].join("\n")
    expect(endsOnQuestion(text)).toBe(false)
  })
})

describe("stop-check / handsOff", () => {
  it("fires on the measured hand-off after one failed route (log row 44)", () => {
    expect(handsOff("cmd_runner не смог стартовать. Тебе нужно запустить _build.ps1 и проверить самому.")).toBe(true)
  })

  it("fires on an English hand-off", () => {
    expect(handsOff("The launcher failed. You need to run the smoke test on your side.")).toBe(true)
  })

  it("does not fire on a quoted phrase — a citation is not a hand-off (the reference's measured false positive)", () => {
    expect(handsOff("Разбор случая A: строка «запусти bin\\opencode.exe» в отчёте — это цитата, а не просьба.")).toBe(false)
  })

  it("does not fire inside a fenced code block", () => {
    expect(handsOff("Инструкция для примера:\n\n```bash\nзапусти ./build.sh\n```\n")).toBe(false)
  })

  it("does not fire inside an inline code span", () => {
    expect(handsOff("Команда `запусти всё` приведена только как пример из лога.")).toBe(false)
  })

  it("does not fire on a plain report", () => {
    expect(handsOff("Готово: механизм собран, тесты зелёные.")).toBe(false)
  })
})

describe("stop-check / stopCheckDisabled", () => {
  it("is enabled by default", () => {
    expect(stopCheckDisabled({})).toBe(false)
    expect(stopCheckDisabled({ OPENCODE_STOP_CHECK: "1" })).toBe(false)
  })

  it("opts out on the repo's own spellings", () => {
    for (const value of ["0", "false", "off", "no", " OFF "]) {
      expect(stopCheckDisabled({ OPENCODE_STOP_CHECK: value })).toBe(true)
    }
  })
})

describe("stop-check / stopCheckDecision", () => {
  const base = {
    text: "Хотите, поищу такие ссылки?",
    agent: "build_mode",
    alreadyContinued: false,
    questionToolCalled: false,
    env: {} as NodeJS.ProcessEnv,
  }

  it("fires for a primary agent on a prose question", () => {
    const hit = stopCheckDecision(base)
    expect(hit?.kind).toBe("question")
    expect(hit?.reason.length).toBeGreaterThan(0)
    expect(hit?.reason).toContain("question")
  })

  it("fires for a primary agent on a hand-off", () => {
    const hit = stopCheckDecision({ ...base, text: "Запусти _build.ps1 сам." })
    expect(hit?.kind).toBe("handoff")
  })

  it("fires for the legacy agent alias", () => {
    expect(stopCheckDecision({ ...base, agent: "build" })?.kind).toBe("question")
  })

  it("never fires for a sub-agent", () => {
    for (const agent of ["coder_agent", "explorer_agent", "general_agent", "orchestrator"]) {
      expect(stopCheckDecision({ ...base, agent })).toBeUndefined()
    }
  })

  it("never fires twice in a row (the continuation turn is already marked)", () => {
    expect(stopCheckDecision({ ...base, alreadyContinued: true })).toBeUndefined()
  })

  it("never fires for a turn that called the question tool", () => {
    expect(stopCheckDecision({ ...base, questionToolCalled: true })).toBeUndefined()
  })

  it("obeys the env switch", () => {
    expect(stopCheckDecision({ ...base, env: { OPENCODE_STOP_CHECK: "0" } })).toBeUndefined()
  })

  it("stays silent on a plain report", () => {
    expect(stopCheckDecision({ ...base, text: "Готово: механизм собран, тесты зелёные." })).toBeUndefined()
  })
})

// ── The stopped-exit contract (plan 2026-10-15_kernel-continuation-without-blocked B3, audit F2) ──
// The kernel removed the BLOCKED terminal: blocked is not an exit — name the next action and do it;
// when the run limit is really reached, the turn ends with a `## Clean next state` section
// (completed, residual, next action, continuation receipt). That section, not a stop claim, is what
// lets the turn end. The quoted-span exclusion and the once-only latch are unchanged. SUPERSEDES the
// 2026-10-14 stop-claim exit (owner «Да + механизм»): a stop claim no longer ends a turn — it stays
// the PLAN-side form (plans/postponed/ audits in util/plan-status.ts).

describe("stop-check / stopped exit", () => {
  const base = {
    agent: "build_mode",
    alreadyContinued: false,
    questionToolCalled: false,
    env: {} as NodeJS.ProcessEnv,
  }
  const BLOCKED_TAIL = "Итог: BLOCKED — маршрут отклонён политикой, продолжать не могу."
  const CLEAN =
    "## Clean next state\n\n" +
    "completed: the reproducer and the red tests\n" +
    "residual: the gated install of the kernel pipeline\n" +
    "next action: run the install after the review\n" +
    "continuation receipt: plans/2026-10-15_kernel-continuation-without-blocked.md B2\n"
  const CLAIM =
    "## Stop claim\n\n" +
    "| route | receipt | failing component |\n" +
    "|---|---|---|\n" +
    "| cmd_runner | run-1 exit 1 | policy |\n" +
    "\nuntried routes: an approval request\n" +
    "reopen_when: the policy changes\n"

  it("fires when the turn declares a blocked outcome WITHOUT any exit form", () => {
    const hit = stopCheckDecision({ ...base, text: BLOCKED_TAIL })
    expect(hit?.kind).toBe("stopped-exit")
    expect(hit?.reason).toContain("Clean next state")
    expect(hit?.reason).toContain("not an exit")
  })

  it("a valid STOP CLAIM no longer lets the turn end — blocked is not an exit (plan B3)", () => {
    // The verdict is the turn's TAIL (the exit claim is what the turn closes on) and the stop
    // claim form rides in the same closing block: the 2026-10-14 contract exempted this text,
    // the B3 contract does not — blocked is not an exit, the next action is.
    const text =
      "## Stop claim\n\n" +
      "| route | receipt | failing component |\n" +
      "|---|---|---|\n" +
      "| cmd_runner | run-1 exit 1 | policy |\n" +
      "untried routes: an approval request\n" +
      "reopen_when: the policy changes\n" +
      "Итог: BLOCKED — маршрут отклонён политикой, продолжать не могу."
    expect(stopCheckDecision({ ...base, text })?.kind).toBe("stopped-exit")
  })

  it("a valid ## Clean next state lets the turn end", () => {
    expect(stopCheckDecision({ ...base, text: BLOCKED_TAIL + "\n\n" + CLEAN })).toBeUndefined()
  })

  it("an INCOMPLETE clean-next-state section does not let the turn end", () => {
    const incomplete = BLOCKED_TAIL + "\n\n" + CLEAN.replace(/^next action:.*$/im, "")
    expect(stopCheckDecision({ ...base, text: incomplete })?.kind).toBe("stopped-exit")
  })

  it("does not fire on a successful report that merely mentions a blocked route", () => {
    expect(
      stopCheckDecision({
        ...base,
        text: "Маршрут A был заблокирован политикой.\n\nВзял маршрут B и довёл его до конца: сборка зелёная.",
      }),
    ).toBeUndefined()
  })

  it("fires on the Russian spellings too — заблокировано / не могу продолжить / отложен", () => {
    for (const tail of ["Ничего не вышло: заблокировано политикой.", "Не могу продолжить.", "План отложен."]) {
      expect(stopCheckDecision({ ...base, text: tail })?.kind).toBe("stopped-exit")
    }
  })

  it("a quoted «blocked» in the tail is a citation, not a declaration", () => {
    expect(
      stopCheckDecision({ ...base, text: "В логе была строка «blocked by policy, no further reason» — просто цитата." }),
    ).toBeUndefined()
  })
})
