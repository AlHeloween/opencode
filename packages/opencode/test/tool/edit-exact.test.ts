import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Parameters, addressReport, resolveEdits } from "../../src/tool/edit"
import { chainHash, hashLabel } from "../../src/tool/read"

/**
 * THE LIVE PATH ONLY: `Parameters` + `resolveEdits`.
 *
 * H8 (plans_completed/2026-10-01_hash-addressed-edits.md) removed the fuzzy cascade — `replace`,
 * `replaceWithStage`, `replaceRange` and the ten `Replacer` stages — together with the three blocks here that
 * pinned it. Nothing in `src/` called them, so those blocks were green and could not fail on the product; they
 * were kept only until the dead layer left WITH them, in one change, so the proof never outlived its subject.
 *
 * WHAT MOVED, AND WHEN: the batch surface (H6, 2026-10-01) made `edit` take `files: [{ filePath, edits? }]`, so
 * the schema cases below were RE-PINNED to the shape a caller actually sends — the same three sides, none
 * dropped. Their red on the pre-H6 shape is recorded as provenance, not deleted as embarrassment:
 * `20261001T052355Z_7c3c83cb` — all three failed with `Missing key at ["files"]`.
 */
/**
 * THE ADDRESS MUST PASS THE TOOL'S OWN SCHEMA (plan F6) — AND, SINCE H6, IT RIDES IN A BATCH ENTRY.
 *
 * F4 was proven through `replaceRange` — one layer BELOW the call a caller actually makes — so the address
 * LOGIC was green while `Parameters` still demanded `oldString`, the very parameter the address branch throws
 * away. Every F4 case called the helper; none decoded the schema the runtime decodes (`tool/tool.ts:115`
 * compiles `Schema.decodeUnknownEffect(toolInfo.parameters)` per tool), and the defect survived until a LIVE
 * probe hit it on a real binary: `SchemaError(Missing key at ["oldString"])` for a call carrying
 * `from`/`to`/`expect`.
 *
 * H6 then moved the surface: the address rides on an ENTRY (`files[]`), not at the top level. These cases were
 * re-pinned to that shape — the same THREE sides, none dropped: an entry carrying addresses decodes; `content`
 * alone decodes; and NEITHER decodes HERE, because the schema does not decide it — the tool's own guard does,
 * with a message a caller can act on.
 */
describe("tool.edit — the TOOL's schema carries the batch, and the address rides in an entry", () => {
  const decode = Schema.decodeUnknownSync(Parameters)

  test("an entry carrying a list of addresses decodes — the shape `read` feeds", () => {
    expect(() =>
      decode({ files: [{ filePath: "x.txt", edits: [{ insertAfter: "00000000", newString: "NEW" }] }] }),
    ).not.toThrow()
    expect(() =>
      decode({
        files: [{ filePath: "x.txt", edits: [{ fromHash: "a3f19c2e", toHash: "b7c1d0e4", newString: "NEW" }] }],
      }),
    ).not.toThrow()
  })

  test("`content` alone decodes — creating a file has no lines to address", () => {
    expect(() => decode({ files: [{ filePath: "x.txt", content: "hello\n" }] })).not.toThrow()
  })

  test("the schema does NOT decide `neither` — the tool's own guard does, naming both doors", () => {
    // Deliberate, exactly as under F6: a SchemaError cannot say «pass `edits` — or `content` to create a file»,
    // and that message is the one a caller can act on.
    expect(() => decode({ files: [{ filePath: "x.txt" }] })).not.toThrow()
  })
})

/**
 * THE EDIT LIST, RESOLVED THEN APPLIED (plan 2026-10-01_hash-addressed-edits, H3/H4).
 *
 * The addresses here are built the SAME way `read` prints them — the chain over the file — so the test states
 * the contract a caller actually meets rather than a private spelling of it. Two hashes name a span; anything
 * that does not resolve is a REFUSAL, and nothing lands near its address.
 */
describe("tool.edit — a list of addresses, resolved then applied", () => {
  const labels = (content: string) => {
    const out = [hashLabel(0)]
    let running = 0
    for (const line of content.split("\n")) out.push(hashLabel((running = chainHash(running, line))))
    return out
  }

  test("replaces a span by its two hashes and leaves the rest byte-identical", () => {
    const content = "alpha\nbeta\ngamma\ndelta\n"
    const h = labels(content)
    // INCLUSIVE (plan 2026-10-04_edit-inclusive-span): `fromHash` is the span's FIRST line, `toHash` its LAST —
    // the hashes `read` prints beside the very lines being changed. Lines 2..3 here.
    expect(resolveEdits(content, [{ fromHash: h[2]!, toHash: h[3]!, newString: "X" }])).toBe("alpha\nX\ndelta\n")
  })

  test("`toHash` absent means ONE line — the line whose own hash is `fromHash`", () => {
    const content = "alpha\nbeta\n"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[1]!, newString: "FIRST" }])).toBe("FIRST\nbeta\n")
    expect(resolveEdits(content, [{ fromHash: h[2]!, newString: "SECOND" }])).toBe("alpha\nSECOND\n")
  })

  test("REGRESSION 2026-10-04: `toHash` equal to `fromHash` REPLACES that line — it never inserts beside it", () => {
    // The ClientSoft robots passed `fromHash = toHash = X` meaning «from X to X» and got X twice (the old
    // contract read it as an insertion). The natural reading is now the contract.
    const content = "a\nb\nc\n"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[2]!, toHash: h[2]!, newString: "b\nb2" }])).toBe("a\nb\nb2\nc\n")
  })

  test("REGRESSION 2026-10-04: the hash printed beside a line changes THAT line, never its neighbour", () => {
    // The shader case: the robot passed the hashes beside the line it meant and the old contract (line BEFORE
    // the span) deleted the line above. Here the span 2..2 is named by line 2's own hash and line 1 survives.
    const content = "vec3 c;\nfloat l=0.35;\no=c*l;\n"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[2]!, newString: "float l=0.55;" }])).toBe(
      "vec3 c;\nfloat l=0.55;\no=c*l;\n",
    )
  })

  test("the seed `00000000` is no line — as `fromHash` it is refused, pointing at `insertAfter`", () => {
    expect(() => resolveEdits("alpha\n", [{ fromHash: "00000000", newString: "X" }])).toThrow(/insertAfter/)
  })

  test("an entry is a span OR an insertion: both or neither is refused, naming the two forms", () => {
    const h = labels("alpha\n")
    expect(() => resolveEdits("alpha\n", [{ fromHash: h[1]!, insertAfter: h[1]!, newString: "X" }])).toThrow(
      /fromHash.*insertAfter|insertAfter.*fromHash/,
    )
    expect(() => resolveEdits("alpha\n", [{ newString: "X" }])).toThrow(/fromHash.*insertAfter|insertAfter.*fromHash/)
  })

  test("the whole point: identical lines are addressable INDIVIDUALLY", () => {
    const content = "same\nsame\nsame\n"
    const h = labels(content)
    // Line 2 is named by LINE 2's own label — the chain makes it unique although its text is not.
    expect(resolveEdits(content, [{ fromHash: h[2]!, newString: "MIDDLE" }])).toBe("same\nMIDDLE\nsame\n")
    // Both halves of the owner's «хеш старта хеш конца»: the pair names the same single line explicitly.
    expect(resolveEdits(content, [{ fromHash: h[2]!, toHash: h[2]!, newString: "MIDDLE" }])).toBe(
      "same\nMIDDLE\nsame\n",
    )
    // …while the two neighbours — IDENTICAL to it — stay untouched, which a content anchor could never do.
  })

  test("a hash that is not in the file is a REFUSAL — never a nearby landing", () => {
    expect(() => resolveEdits("alpha\nbeta\n", [{ fromHash: "deadbeef", newString: "X" }])).toThrow(/not in this file/)
  })

  test("a malformed hash is refused, and the refusal names the entry", () => {
    expect(() => resolveEdits("alpha\n", [{ fromHash: "DEADBEEF", newString: "X" }])).toThrow(/edit 1/)
  })

  test("two entries claiming one line are refused, not ordered by luck", () => {
    const content = "alpha\nbeta\n"
    const h = labels(content)
    expect(() =>
      resolveEdits(content, [
        { fromHash: h[1]!, newString: "A" },
        { fromHash: h[1]!, newString: "B" },
      ]),
    ).toThrow(/claim line/)
  })

  test("given its target, every refusal NAMES the file — the address refusal and the clash alike", () => {
    // Plan 2026-10-01_edit-refusal-names-its-target, R1: the builder carries the file, so no refusal can forget it.
    const content = "alpha\nbeta\n"
    const h = labels(content)
    expect(() => resolveEdits(content, [{ fromHash: "deadbeef", newString: "X" }], "\n", "src/x.ts")).toThrow(
      /^src\/x\.ts: edit 1: `fromHash` is not in this file/,
    )
    expect(() =>
      resolveEdits(
        content,
        [
          { fromHash: h[1]!, newString: "A" },
          { fromHash: h[1]!, newString: "B" },
        ],
        "\n",
        "src/x.ts",
      ),
    ).toThrow(/^src\/x\.ts: two edits claim line 1/)
  })

  test("ALL entries resolve BEFORE any is applied — a later span is not moved by an earlier edit", () => {
    const content = "one\ntwo\nthree\n"
    const h = labels(content)
    // Entry 1 rewrites line 2 with TWO lines; entry 2 still addresses line 3 by ITS ORIGINAL hash. Applied
    // top-down, entry 2 would land one line late — which is exactly the failure this order removes.
    expect(
      resolveEdits(content, [
        { fromHash: h[2]!, newString: "SECOND-A\nSECOND-B" },
        { fromHash: h[3]!, newString: "THIRD" },
      ]),
    ).toBe("one\nSECOND-A\nSECOND-B\nTHIRD\n")
  })
})

/**
 * THE SPAN'S EDGES (plan H9c). Owner, 2026-10-01: «от хеша - до хеша вставляем что отправил агент», with the
 * agent's endings fitted to the file's, and the final terminator «проверить как было в оригинале и не
 * выдумывать». Every case below was measured WRONG before this change (experiments/2026-10-01_chain-review):
 * `""` left a blank line, a trailing `\n` added one, and an append either was refused or ate the final newline.
 */
describe("tool.edit — the span's edges: deletion, the final terminator, insertion, endings", () => {
  const labels = (content: string) => {
    const out = [hashLabel(0)]
    let running = 0
    for (const line of content.split("\n")) out.push(hashLabel((running = chainHash(running, line.replace(/\r$/, "")))))
    return out
  }

  test("an empty `newString` DELETES the span — no blank line is left behind", () => {
    const content = "a\nb\nc\n"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[2]!, newString: "" }])).toBe("a\nc\n")
    expect(resolveEdits(content, [{ fromHash: h[1]!, toHash: h[3]!, newString: "" }])).toBe("")
    // Deleting an UNTERMINATED last line keeps the file's final form: it still ends without a terminator.
    const bare = "a\nb"
    expect(resolveEdits(bare, [{ fromHash: labels(bare)[2]!, newString: "" }])).toBe("a")
  })

  test("ONE trailing terminator is the last line's own: «B» and «B\\n» are the same line, «\\n» is a blank one", () => {
    const content = "a\nb\nc\n"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[2]!, newString: "B\n" }])).toBe("a\nB\nc\n")
    expect(resolveEdits(content, [{ fromHash: h[2]!, newString: "B" }])).toBe("a\nB\nc\n")
    expect(resolveEdits(content, [{ fromHash: h[2]!, newString: "\n" }])).toBe("a\n\nc\n")
  })

  test("the ORIGINAL decides the final terminator — an unterminated last line stays unterminated", () => {
    const content = "a\nb"
    const h = labels(content)
    expect(resolveEdits(content, [{ fromHash: h[2]!, newString: "B\n" }])).toBe("a\nB")
  })

  test("`insertAfter` is the EMPTY span after that line: an insertion; the seed inserts before line 1", () => {
    const content = "a\nc\n"
    const h = labels(content)
    expect(resolveEdits(content, [{ insertAfter: h[1]!, newString: "b" }])).toBe("a\nb\nc\n")
    expect(resolveEdits(content, [{ insertAfter: h[0]!, newString: "first" }])).toBe("first\na\nc\n")
  })

  test("appending after the LAST line keeps the file's own final form, terminated or not", () => {
    const terminated = "a\nb\n"
    const t = labels(terminated)
    expect(resolveEdits(terminated, [{ insertAfter: t[2]!, newString: "c" }])).toBe("a\nb\nc\n")
    const bare = "a\nb"
    const b = labels(bare)
    expect(resolveEdits(bare, [{ insertAfter: b[2]!, newString: "c" }])).toBe("a\nb\nc")
    // A ONE-line file without any break has no ending to copy — and the append must still not GLUE the lines.
    const single = "a"
    const s = labels(single)
    expect(resolveEdits(single, [{ insertAfter: s[1]!, newString: "c" }])).toBe("a\nc")
  })

  test("the address cannot reach past the last line: no phantom line after the final terminator", () => {
    const content = "a\nb\n"
    const h = labels(content)
    // h[3] is the label of the phantom "" after the final terminator — `read` prints no such line.
    expect(() => resolveEdits(content, [{ fromHash: h[3]!, newString: "c" }])).toThrow(/not in this file/)
  })

  test("an empty file takes an insertion at the seed, written as sent — there is no original to copy", () => {
    expect(resolveEdits("", [{ insertAfter: "00000000", newString: "x\n" }])).toBe("x\n")
  })

  test("the agent's endings are fitted to the file's MAJORITY ending; the last line keeps the original's", () => {
    const crlf = "a\r\nb\r\n"
    const c = labels(crlf)
    expect(resolveEdits(crlf, [{ fromHash: c[1]!, newString: "X\nY" }])).toBe("X\r\nY\r\nb\r\n")
    // Mostly LF with one CRLF line: the new internal break is LF, and the replaced line's own CRLF survives.
    const mixed = "a\r\nb\nc\nd\n"
    const m = labels(mixed)
    expect(resolveEdits(mixed, [{ fromHash: m[1]!, newString: "X\r\nY" }])).toBe("X\nY\r\nb\nc\nd\n")
  })

  test("two insertions at one point, or an insertion where a span starts, are refused — no defined order", () => {
    const content = "a\nb\n"
    const h = labels(content)
    expect(() =>
      resolveEdits(content, [
        { insertAfter: h[1]!, newString: "x" },
        { insertAfter: h[1]!, newString: "y" },
      ]),
    ).toThrow(/claim line/)
    expect(() =>
      resolveEdits(content, [
        { insertAfter: h[1]!, newString: "x" },
        { fromHash: h[2]!, newString: "B" },
      ]),
    ).toThrow(/claim line/)
  })

  test("a `toHash` ABOVE `fromHash` is still an inverted range", () => {
    const content = "a\nb\nc\n"
    const h = labels(content)
    expect(() => resolveEdits(content, [{ fromHash: h[3]!, toHash: h[2]!, newString: "x" }])).toThrow(/inverted/)
  })
})

/**
 * THE RESULT IS AN ADDRESS SOURCE (plan 2026-10-09_edit-address-report).
 *
 * The chain runs over the whole prefix, so the edit that just landed moved every label below it — before this
 * report, continuing to edit meant re-reading (`plans_completed/2026-10-01_hash-addressed-edits.md` made that
 * mandatory by construction). The property asserted here is the one that removes the re-read: the labels the
 * report prints are the labels `edit` ACCEPTS next.
 */
describe("tool.edit — the report hands back the fresh addresses", () => {
  const labels = (content: string) => {
    const out = [hashLabel(0)]
    let running = 0
    for (const line of content.split("\n")) out.push(hashLabel((running = chainHash(running, line))))
    return out
  }
  const report = (
    oldText: string,
    finalText: string,
    spans: { start: number; end: number }[],
    created = false,
    budget?: number,
  ) => addressReport({ path: "x.txt", oldText, finalText, spans, created, formatTouched: false }, budget)

  test("the written line is echoed with its CURRENT label, and every moved label below is restated", () => {
    const oldText = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n"
    const finalText = "l1\nl2\nNEW\nl4\nl5\nl6\nl7\nl8\n"
    const h = labels(finalText)
    const out = report(oldText, finalText, [{ start: 2, end: 2 }])
    // `read`'s own shape, carrying the FINAL text's label — not the old one.
    expect(out).toContain(`3  ${h[3]!}: NEW`)
    // Below the change the chain moved every label: 3..8 are restated.
    expect(out.split("\n")).toContain(`3  ${h[3]!}`)
    expect(out.split("\n")).toContain(`8  ${h[8]!}`)
    // Above it nothing moved — line 1's label never appears in the bare `N  hash` form the map uses.
    expect(out.split("\n")).not.toContain(`1  ${h[1]!}`)
  })

  test("ACCEPTANCE: the label printed by the report resolves in the very next edit", () => {
    const oldText = "alpha\nbeta\ngamma\ndelta\n"
    const finalText = "alpha\nBETA-1\nBETA-2\ngamma\ndelta\n"
    const out = report(oldText, finalText, [{ start: 1, end: 1 }])
    const line = out.split("\n").find((l) => l.endsWith(": gamma"))
    expect(line).toBeDefined()
    const hash = line!.match(/^\d+\s+([0-9a-f]{8}): /)![1]!
    // No re-read anywhere: the report's own label IS the address.
    expect(resolveEdits(finalText, [{ fromHash: hash, newString: "GAMMA" }])).toBe("alpha\nBETA-1\nBETA-2\nGAMMA\ndelta\n")
  })

  test("the map starts at the FIRST moved line — a change at the top restates everything below it", () => {
    const oldText = "one\ntwo\nthree\nfour\nfive\nsix\n"
    const finalText = "ONE\ntwo\nthree\nfour\nfive\nsix\n"
    const h = labels(finalText)
    const out = report(oldText, finalText, [{ start: 0, end: 0 }])
    expect(out.split("\n")).toContain(`1  ${h[1]!}`)
    expect(out.split("\n")).toContain(`6  ${h[6]!}`)
  })

  test("CRLF and LF hash their lines identically — the report carries no carriage returns", () => {
    const h = labels("a\nB\nc\n")
    const out = report("a\r\nb\r\nc\r\n", "a\r\nB\r\nc\r\n", [{ start: 1, end: 1 }])
    expect(out).not.toContain("\r")
    expect(out).toContain(`2  ${h[2]!}: B`)
    expect(out).toContain(`3  ${h[3]!}`)
  })

  test("a cut is NAMED — the footer gives the offset to `read` for the rest", () => {
    const oldText = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") + "\n"
    const finalText = oldText.replace("line 1\n", "LINE 1\n")
    const out = report(oldText, finalText, [{ start: 0, end: 0 }], false, 220)
    expect(out).toContain("`read` from offset")
    expect(out).toContain("carry new labels too")
  })

  test("a created file's report IS the whole file — every line in `read`'s shape", () => {
    const finalText = "one\ntwo\n"
    const h = labels(finalText)
    const out = report("", finalText, [], true)
    expect(out).toContain("created")
    expect(out).toContain(`1  ${h[1]!}: one`)
    expect(out).toContain(`2  ${h[2]!}: two`)
  })

  test("a deletion echoes the seam and restates what follows it", () => {
    const h = labels("a\nd\n")
    // The APPLIED span of a deletion is an empty range at the seam (end < start), as `resolveAddresses` returns it.
    const out = report("a\nb\nc\nd\n", "a\nd\n", [{ start: 1, end: 0 }])
    expect(out).toContain(`1  ${h[1]!}: a`)
    expect(out.split("\n")).toContain(`2  ${h[2]!}`)
  })

  test("an all-deleted file says so instead of printing nothing", () => {
    expect(report("a\n", "", [])).toContain("now empty")
  })
})
