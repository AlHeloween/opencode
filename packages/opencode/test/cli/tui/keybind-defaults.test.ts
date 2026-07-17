import { describe, expect, test } from "bun:test"
import { Keybind } from "../../../src/util/keybind"
import { ConfigKeybinds } from "../../../src/config/keybinds"

describe("keybind defaults", () => {
  const defaults = ConfigKeybinds.Keybinds.parse({})

  test("scrollbar_toggle is leader+v", () => {
    expect(defaults.scrollbar_toggle).toBe("<leader>v")
    expect(Keybind.parse(defaults.scrollbar_toggle!)[0]).toMatchObject({
      leader: true,
      name: "v",
    })
  })

  test("agi and timeline do not share the same chord", () => {
    expect(defaults.session_timeline).toBe("<leader>g")
    expect(defaults.agi_toggle).toBe("<leader>o")
    expect(defaults.agi_toggle).not.toBe(defaults.session_timeline)
  })

  test("messages navigation keybinds are active", () => {
    expect(defaults.messages_page_up).toContain("pageup")
    expect(defaults.messages_page_down).toContain("pagedown")
    expect(defaults.messages_line_up).toBe("ctrl+alt+y")
    expect(defaults.messages_line_down).toBe("ctrl+alt+e")
    expect(defaults.messages_first).toContain("home")
    expect(defaults.messages_last).toContain("end")
  })
})
