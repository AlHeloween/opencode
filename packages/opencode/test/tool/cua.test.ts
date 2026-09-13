import { describe, expect, test } from "bun:test"
import { cuaCallArgs } from "../../src/tool/cua"

describe("CUA launch arguments", () => {
  test("forces launches to start minimized even when the caller requests otherwise", () => {
    expect(JSON.parse(cuaCallArgs("launch_app", '{"name":"notepad.exe"}'))).toEqual({
      name: "notepad.exe",
      start_minimized: true,
    })
    expect(JSON.parse(cuaCallArgs("launch_app", '{"path":"C:\\\\Windows\\\\System32\\\\notepad.exe","start_minimized":false}'))).toEqual({
      path: "C:\\Windows\\System32\\notepad.exe",
      start_minimized: true,
    })
  })

  test("preserves unrelated CUA call payloads without parsing them", () => {
    const payload = '{"pid":42,"window_id":99}'
    expect(cuaCallArgs("get_window_state", payload)).toBe(payload)
  })

  test("rejects non-object launch arguments", () => {
    expect(() => cuaCallArgs("launch_app", "[]")).toThrow("launch_app arguments must be a JSON object")
  })
})
