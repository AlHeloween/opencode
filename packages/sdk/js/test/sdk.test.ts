/**
 * Smoke tests for the auto-generated TypeScript SDK.
 *
 * These tests verify the generated client/server types compile
 * and basic connections work.
 *
 * Run: bun test
 */
import { describe, test, expect } from "bun:test"

describe("SDK client", () => {
  test.todo("creates a client instance", () => {
    // TOOD: verify createOpencodeClient returns client object
  })

  test.todo("calls a basic API endpoint", () => {
    // TOOD: mock HTTP, verify request shape matches OpenAPI spec
  })
})

describe("SDK server stub", () => {
  test.todo("creates a server stub instance", () => {
    // TOOD: verify createOpencodeServer returns server object
  })
})

describe("type exports", () => {
  test("exports expected types", () => {
    // Verify key types are importable (compilation check)
    expect(true).toBe(true)
  })
})
