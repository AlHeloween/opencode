import { test, expect } from "bun:test"
import path from "path"
import { DataPathsManager } from "./data-paths.js"
import { clearEnvCache } from "./env.js"

test("DataPathsManager validates appName", () => {
  const manager = new DataPathsManager()

  // Valid names should work
  expect(() => {
    manager.appName = "myapp"
  }).not.toThrow()

  expect(() => {
    manager.appName = "my-app"
  }).not.toThrow()

  expect(() => {
    manager.appName = "my_app"
  }).not.toThrow()

  expect(() => {
    manager.appName = "MyApp123"
  }).not.toThrow()

  // Invalid names should throw
  expect(() => {
    manager.appName = ""
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "   "
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app/name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app\\name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app<name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app>name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = 'app"name'
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app|name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app?name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app*name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "CON"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "PRN"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app."
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app "
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "."
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = ".."
  }).toThrow("Invalid app name")
})

test("DataPathsManager constructor uses valid default appName", () => {
  // Should not throw when creating a new instance
  expect(() => {
    new DataPathsManager()
  }).not.toThrow()

  const manager = new DataPathsManager()
  expect(manager.appName).toBe("opentui")
})

test("DataPathsManager emits paths:changed event when appName changes", async () => {
  const manager = new DataPathsManager()
  let eventFired = false
  let eventPaths: any = null

  manager.on("paths:changed", (paths) => {
    eventFired = true
    eventPaths = paths
  })

  const originalAppName = manager.appName
  manager.appName = "test-app-event"

  expect(eventFired).toBe(true)
  expect(eventPaths).toBeDefined()
  expect(eventPaths.globalDataPath).toContain("test-app-event")
  expect(eventPaths.globalConfigPath).toContain("test-app-event")
  expect(eventPaths.globalConfigFile).toContain("test-app-event")
  expect(eventPaths.localConfigFile).toContain("test-app-event")
})

test("DataPathsManager does not emit event when appName is set to same value", () => {
  const manager = new DataPathsManager()
  let eventFired = false

  manager.on("paths:changed", () => {
    eventFired = true
  })

  // Set to the same value
  manager.appName = manager.appName

  expect(eventFired).toBe(false)
})

test("OPENTUI_DATA_HOME overrides the base data directory", () => {
  // The host sets this to keep OpenTUI's data (e.g. the tree-sitter query
  // cache) inside its own project instead of the user home.
  const original = process.env.OPENTUI_DATA_HOME
  try {
    process.env.OPENTUI_DATA_HOME = path.join("override-root", "data")
    clearEnvCache()
    const manager = new DataPathsManager()
    expect(manager.globalDataPath).toBe(path.join("override-root", "data", "opentui"))
  } finally {
    if (original === undefined) delete process.env.OPENTUI_DATA_HOME
    else process.env.OPENTUI_DATA_HOME = original
    clearEnvCache()
  }
})
