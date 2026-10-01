import { expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { LAYER1_SUMMARY_MARKER, mechanicalSummaryBody } from "../../src/session/compaction"
import { extractDominant } from "../../src/memory/spine"

/**
 * A reply as the TUI stores it: one text part. Cast, because the function under test reads only
 * `info.id`, `info.role` and the text parts — a full `WithParts` would drag the schema in for
 * nothing, and the cast is stated here rather than hidden.
 */
const msg = (id: string, role: "user" | "assistant", text: string) =>
  ({ info: { id, role }, parts: [{ type: "text", text }] }) as unknown as MessageV2.WithParts

const A = "aaaabbbbccccddddeeeeffff00001111"
const B = "11112222333344445555666677778888"
const C = "99998888777766665555444433332222"
const ZERO = "0".repeat(32)

const vector = (opts: { dominant: string; md5: string; prevMd5: string }) =>
  [
    "Keywords: sv-chain 0.29, current-sv 0.24",
    `Semantic dominant: ${opts.dominant}`,
    `md5: ${opts.md5}`,
    `prev-md5: ${opts.prevMd5}`,
    `parent-goal-md5: ${ZERO}`,
  ].join("\n")

const body = (messages: MessageV2.WithParts[], extra: Partial<Parameters<typeof mechanicalSummaryBody>[0]> = {}) =>
  mechanicalSummaryBody({ messages, diffs: [], ...extra })

test("reads the CURRENT @SV_FORMAT, not the legacy `## Semantic Vector` heading", () => {
  const out = body([msg("msg_1", "assistant", vector({ dominant: "Цепочка md5 даёт непрерывность", md5: A, prevMd5: ZERO }))])
  // The pre-fix implementation used `extractSemanticVector`, which matches `## Semantic Vector`
  // and therefore returned undefined for every real reply — the body fell back to the first line
  // of the text. This asserts the dominant came from the @SV_FORMAT block.
  expect(out).toContain('"Цепочка md5 даёт непрерывность"')
  expect(out).toContain("1/1 assistant replies carry a vector")
  // The row's sv identity is the PAIR, not the last one alone (owner, 2026-09-27). With one vector
  // both ends are the same label, which is exactly the degenerate case worth pinning: a reader must
  // be able to find a range by the label it BEGINS on, and `first` is what makes that possible.
  expect(out).toContain(`Labels: first ${A} · last ${A}`)
  expect(out).toContain("Weights: sv-chain 0.29")
})

test("an intact chain carries no break", () => {
  const out = body([
    msg("msg_1", "assistant", vector({ dominant: "первый", md5: A, prevMd5: ZERO })),
    msg("msg_2", "assistant", vector({ dominant: "второй", md5: B, prevMd5: A })),
  ])
  expect(out).toContain("0 declared breaks")
  expect(out).toContain("2/2 assistant replies carry a vector")
  expect(out).toContain("0 vectors without a label")
})

test("a declared break is flagged with the position that carries it", () => {
  const out = body([
    msg("msg_1", "assistant", vector({ dominant: "первый", md5: A, prevMd5: ZERO })),
    // B points back at C, which no vector in this range wrote.
    msg("msg_2", "assistant", vector({ dominant: "второй", md5: B, prevMd5: C })),
  ])
  expect(out).toContain("1 declared break at #2")
  // The per-message `⚠` marker is gone: the body is sections now, not an index, and a break is
  // located by its POSITION in the chain line above. What must survive is that #2 is nameable.
  expect(out).toContain("2/2 assistant replies carry a vector")
})

test("a message with NO vector is not a break", () => {
  // `memory/spine.ts`: an unreadable side is Unknown, and Unknown is never marked. A user turn
  // carries no @SV_FORMAT BY DESIGN, so it is not counted at all — publishing a correct message as
  // a defect is the failure mode the whole coverage counter exists to avoid.
  const out = body([
    msg("msg_1", "assistant", vector({ dominant: "первый", md5: A, prevMd5: ZERO })),
    msg("msg_2", "user", "Дай мне целевой граф."),
    msg("msg_3", "assistant", vector({ dominant: "третий", md5: B, prevMd5: A })),
  ])
  expect(out).toContain("2/2 assistant replies carry a vector")
  expect(out).toContain("0 declared breaks")
  expect(out).not.toContain("without a vector")
})

test("the first vector of a range is a chain start, not a break", () => {
  const out = body([msg("msg_1", "assistant", vector({ dominant: "первый", md5: A, prevMd5: B }))])
  expect(out).toContain("0 declared breaks")
})

test("a vector with NO md5 is a missing EDGE, counted apart from a break", () => {
  // Measured 2026-27: 123 vectors on this session, 83 carry `md5`, 40 carry none. The hole is not
  // a contradiction — nothing says otherwise — so it must not wear the break marker, or a reader
  // learns to ignore that marker. It gets its own count and its own positions.
  const out = body([
    msg("msg_1", "assistant", vector({ dominant: "первый", md5: A, prevMd5: ZERO })),
    msg("msg_2", "assistant", "Keywords: sv-chain 0.29\nSemantic dominant: совсем без поля"),
    msg("msg_3", "assistant", vector({ dominant: "третий", md5: B, prevMd5: A })),
  ])
  expect(out).toContain("3/3 assistant replies carry a vector")
  expect(out).toContain("0 declared breaks")
  expect(out).toContain("1 vector without a label at #2 (absent)")
})

test("a non-hex fragment inside the md5 is REPORTED and named, not normalised away", () => {
  // Measured 2026-27 on this session's own rows: `b7e93f0a5c26d8エラー` — a word leaked into the
  // hash, and it ate the head of the next line — and `…b2f38m45`, one letter. The fragment is
  // situational: it names the state the model was in, which is the whole value of the signal.
  const leaked = ["Keywords: sv-chain 0.29", "Semantic dominant: артефакт генерации", "md5: b7e93f0a5c26d8エラー", `prev-md5: ${A}`].join("\n")
  const out = body([msg("msg_1", "assistant", leaked)])
  expect(out).toContain(`0 declared breaks`)
  expect(out).toContain(`#1 (leaked "エラー")`)

  const oneLetter = ["Keywords: sv-chain 0.29", "Semantic dominant: одна буква", "md5: 7e4b1a90c6d28f35a9e0c7d1b2f38m45", `prev-md5: ${A}`].join("\n")
  expect(body([msg("msg_1", "assistant", oneLetter)])).toContain(`#1 (leaked "m")`)
})

test("a well-formed md5 is never judged — only an absent field or a token is reported", () => {
  // @SV_FORMAT forbids verifying the digest: 32 hex is the only admissible form, and whether those
  // 32 characters are RANDOM is not decidable from the text. So a clean value reports nothing,
  // however suspicious it looks, and a reader that flagged it would be training us to ignore it.
  const out = body([msg("msg_1", "assistant", vector({ dominant: "чисто", md5: A, prevMd5: ZERO }))])
  expect(out).toContain("0 vectors without a label")
  expect(out).not.toContain("leaked")
})

test("only assistant replies count — a user turn and a tool result are not defects", () => {
  // Measured 2026-27: a 108-message range held 17 assistant replies and 91 other messages, and
  // counting all of them published 91 correct messages as 91 defects. @SV_FORMAT rides a model
  // answer, so the denominator is the replies, not the range.
  const out = body([
    msg("msg_1", "user", "сделай грамматику"),
    msg("msg_2", "assistant", vector({ dominant: "ок", md5: A, prevMd5: ZERO })),
    msg("msg_3", "user", "а ещё?"),
  ])
  expect(out).toContain("1/1 assistant replies carry a vector")
  expect(out).not.toContain("without a vector")
})

test("a position list is capped — 91 numbers in one line is a wall, not an address", () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    msg(`msg_${i}`, "assistant", ["Keywords: a 0.5", "Semantic dominant: без хеша"].join("\n")),
  )
  const out = body(many)
  expect(out).toContain("40 vectors without a label")
  expect(out).toContain("(+34 more)")
  // The wall itself must be gone: six positions and a count, not forty.
  expect(out).not.toContain("#1, #2, #3, #4, #5, #6, #7, #8")
})

test("a long-but-all-hex value is a reader that ran past the field, not a leaked token", () => {
  // The false positive measured 2026-27: `readRawVectorField` matched `^md5:` with the `m` flag
  // against text whose newlines are LITERAL `\n`, so the value swallowed the following fields —
  // all hex, longer than 32 — and the old fallback sliced 32 of it and named a clean label a leak.
  const glued = ["Keywords: a 0.5", "Semantic dominant: склейка", `md5: ${A}\\nprev-md5: ${B}\\nparent-goal-md5: ${ZERO}`].join("\n")
  const out = body([msg("msg_1", "assistant", glued)])
  // The false positive is gone because the READER became correct, not because it stopped reporting:
  // the value now stops at the escaped newline, the label is read whole, and there is nothing to
  // report. A test that expected a defect here would have locked the old wrong behaviour in.
  expect(out).toContain(`Labels: first ${A} · last ${A}`)
  expect(out).toContain("0 vectors without a label")
  expect(out).not.toContain("leaked")
})

test("the row pairs an @SV_TARGET ask with what came back, so the distance is arithmetic", () => {
  // Steering a delegate is `SEMANTIC_CONTROL`, and the kernel's instrument for it is
  // `@L1_DISTANCE` — subtraction over two weight lists. That only works if BOTH live in one place,
  // so the row carries the ask (from the task binding) next to the answer (the reply's dominant).
  // An unchanged `md5` across the re-generation is what proves it is the same work, re-read.
  const ask = [
    "Найди, где теряются рёбра.",
    "",
    "```yaml",
    "@SV_TARGET",
    "Keywords: edge-loss 0.30, summary-cadence 0.25, current-sv 0.20",
    "```",
  ].join("\n")
  const out = body([
    msg("msg_1", "user", ask),
    msg("msg_2", "assistant", vector({ dominant: "Рёбра теряются в mstar", md5: A, prevMd5: ZERO })),
  ])
  expect(out).toContain("Target asked: edge-loss 0.3, summary-cadence 0.25, current-sv 0.2")
  expect(out).toContain("Returned: Рёбра теряются в mstar")
})

test("a range with no @SV_TARGET says so instead of implying a measurement", () => {
  const out = body([msg("msg_1", "assistant", vector({ dominant: "просто", md5: A, prevMd5: ZERO }))])
  expect(out).toContain("No @SV_TARGET in this range")
  expect(out).not.toContain("Target asked")
})

test("the Goal carrier never quotes the machine's own panel as the owner's request", () => {
  // Measured 2026-09-27 by `dbread` over the live session, not inferred: the first user row of the
  // range #780..#875 is `msg_0e15e0798001SM4jw3ldjz7W9d`, `synthetic = 1`, its text
  // `=== LAYER-1 SUMMARY === …` — the panel this system writes. `rows.find(r => r.role === "user")`
  // took it, and the row printed `In this range the user asked: === LAYER-1 SUMMARY ===`, so a row
  // asserted the owner asked for a summary marker. It reached TWO rows and I repaired both BY HAND,
  // which is the tell that a carrier is wrong: a reader can fix it, and the next one will not know
  // to. The real request is the NEXT user message.
  const out = body([
    msg("msg_1", "user", `${LAYER1_SUMMARY_MARKER}\nRange: 6 messages · 257520 chars\n## Semantic Vector`),
    msg("msg_2", "user", "Что у нас на повестке?"),
    msg("msg_3", "assistant", vector({ dominant: "повестка из одиннадцати галок", md5: A, prevMd5: ZERO })),
  ])
  expect(out).toContain("The range opens on the request: Что у нас на повестке?")
  // The whole marker, not just the Goal line: a machine artifact quoted anywhere in this row would
  // be the same lie wearing a different hat.
  expect(out).not.toContain(LAYER1_SUMMARY_MARKER)
})

test("a range with no owner request says so — it never credits a plan that states no intention", () => {
  // The panel IS a machine artifact, so filtering it can leave a range with no request at all. The
  // old fallback answered exactly that case with «the goal is carried by the plan's `intention`,
  // read from the plan file» — and it is reached ONLY when no plan intention exists, so it named a
  // carrier that is not there. Acceptance #5: the Goal never becomes silent, and the reason is
  // stated rather than invented.
  const out = body([
    msg("msg_1", "user", `${LAYER1_SUMMARY_MARKER}\nRange: 6 messages`),
    msg("msg_2", "assistant", vector({ dominant: "только панель", md5: A, prevMd5: ZERO })),
  ])
  expect(out).not.toContain(LAYER1_SUMMARY_MARKER)
  expect(out).toContain("no plan states an intention")
  expect(out).not.toContain("opens mid-thread")
})

test("the epoch carries a `dominant:` FIELD — the one line a later window searches it by", () => {
  // MEASURED 2026-10-01 on the live DB, not inferred: `project_checkpoint` held 23 rows for this
  // session and ZERO of them contained the marker, so `messagesearch { corpus: "summaries" }`
  // printed `(no dominant)` for every epoch and its `dominant:` second query could never match one.
  // Two readers already expected the field (`memory/spine.ts:extractDominant`, and
  // `compaction.extractSemanticVector`); this body is written by a machine and never wrote it.
  const out = body([
    msg("msg_1", "assistant", vector({ dominant: "первый", md5: A, prevMd5: ZERO })),
    msg("msg_2", "assistant", vector({ dominant: "последний", md5: B, prevMd5: A })),
  ])
  // Read back through the SAME reader the spine uses: the writer and the reader are the PAIR that
  // broke, so a test that only looked at the text would lock in one half of the disagreement.
  // LAST, because that is the vector the next window chains from.
  expect(extractDominant(out)).toBe("последний")
  // Order is contract: `extractDominant` takes the FIRST `dominant:` in the body.
  expect(out.indexOf('dominant: "')).toBeLessThan(out.indexOf("Labels:"))
})

test("a lone reply with no vector spells no marker — a count cannot invent a hook", () => {
  // The degenerate shape that produced a FALSE hook. The Labels line counted `speakable.length`
  // (every assistant reply) while listing only the carriers, so a one-reply range printed
  // `1 dominant: none` — and `extractDominant` returned the literal string `none`, because
  // `plural(1, "dominant")` spells the marker itself.
  const out = body([msg("msg_1", "assistant", "ответ без вектора")])
  expect(out).not.toContain("dominant:")
  expect(extractDominant(out)).toBeUndefined()
})
