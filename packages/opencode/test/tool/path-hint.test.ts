import { describe, expect, test } from "bun:test"
import {
  directoryPathDescription,
  filePathDescription,
  pathFieldDescription,
} from "../../src/tool/path-hint"

describe("tool.path-hint", () => {
  test("prefers relative paths and forbids foreign user invention", () => {
    const d = filePathDescription("Path to the file to write")
    expect(d).toContain("Prefer a path relative")
    expect(d).toContain("Absolute paths are allowed only")
    expect(d).toContain("Do not invent foreign OS user paths")
    expect(d).toContain("Path to the file to write")
    // No "must be absolute" pressure (hallucination prior)
    expect(d.toLowerCase()).not.toContain("must be absolute")
  })

  test("directory and generic roles use same prior", () => {
    const dir = directoryPathDescription("Optional path to list")
    const generic = pathFieldDescription("Some path")
    expect(dir).toContain("Prefer a path relative")
    expect(generic).toContain("Prefer a path relative")
  })

  test("write/edit/read/ls/multiedit schemas include path prior", async () => {
    const { toJsonSchema } = await import("../../src/util/effect-zod")
    const { Parameters: Write } = await import("../../src/tool/write")
    const { Parameters: Edit } = await import("../../src/tool/edit")
    const { Parameters: Read } = await import("../../src/tool/read")
    const { Parameters: Ls } = await import("../../src/tool/ls")
    const { Parameters: Multi } = await import("../../src/tool/multiedit")

    for (const schema of [Write, Edit, Read, Multi]) {
      const js = toJsonSchema(schema) as { properties?: { filePath?: { description?: string } } }
      const desc = js.properties?.filePath?.description ?? ""
      expect(desc).toContain("Prefer a path relative")
      expect(desc.toLowerCase()).not.toContain("must be absolute")
    }
    const ls = toJsonSchema(Ls) as { properties?: { path?: { description?: string } } }
    expect(ls.properties?.path?.description ?? "").toContain("Prefer a path relative")
  })
})
