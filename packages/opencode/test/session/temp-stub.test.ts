/**
 * TEMP IS AN ADDRESS, NEVER A PAYLOAD (owner, 2026-09-22): «temp стафф не входит ни в компакт ни в
 * summary, в tail они обозначаются как temp и просто пишутся семантические вектора и ссылка на
 * сообщение для чтения если есть на то охота. Темп на то он и темп.», and the rule behind it: «у нас
 * вообще ничего не выбрасывается просто кое где сворачивается до наших семантических векторов с
 * ссылками.»
 *
 * WHY the pin matters more than it looks: the fold is assembled from DB rows, and a release only MARKS a
 * hold released — so without the collapse the payload of a held piece rides into m* anyway, which is the
 * one thing the declared-lifetime mechanism exists to prevent. The two properties below are the whole
 * contract: the stub RENDERS instead of the payload, and the stub is what the BUDGET measures (a budget
 * that measured the payload would refuse a message the renderer carries in a few hundred chars).
 */
import { describe, expect, test } from "bun:test"
import { selectRecentTail, tailMessageText } from "../../src/session/compaction"
import type { MessageV2 } from "../../src/session/message-v2"

const hex = (c: string) => c.repeat(32)

const heldMessage = (payload: string) =>
  ({
    info: { id: "msg_held", role: "assistant" },
    parts: [
      {
        id: "prt_text",
        type: "text",
        text: `work\n\ndominant: "the held epoch"\n\nKeywords: temp 0.7, address 0.3\nmd5: ${hex("a")}\nprev-md5: ${hex("b")}\nparent-goal-md5: ${hex("0")}`,
      },
      {
        id: "prt_big",
        type: "tool",
        tool: "read",
        callID: "call_1",
        ttlUntil: 9,
        state: { status: "completed", output: payload, input: { filePath: "big.ts" }, time: { start: 0, end: 1 }, title: "big.ts" },
      },
    ],
  }) as unknown as MessageV2.WithParts

const newest = { info: { id: "msg_new", role: "user" }, parts: [{ id: "prt_new", type: "text", text: "newest" }] } as unknown as MessageV2.WithParts

describe("a held piece in the tail", () => {
  test("renders as temp with its vector, its chain and both addresses — never its payload", () => {
    const rendered = tailMessageText(heldMessage("x".repeat(400_000)))
    expect(rendered).toContain("[temp:read: big.ts]")
    expect(rendered).toContain('dominant: "the held epoch"')
    expect(rendered).toContain("kw: temp 0.7, address 0.3")
    // The md5 sequence survives the collapse: continuity is the chain, not the bytes.
    expect(rendered).toContain(`md5: ${hex("a")}`)
    expect(rendered).toContain(`prev-md5: ${hex("b")}`)
    // Both ways back: the message, and the part `recall` takes.
    expect(rendered).toContain("message: msg_held")
    expect(rendered).toContain("recall(id=prt_big)")
    // And the payload itself is nowhere in the render.
    expect(rendered).not.toContain("xxxx")
  })

  test("does not spend the tail budget: the STUB is measured, so the message fits", () => {
    const tail = selectRecentTail([heldMessage("x".repeat(400_000)), newest], 32_768)
    // 400k chars would be ~100k tokens on its own — over the whole ceiling. It fits because what is
    // measured is what is rendered.
    expect(tail.map((m) => m.info.id as string)).toEqual(["msg_held", "msg_new"])
  })

  test("a message with NO declared span still renders its payload — the rule is the span, not the tool", () => {
    const plain = {
      info: { id: "msg_plain", role: "assistant" },
      parts: [
        { id: "prt_t", type: "text", text: "work" },
        { id: "prt_o", type: "tool", tool: "read", callID: "c", state: { status: "completed", output: "PLAIN_PAYLOAD", input: {}, time: { start: 0, end: 1 } } },
      ],
    } as unknown as MessageV2.WithParts
    expect(tailMessageText(plain)).toContain("PLAIN_PAYLOAD")
    expect(tailMessageText(plain)).not.toContain("[temp:")
  })
})
