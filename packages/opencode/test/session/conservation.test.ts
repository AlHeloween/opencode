import { expect, test } from "bun:test"
import { partCount } from "../../src/session/conservation"
import { stripFloodReminderBlocks } from "../../src/session/message-v2"

/**
 * The cut reporter's own guard (owner directive 2026-09-29: «защита от любого резания, как минимум
 * в логах»). If the counters lie, the log lies — so the counting is pinned here, next to the gate
 * that uses it. `reportCut` itself writes nothing for dropped <= 0 (an unfired report stays honest).
 */

test("the flood gate keeps the gated-workflow reminder and counts exactly what it removed", () => {
  const keep = "<system-reminder>Gated workflow: State→SV→Plan→Implement→Oracle→Clean.</system-reminder>"
  const flood = `<system-reminder>${"x".repeat(500)}</system-reminder>`
  const input = `${flood}\n\nkeep me\n\n${keep}`

  const out = stripFloodReminderBlocks(input)
  expect(out.dropped).toBe(1)
  expect(out.bytes).toBe(flood.length)
  expect(out.text).toContain("Gated workflow")
  expect(out.text).toContain("keep me")
  expect(out.text).not.toContain("xxxx")
})

test("a text with nothing to strip reports zero, and the text is untouched", () => {
  const out = stripFloodReminderBlocks("plain output")
  expect(out.dropped).toBe(0)
  expect(out.bytes).toBe(0)
  expect(out.text).toBe("plain output")
})

test("partCount totals parts across messages, counting string content as one", () => {
  expect(partCount([{ content: [{}, {}] }, { content: "text" }, { content: [] }])).toBe(3)
})
