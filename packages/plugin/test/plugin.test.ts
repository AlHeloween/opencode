/**
 * Tests for the OpenCode plugin system API.
 *
 * These tests verify plugin lifecycle: loading, hook execution,
 * tool registration, and provider/auth hooks.
 *
 * Run: bun test
 */
import { describe, test, expect } from "bun:test"

describe("plugin loading", () => {
  test.todo("loads a plugin from a directory", () => {
    // TOOD: create temp plugin dir, verify Plugin function called
  })

  test.todo("loads a plugin from an npm package", () => {
    // TOOD: mock npm resolution, verify import works
  })

  test.todo("handles plugin load failure gracefully", () => {
    // TOOD: verify error logged, remaining plugins loaded
  })
})

describe("plugin hooks", () => {
  test.todo("executes provider hook during model resolution", () => {
    // TOOD: register plugin with ProviderHook, verify hook called
  })

  test.todo("executes auth hook for token retrieval", () => {
    // TOOD: register plugin with AuthHook, verify token injected
  })

  test.todo("executes workspace adaptor hook", () => {
    // TOOD: verify adaptor registered and used
  })
})

describe("tool registration", () => {
  test.todo("registers a custom tool from a plugin", () => {
    // TOOD: verify tool appears in registry
  })

  test.todo("validates tool args with Zod schema", () => {
    // TOOD: verify invalid args rejected
  })
})
