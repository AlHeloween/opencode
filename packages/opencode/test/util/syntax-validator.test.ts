import { describe, expect, test } from "bun:test"
import { validateCodeSyntax } from "../../src/util/syntax-validator"

describe("validateCodeSyntax", () => {
  // ── Python ──────────────────────────────────────────────────────────
  test("rejects Python with syntax error (fused variable)", async () => {
    const content = `#!/usr/bin/env python3
import requests

BASE = "http://localhost:30002"
PASSWORD (http://localhost:30002"
PASSWORD) = "bad"
`
    const err = await validateCodeSyntax("script.py", content)
    expect(err).not.toBeNull()
    expect(err!.line).toBeGreaterThanOrEqual(3)
    expect(err!.message).toContain("Syntax error")
  })

  test("accepts valid Python", async () => {
    const content = `#!/usr/bin/env python3
import requests

BASE = "http://localhost:30002"
PASSWORD = "secret"

def login():
    return requests.post(f"{BASE}/api/login", json={"password": PASSWORD})
`
    const err = await validateCodeSyntax("script.py", content)
    expect(err).toBeNull()
  })

  test("detects line:col in broken Python", async () => {
    const content = "def foo(\n"
    const err = await validateCodeSyntax("test.py", content)
    expect(err).not.toBeNull()
    expect(err!.line).toBeGreaterThanOrEqual(1)
    expect(err!.col).toBeGreaterThanOrEqual(1)
  })

  // ── TypeScript ──────────────────────────────────────────────────────
  test("rejects TypeScript with syntax error (gibberish token)", async () => {
    const content = `const x = "hello"
@#$%^
function ok() {
  return x
}
`
    const err = await validateCodeSyntax("app.ts", content)
    expect(err).not.toBeNull()
    expect(err!.message).toContain("Syntax error")
  })

  test("accepts valid TypeScript", async () => {
    const content = `const x: string = "hello"
function ok(): string {
  return x
}
`
    const err = await validateCodeSyntax("app.ts", content)
    expect(err).toBeNull()
  })

  // ── JavaScript ──────────────────────────────────────────────────────
  test("accepts valid JavaScript", async () => {
    const content = `const x = "hello"
function ok() {
  return x
}
`
    const err = await validateCodeSyntax("app.js", content)
    expect(err).toBeNull()
  })

  // ── Shell ───────────────────────────────────────────────────────────
  test("accepts valid shell script", async () => {
    const content = `#!/bin/bash
echo "hello"
ls -la
`
    const err = await validateCodeSyntax("script.sh", content)
    expect(err).toBeNull()
  })

  // ── Edge cases ──────────────────────────────────────────────────────
  test("returns null for unhandled extensions", async () => {
    const err = await validateCodeSyntax("file.md", "# broken markdown [")
    expect(err).toBeNull() // markdown not validated
  })

  test("returns null for no extension", async () => {
    const err = await validateCodeSyntax("Makefile", "all:\n\techo hi")
    expect(err).toBeNull()
  })

  test("empty content passes", async () => {
    const err = await validateCodeSyntax("empty.py", "")
    expect(err).toBeNull()
  })
})
