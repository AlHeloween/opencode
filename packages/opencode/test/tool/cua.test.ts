import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { Effect } from "effect"
import sharp from "sharp"
import { cuaBoundClickArgs, cuaCallArgs, cuaObservation, cuaScreenshotResult } from "../../src/tool/cua"
import type * as Tool from "../../src/tool/tool"

describe("CUA launch arguments", () => {
  test("forces launches to start minimized even when the caller requests otherwise", () => {
    expect(JSON.parse(cuaCallArgs("launch_app", '{"name":"notepad.exe"}'))).toEqual({
      name: "notepad.exe",
      start_minimized: true,
    })
    expect(
      JSON.parse(
        cuaCallArgs("launch_app", '{"path":"C:\\\\Windows\\\\System32\\\\notepad.exe","start_minimized":false}'),
      ),
    ).toEqual({
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

  test("keeps a named CLI session for a capture and its follow-up click", () => {
    const observe = JSON.parse(cuaCallArgs("get_window_state", '{"pid":42,"window_id":99}', "ses_one"))
    const click = JSON.parse(
      cuaCallArgs("click", '{"pid":42,"window_id":99,"capture_id":"capture_1","x":10,"y":20}', "ses_one"),
    )
    expect(observe.session).toBe("oc-ses_one")
    expect(click.session).toBe(observe.session)
    expect(click.capture_id).toBe("capture_1")
  })

  test("refuses an unbound pixel click before the CLI can dispatch it", () => {
    expect(() => cuaCallArgs("click", '{"pid":42,"window_id":99,"x":10,"y":20}', "ses_one")).toThrow("capture_id")
  })

  test("preserves element and zoom addressing", () => {
    expect(
      JSON.parse(cuaCallArgs("click", '{"pid":42,"window_id":99,"element_index":3}', "ses_one")).element_index,
    ).toBe(3)
    expect(
      JSON.parse(cuaCallArgs("click", '{"pid":42,"window_id":99,"from_zoom":true,"x":2,"y":3}', "ses_one")).from_zoom,
    ).toBe(true)
  })

  test("delivers a verified image packet with both coordinate frames and rejects stale/foreign clicks", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "cua-observation-"))
    try {
      const file = path.join(directory, "frame.png")
      await Bun.write(
        file,
        await sharp({ create: { width: 4000, height: 2, channels: 4, background: "#ffffff" } })
          .png()
          .toBuffer(),
      )
      const output = JSON.stringify({
        capture_id: "capture_1",
        pid: 42,
        window_id: 99,
        screenshot_width: 4000,
        screenshot_height: 2,
      })
      const result = await Effect.runPromise(
        cuaScreenshotResult({
          tool: "get_window_state",
          output,
          code: 0,
          file,
          sessionID: "ses_one",
          metadata: { action: "call", tool: "get_window_state", exit: 0, stdoutBytes: output.length },
          imageInput: true,
        }),
      )
      expect(result.attachments?.length).toBe(1)
      expect(result.attachments?.[0].type).toBe("file")
      expect(result.attachments?.[0].url.startsWith("data:image/")).toBe(true)
      expect(result.attachments?.[0].dimensions).toEqual({ width: 2000, height: 1 })
      expect(result.metadata.observation).toMatchObject({
        capture_id: "capture_1",
        scope: "window",
        pid: 42,
        window_id: 99,
        session: "oc-ses_one",
        capture_width: 4000,
        capture_height: 2,
        image_width: 2000,
        image_height: 1,
      })
      expect(result.output).toContain("Attached image 2000x1 px from capture 4000x2 px")
      const textOnly = await Effect.runPromise(
        cuaScreenshotResult({
          tool: "get_window_state",
          output,
          code: 0,
          file,
          sessionID: "ses_one",
          metadata: { action: "call", exit: 0, stdoutBytes: output.length },
          imageInput: false,
        }),
      )
      expect(textOnly.attachments).toBeUndefined()
      expect(textOnly.metadata.observation).toBeUndefined()
      expect(textOnly.output).toContain("no declared image input")
      const withoutId = await Effect.runPromise(
        cuaScreenshotResult({
          tool: "get_window_state",
          output: JSON.stringify({ pid: 42, window_id: 99, screenshot_width: 4000, screenshot_height: 2 }),
          code: 0,
          file,
          sessionID: "ses_one",
          metadata: { action: "call", exit: 0, stdoutBytes: output.length },
          imageInput: true,
        }),
      )
      expect(withoutId.attachments).toHaveLength(1)
      expect(withoutId.metadata.observation?.capture_id).toBeUndefined()
      expect(withoutId.output).toContain("for observation only")
      const desktop = await Effect.runPromise(
        cuaScreenshotResult({
          tool: "get_desktop_state",
          output: JSON.stringify({ capture_id: "capture_desktop", screenshot_width: 4000, screenshot_height: 2 }),
          code: 0,
          file,
          sessionID: "ses_one",
          metadata: { action: "call", exit: 0, stdoutBytes: output.length },
          imageInput: true,
        }),
      )
      expect(desktop.metadata.observation).toMatchObject({ scope: "desktop", image_width: 2000 })
      const desktopHistory = [
        { parts: [{ type: "tool", tool: "cua", state: { status: "completed", metadata: desktop.metadata } }] },
      ] as unknown as Tool.Context["messages"]
      expect(
        JSON.parse(
          cuaBoundClickArgs(
            '{"scope":"desktop","capture_id":"capture_desktop","x":1000,"y":0}',
            "ses_one",
            desktopHistory,
          ),
        ).x,
      ).toBe(2000)
      expect(() =>
        cuaBoundClickArgs(
          '{"pid":42,"window_id":99,"capture_id":"capture_desktop","x":1,"y":0}',
          "ses_one",
          desktopHistory,
        ),
      ).toThrow("target differs")
      const history = [
        { parts: [{ type: "tool", tool: "cua", state: { status: "completed", metadata: result.metadata } }] },
      ] as unknown as Tool.Context["messages"]
      expect(
        JSON.parse(
          cuaBoundClickArgs('{"pid":42,"window_id":99,"capture_id":"capture_1","x":1000,"y":0.5}', "ses_one", history),
        ),
      ).toMatchObject({ x: 2000, y: 1, session: "oc-ses_one", capture_id: "capture_1" })
      expect(() =>
        cuaBoundClickArgs('{"pid":42,"window_id":100,"capture_id":"capture_1","x":1,"y":0}', "ses_one", history),
      ).toThrow("target differs")
      expect(() =>
        cuaBoundClickArgs('{"pid":42,"window_id":99,"capture_id":"capture_1","x":1,"y":0}', "ses_other", history),
      ).toThrow("no image observation")
      expect(() =>
        cuaBoundClickArgs('{"pid":42,"window_id":99,"capture_id":"capture_1","x":2000,"y":0}', "ses_one", history),
      ).toThrow("outside the attached image")
      const consumed = [
        {
          parts: [
            ...history[0].parts,
            { type: "tool", tool: "cua", state: { status: "completed", metadata: { captureAttempt: "capture_1" } } },
          ],
        },
      ] as unknown as Tool.Context["messages"]
      expect(() =>
        cuaBoundClickArgs('{"pid":42,"window_id":99,"capture_id":"capture_1","x":1,"y":0}', "ses_one", consumed),
      ).toThrow("already used")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("does not advertise a capture when PNG bytes or reply geometry disagree", async () => {
    const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: "#ffffff" } })
      .png()
      .toBuffer()
    const output = JSON.stringify({
      pid: 42,
      window_id: 99,
      capture_id: "capture_1",
      screenshot_width: 3,
      screenshot_height: 2,
    })
    expect(cuaObservation("get_window_state", output, png, "ses_one")?.capture_width).toBe(3)
    expect(cuaObservation("get_window_state", output, new Uint8Array([1, 2, 3]), "ses_one")).toBeUndefined()
    expect(
      cuaObservation(
        "get_window_state",
        output.replace('"screenshot_width":3', '"screenshot_width":4'),
        png,
        "ses_one",
      ),
    ).toBeUndefined()
    const missing = await Effect.runPromise(
      cuaScreenshotResult({
        tool: "get_window_state",
        output,
        code: 0,
        file: path.join(os.tmpdir(), "cua-capture-missing-9a0e7a73.png"),
        sessionID: "ses_one",
        metadata: { action: "call", exit: 0, stdoutBytes: output.length },
        imageInput: true,
      }),
    )
    expect(missing.attachments).toBeUndefined()
    expect(missing.output).toContain("No verified image observation")
  })
})
