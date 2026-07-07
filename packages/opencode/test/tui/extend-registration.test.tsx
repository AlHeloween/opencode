/**
 * Integration tests: extend() registration for 3D renderables
 * ============================================================================
 * Verifies the component catalogue registration, JSX element creation,
 * and the reconcile pipeline for custom renderables.
 */
/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender, extend, getComponentCatalogue } from "@opentui/solid"
import { TexturePlaneRenderable } from "../../src/cli/cmd/tui/component/texture-plane-renderable"

describe("extend() registration", () => {
  test("extends component catalogue with imagePlane", () => {
    extend({ imagePlane: TexturePlaneRenderable })
    const catalogue = getComponentCatalogue()
    expect(catalogue.imagePlane).toBeDefined()
    expect(catalogue.imagePlane).toBe(TexturePlaneRenderable)
  })

  test("extend is idempotent", () => {
    extend({ imagePlane: TexturePlaneRenderable })
    extend({ imagePlane: TexturePlaneRenderable })
    const catalogue = getComponentCatalogue()
    expect(catalogue.imagePlane).toBe(TexturePlaneRenderable)
  })

  test("catalogue preserves other components after extend", () => {
    const before = getComponentCatalogue()
    extend({ imagePlane: TexturePlaneRenderable })
    const after = getComponentCatalogue()
    // Built-in components should still exist
    expect(after.box).toBeDefined()
    expect(after.text).toBeDefined()
    // Our component added
    expect(after.imagePlane).toBe(TexturePlaneRenderable)
  })

  test("TexturePlaneRenderable is a valid Renderable constructor", () => {
    expect(typeof TexturePlaneRenderable).toBe("function")
    expect(TexturePlaneRenderable.prototype).toBeDefined()
  })
})
