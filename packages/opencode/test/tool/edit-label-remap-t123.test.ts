import { describe, expect, test } from "bun:test"
import { addressReport, resolveAddresses } from "../../src/tool/edit"
import { chainHash, hashLabel } from "../../src/tool/read"

// t123 slice 2 — after an edit, the report gives the new label of every changed line it knows.
// Miniature of the live 13:47:45 -> 14:01:33 stale-hash sequence (watch3.py, t118):
// a batch changes an early line, the report must map every moved old label to its new one,
// so the next edit can address a moved line by the label it knew. RED before the map exists.
// Addendum 2: only labels still in the active window are listed (windowLabels input);
// addendum 3: the function is pure — history is never rewritten.

const labels = (content: string): string[] => {
  const lines = content.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  const out = [hashLabel(0)]
  let running = 0
  for (const line of lines) out.push(hashLabel((running = chainHash(running, line.replace(/\r$/, "")))))
  return out
}

const edited = (content: string, edits: Parameters<typeof resolveAddresses>[1]) => {
  const resolution = resolveAddresses(content, edits)
  if (resolution.kind === "refused") throw new Error(resolution.refusals.join("\n"))
  return resolution
}

/** old-label -> "N newhash" | "deleted", parsed from the report's map lines. */
const parseMap = (report: string): Map<string, string> => {
  const map = new Map<string, string>()
  for (const line of report.split("\n")) {
    const m = line.match(/^(?:(\d+) +)?([0-9a-f]{8}) -> (?:(\d+) ([0-9a-f]{8})|(deleted))$/)
    if (m) map.set(m[2]!, m[5] ? "deleted" : `${m[3]} ${m[4]}`)
  }
  return map
}

const reportFor = (
  content: string,
  edits: Parameters<typeof resolveAddresses>[1],
  window?: Set<string>,
) => {
  const resolution = edited(content, edits)
  return addressReport({
    path: "mini.txt",
    oldText: content,
    finalText: resolution.text,
    spans: resolution.spans,
    origSpans: resolution.origSpans,
    windowLabels: window,
    created: false,
    formatTouched: false,
  })
}

describe("t123 old-to-new label map", () => {
  const allWindow = (h: string[]) => new Set(h.slice(1))

  test("(a) replace line 1 of 8: all 7 moved labels map, replaced line maps to deleted", () => {
    const content = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n"
    const h = labels(content)
    const report = reportFor(content, [{ fromHash: h[1]!, newString: "R1" }], allWindow(h))
    const map = parseMap(report)
    expect(map.size).toBe(8)
    expect(map.get(h[1]!)).toBe("deleted")
    const want = labels("R1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n")
    for (let line = 2; line <= 8; line++) {
      expect(map.get(h[line]!)).toBe(`${line} ${want[line]!}`)
    }
  })

  test("(b) insert after line 3: lines below shift by one and map to their new labels", () => {
    const content = "l1\nl2\nl3\nl4\nl5\nl6\n"
    const h = labels(content)
    const report = reportFor(content, [{ insertAfter: h[3]!, newString: "INS" }], allWindow(h))
    const map = parseMap(report)
    const want = labels("l1\nl2\nl3\nINS\nl4\nl5\nl6\n")
    // Inserted content is echoed, not mapped; the 3 lines below the gap move down one.
    expect(map.size).toBe(3)
    expect(map.get(h[4]!)).toBe(`5 ${want[5]!}`)
    expect(map.get(h[5]!)).toBe(`6 ${want[6]!}`)
    expect(map.get(h[6]!)).toBe(`7 ${want[7]!}`)
  })

  test("(c) delete line 2: it maps to deleted, lines below map to their shifted labels", () => {
    const content = "l1\nl2\nl3\nl4\nl5\n"
    const h = labels(content)
    const report = reportFor(content, [{ fromHash: h[2]!, toHash: h[2]!, newString: "" }], allWindow(h))
    const map = parseMap(report)
    expect(map.size).toBe(4)
    const want = labels("l1\nl3\nl4\nl5\n")
    expect(map.get(h[2]!)).toBe("deleted")
    expect(map.get(h[3]!)).toBe(`2 ${want[2]!}`)
    expect(map.get(h[4]!)).toBe(`3 ${want[3]!}`)
    expect(map.get(h[5]!)).toBe(`4 ${want[4]!}`)
  })

  test("(d) window subset: an in-window moved label is listed, an out-of-window one is not", () => {
    const content = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n"
    const h = labels(content)
    const window = new Set([h[3]!, h[5]!])
    const report = reportFor(content, [{ fromHash: h[1]!, newString: "R1" }], window)
    const map = parseMap(report)
    const want = labels("R1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n")
    expect(map.size).toBe(2)
    expect(map.get(h[3]!)).toBe(`3 ${want[3]!}`)
    expect(map.get(h[5]!)).toBe(`5 ${want[5]!}`)
    expect(map.has(h[2]!)).toBe(false)
    expect(map.has(h[1]!)).toBe(false)
  })

  test("(e) the report is pure: inputs untouched, repeat call byte-identical", () => {
    const content = "l1\nl2\nl3\n"
    const h = labels(content)
    const resolution = edited(content, [{ fromHash: h[1]!, newString: "R1" }])
    const input = {
      path: "mini.txt",
      oldText: content,
      finalText: resolution.text,
      spans: resolution.spans,
      origSpans: resolution.origSpans,
      created: false as const,
      formatTouched: false as const,
    }
    const before = JSON.stringify({ ...input, spans: input.spans, origSpans: input.origSpans })
    const first = addressReport(input)
    const second = addressReport(input)
    expect(first).toBe(second)
    expect(JSON.stringify({ ...input, spans: input.spans, origSpans: input.origSpans })).toBe(before)
  })
})
