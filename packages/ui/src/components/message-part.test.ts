import { describe, expect, test } from "bun:test"

// We test the structural key and sameGroups logic directly rather than
// importing module-internal functions. The same helpers are used in
// the production code in message-part.tsx.

type PartRef = {
  messageID: string
  partID: string
}

type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: "context"
      refs: PartRef[]
    }

function sameRef(a: PartRef, b: PartRef) {
  return a.messageID === b.messageID && a.partID === b.partID
}

function sameGroup(a: PartGroup, b: PartGroup) {
  if (a === b) return true
  if (a.key !== b.key) return false
  if (a.type !== b.type) return false
  if (a.type === "part") {
    if (b.type !== "part") return false
    return sameRef(a.ref, b.ref)
  }
  if (b.type !== "context") return false
  if (a.refs.length !== b.refs.length) return false
  return a.refs.every((ref, i) => sameRef(ref, b.refs[i]!))
}

function sameGroups(a: readonly PartGroup[] | undefined, b: readonly PartGroup[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((item, i) => sameGroup(item, b[i]!))
}

function structuralKey(items: { id: string; type: string }[]): string {
  return items.map((p) => `${p.id}:${p.type}`).join(";")
}

describe("message-part structural key", () => {
  test("same parts produce identical keys", () => {
    const parts = [
      { id: "p1", type: "text" },
      { id: "p2", type: "reasoning" },
      { id: "p3", type: "tool" },
    ]
    expect(structuralKey(parts)).toBe(structuralKey(parts))
  })

  test("parts in different order produce different keys", () => {
    const a = [
      { id: "p1", type: "text" },
      { id: "p2", type: "tool" },
    ]
    const b = [
      { id: "p2", type: "tool" },
      { id: "p1", type: "text" },
    ]
    expect(structuralKey(a)).not.toBe(structuralKey(b))
  })

  test("text content changes do not affect structural key", () => {
    // Structural key only uses id + type, not text content
    const key = structuralKey([{ id: "p1", type: "text" }])
    // Changing text doesn't change id or type
    expect(key).toBe("p1:text")
  })

  test("adding a part changes structural key", () => {
    const before = structuralKey([{ id: "p1", type: "text" }])
    const after = structuralKey([
      { id: "p1", type: "text" },
      { id: "p2", type: "tool" },
    ])
    expect(before).not.toBe(after)
  })

  test("empty parts array produces empty key", () => {
    expect(structuralKey([])).toBe("")
  })
})

describe("sameGroups structural equality", () => {
  function makePartRef(messageID: string, partID: string): PartRef {
    return { messageID, partID }
  }

  test("identical part groups are equal", () => {
    const a: PartGroup[] = [
      { key: "part:m1:p1", type: "part", ref: makePartRef("m1", "p1") },
      { key: "part:m1:p2", type: "part", ref: makePartRef("m1", "p2") },
    ]
    const b: PartGroup[] = [
      { key: "part:m1:p1", type: "part", ref: makePartRef("m1", "p1") },
      { key: "part:m1:p2", type: "part", ref: makePartRef("m1", "p2") },
    ]
    expect(sameGroups(a, b)).toBe(true)
  })

  test("different part counts are not equal", () => {
    const a: PartGroup[] = [{ key: "part:m1:p1", type: "part", ref: makePartRef("m1", "p1") }]
    const b: PartGroup[] = [
      { key: "part:m1:p1", type: "part", ref: makePartRef("m1", "p1") },
      { key: "part:m1:p2", type: "part", ref: makePartRef("m1", "p2") },
    ]
    expect(sameGroups(a, b)).toBe(false)
  })

  test("reordered part groups are not equal", () => {
    const a: PartGroup[] = [
      { key: "part:m1:p1", type: "part", ref: makePartRef("m1", "p1") },
      { key: "part:m1:p2", type: "part", ref: makePartRef("m1", "p2") },
    ]
    const b: PartGroup[] = [
      { key: "part:m1:p2", type: "part", ref: makePartRef("m1", "p2") },
      { key: "part:m1:p1", type: "part", ref: makePartRef("m1", "p1") },
    ]
    expect(sameGroups(a, b)).toBe(false)
  })

  test("context groups with identical refs are equal", () => {
    const a: PartGroup[] = [{ key: "context:p1", type: "context", refs: [makePartRef("m1", "p1"), makePartRef("m1", "p2")] }]
    const b: PartGroup[] = [{ key: "context:p1", type: "context", refs: [makePartRef("m1", "p1"), makePartRef("m1", "p2")] }]
    expect(sameGroups(a, b)).toBe(true)
  })

  test("context groups with different ref counts are not equal", () => {
    const a: PartGroup[] = [{ key: "context:p1", type: "context", refs: [makePartRef("m1", "p1")] }]
    const b: PartGroup[] = [{ key: "context:p1", type: "context", refs: [makePartRef("m1", "p1"), makePartRef("m1", "p2")] }]
    expect(sameGroups(a, b)).toBe(false)
  })
})
