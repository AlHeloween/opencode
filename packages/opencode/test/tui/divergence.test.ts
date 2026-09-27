import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findDivergence } from "../../src/cli/cmd/tui/util/divergence"
import { createDivergenceReporter } from "../../src/cli/cmd/tui/util/divergence-reporter"

const ev = (messageID: string, type = "message.part.updated") => ({ messageID, type })

describe("render divergence", () => {
  test("THE BUG: an arrived id that is not drawn is reported", () => {
    const record = findDivergence(
      { drawn: new Set(), arrived: new Set(["msg_1"]), exempt: () => undefined },
      ev("msg_1"),
    )
    expect(record?.kind).toBe("hidden")
    expect(record?.messageID).toBe("msg_1")
    // The evidence, not the verdict: the reader gets ids to look up.
    expect(record?.drawn).toEqual([])
    expect(record?.arrived).toEqual(["msg_1"])
  })

  test("an id that IS drawn is silent", () => {
    expect(findDivergence({ drawn: new Set(["msg_1"]), arrived: new Set(["msg_1"]) }, ev("msg_1"))).toBeUndefined()
  })

  test("AN ID THAT NEVER ARRIVED IS NOT OURS — and the silence is the finding", () => {
    // The honest limit, asserted so it stays a limit: if the transport dropped
    // the event, ARRIVED is empty too and this oracle says nothing. `arrived: []`
    // in the record is what lets a reader tell that apart from "nothing checked".
    const record = findDivergence({ drawn: new Set(), arrived: new Set(), exempt: () => undefined }, ev("msg_1"))
    expect(record).toBeUndefined()
  })

  test("an exempt id is named, not hidden — a filter that is CORRECT must not cry wolf", () => {
    // The revert run is the case that bit us: hiding a run is the product's job.
    const record = findDivergence(
      {
        drawn: new Set(),
        arrived: new Set(["msg_1"]),
        exempt: (id) => (id === "msg_1" ? "reverted run" : undefined),
      },
      ev("msg_1"),
    )
    expect(record?.kind).toBe("exempt")
    expect(record?.reason).toBe("reverted run")
  })

  test("the evidence is BOUNDED, because one bad event must not write 800 ids", () => {
    // The hidden id must NOT be among the drawn ones, or there is no divergence
    // to report — which is exactly what happened on the first version of this
    // test: I picked `m0`, which the list contains, and then the assertion below
    // checked a length on `undefined`. A test that stops testing without saying
    // so is worse than no test, so the id is chosen from outside the list.
    const drawn = Array.from({ length: 500 }, (_, i) => `m${i}`)
    const record = findDivergence(
      { drawn: new Set(drawn), arrived: new Set(["m999"]), max: 10 },
      ev("m999"),
    )
    expect(record?.kind).toBe("hidden")
    expect(record?.drawn).toHaveLength(10)
    expect(record?.arrived).toHaveLength(1)
  })
})

describe("the reporter survives the restart", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const file = () => {
    const dir = mkdtempSync(join(tmpdir(), "div-"))
    dirs.push(dir)
    return join(dir, "nested", "divergence.jsonl")
  }

  test("a hidden id is APPENDED to disk and survives the reporter", () => {
    // The workaround for the bug is a restart, so the evidence must outlive the
    // process that observed it. A reporter that only held it in memory would
    // have been useless on the morning it was written.
    const f = file()
    const reporter = createDivergenceReporter(f)
    const first = reporter.report({ drawn: new Set(), arrived: new Set(["msg_1"]), exempt: () => undefined, event: ev("msg_1") })
    expect(first?.kind).toBe("hidden")
    // A second observer on a LATER event appends rather than replacing.
    reporter.report({ drawn: new Set(), arrived: new Set(["msg_1", "msg_2"]), exempt: () => undefined, event: ev("msg_2") })
    const lines = readFileSync(f, "utf8").trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).messageID).toBe("msg_1")
    expect(JSON.parse(lines[1]!).messageID).toBe("msg_2")
    expect(reporter.path).toBe(f)
  })

  test("an exempt id is NOT written — the file stays a record of failures", () => {
    const f = file()
    const reporter = createDivergenceReporter(f)
    reporter.report({ drawn: new Set(), arrived: new Set(["msg_1"]), exempt: () => "reverted run", event: ev("msg_1") })
    expect(() => readFileSync(f, "utf8")).toThrow()
  })

  test("a drawn id writes nothing, and `seen` still records that it was checked", () => {
    // The difference between "never fired" and "was never given input" is the
    // difference between a pass and an unknown.
    const f = file()
    const reporter = createDivergenceReporter(f)
    reporter.report({ drawn: new Set(["msg_1"]), arrived: new Set(["msg_1"]), event: ev("msg_1") })
    expect(() => readFileSync(f, "utf8")).toThrow()
    expect([...reporter.seen]).toEqual(["msg_1"])
  })

  test("a reporter pointed at an unwritable path does not throw", () => {
    // A debugger that can take the session down is worse than no debugger: this
    // is called from inside the TUI's event subscription.
    const reporter = createDivergenceReporter(join("Z:\\", "definitely", "not", "writable.jsonl"))
    expect(() =>
      reporter.report({ drawn: new Set(), arrived: new Set(["m"]), exempt: () => undefined, event: ev("m") }),
    ).not.toThrow()
  })
})
