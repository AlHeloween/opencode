import { describe, test, expect } from "bun:test"
import { Schema } from "effect"
import path from "path"

// t62 (plan 2026-10-15_local-ticket-write.md T1 RED): the fossilcell write verbs.
// Pure — no fossil binary, no service: schema literals + own/foreign helpers.

import { Parameters, ownRepoPath, isForeignProject } from "../../src/tool/fossilcell"

describe("fossilcell write verbs", () => {
  test("schema decodes ticketadd with title + optional comment/status", () => {
    const decoded = Schema.decodeUnknownSync(Parameters)({
      action: "ticketadd",
      title: "local probe",
      comment: "why",
      status: "Open",
    })
    expect(decoded.action).toBe("ticketadd")
  })

  test("schema decodes ticketset with uuid + fields", () => {
    const decoded = Schema.decodeUnknownSync(Parameters)({
      action: "ticketset",
      uuid: "aaaabbbbcc",
      status: "Fixed",
    })
    expect(decoded.action).toBe("ticketset")
  })

  test("read verbs still decode", () => {
    expect(Schema.decodeUnknownSync(Parameters)({ action: "tickets" }).action).toBe("tickets")
    expect(Schema.decodeUnknownSync(Parameters)({ action: "list" }).action).toBe("list")
  })
})

describe("own cell resolution", () => {
  test("ownRepoPath is the snapshot service's own fossilDir shape", () => {
    expect(ownRepoPath("D:/zPython/opencode", "4b0ea68d")).toBe(
      path.join("D:/zPython/opencode", ".opencode", "data", "fossil", "4b0ea68d", "snapshot.fsl"),
    )
  })

  test("isForeignProject: absent or own name (any case) is not foreign", () => {
    expect(isForeignProject(undefined, "opencode")).toBe(false)
    expect(isForeignProject("opencode", "opencode")).toBe(false)
    expect(isForeignProject("OpenCode", "opencode")).toBe(false)
  })

  test("isForeignProject: another project's name is foreign — write refused", () => {
    expect(isForeignProject("Smit", "opencode")).toBe(true)
  })
})
