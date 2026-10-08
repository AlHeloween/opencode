import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { Effect } from "effect"
import sharp from "sharp"
import {
  cuaBoundClickArgs,
  cuaCallArgs,
  cuaExecute,
  cuaObservation,
  cuaScreenshotFile,
  cuaScreenshotResult,
} from "../../src/tool/cua"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import type * as Tool from "../../src/tool/tool"

describe("CUA launch arguments", () => {
  // T4 (plans/2026-09-29_cua-windows-debug-input.md): the blanket minimize became the
  // DEFAULT-tier placement; the tier test below pins the B-native-bg exception.
  test("keeps the default launch minimized even when the caller requests otherwise", () => {
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

  test("places launches per tier without fabricating a monitor offset", () => {
    // B-native-bg = shown-no-activate: start_minimized:false maps to SW_SHOWNOACTIVATE in the
    // driver (impl_.rs:2043-2045,2070-2126) — visible for a fresh capture (a minimized window
    // refuses capture), never activated. The monitor is discovered at run time: launch_app has
    // no position input, so an invented offset is refused instead of passed through.
    expect(JSON.parse(cuaCallArgs("launch_app", '{"name":"notepad.exe"}', "ses_one"))).toEqual({
      name: "notepad.exe",
      start_minimized: true,
    })
    expect(JSON.parse(cuaCallArgs("launch_app", '{"name":"notepad.exe"}', "ses_one", "B-native-bg"))).toEqual({
      name: "notepad.exe",
      start_minimized: false,
    })
    expect(
      JSON.parse(cuaCallArgs("launch_app", '{"name":"notepad.exe","start_minimized":true}', "ses_one", "B-native-bg"))
        .start_minimized,
    ).toBe(false)
    expect(() => cuaCallArgs("launch_app", '{"name":"notepad.exe","x":2560,"y":0}', "ses_one", "B-native-bg")).toThrow(
      "cannot place",
    )
  })

  test("preserves unrelated CUA call payloads without parsing them", () => {
    const payload = '{"pid":42,"window_id":99}'
    expect(cuaCallArgs("get_window_state", payload)).toBe(payload)
  })

  test("creates a fresh image artifact path without asking the agent for one", () => {
    const cache = path.join("data", "cache")
    expect(cuaScreenshotFile("get_window_state", undefined, "ses_one", cache, "one")).toBe(
      path.join(cache, "cua", "ses_one", "one.png"),
    )
    expect(cuaScreenshotFile("get_desktop_state", undefined, "ses_one", cache, "two")).toBe(
      path.join(cache, "cua", "ses_one", "two.png"),
    )
    expect(cuaScreenshotFile("get_window_state", "my.png", "ses_one", cache, "three")).toBe("my.png")
    expect(cuaScreenshotFile("click", undefined, "ses_one", cache, "four")).toBeUndefined()
  })

  test("an observation without a file argument delivers a verified image and reusable binding", async () => {
    const bytes = await sharp({ create: { width: 4, height: 2, channels: 4, background: "#eaeaff" } })
      .png()
      .toBuffer()
    let artifact: string | undefined
    try {
      await Instance.provide({
        directory: path.join(import.meta.dir, "../.."),
        fn: async () => {
          const ctx: Tool.Context = {
            sessionID: SessionID.make("ses_cua_image_test"),
            messageID: MessageID.make("msg_cua_image_test"),
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
            extra: { model: { capabilities: { input: { image: true } } } },
          }
          const result = await Effect.runPromise(
            cuaExecute(
              { action: "call", tool: "get_window_state", args: '{"pid":42,"window_id":99}' },
              ctx,
              (argv, stdin) =>
                Effect.promise(async () => {
                  expect(argv.slice(0, 2)).toEqual(["call", "get_window_state"])
                  expect(JSON.parse(stdin ?? "{}")).toMatchObject({
                    pid: 42,
                    window_id: 99,
                    session: "oc-ses_cua_image_test",
                  })
                  const index = argv.indexOf("--screenshot-out-file")
                  expect(index).toBeGreaterThan(1)
                  artifact = argv[index + 1]
                  expect(artifact).toContain("cua")
                  await Bun.write(artifact!, bytes)
                  return {
                    code: 0,
                    out: JSON.stringify({
                      pid: 42,
                      window_id: 99,
                      screenshot_width: 4,
                      screenshot_height: 2,
                      capture_id: "capture_auto",
                    }),
                    err: "",
                  }
                }),
            ),
          )
          expect(result.attachments).toHaveLength(1)
          expect(result.attachments?.[0].dimensions).toEqual({ width: 4, height: 2 })
          expect(result.metadata.observation).toMatchObject({ capture_id: "capture_auto", window_id: 99 })
          expect(result.output).toContain("Attached image 4x2 px")
        },
      })
    } finally {
      if (artifact) await rm(artifact, { force: true })
    }
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

  test("refuses capture_id on every tool the driver does not bind it for", () => {
    // Only `click` declares a capture_id in the driver schemas (platform-windows/src/tools/impl_.rs:3139);
    // `drag` has no such field (impl_.rs:7322-7337) and run 20260930T024021Z (W3/L5) measured the
    // silence this guard removes: the gesture was dispatched while the ID was dropped.
    expect(() =>
      cuaCallArgs("drag", '{"from_x":1,"from_y":2,"to_x":30,"to_y":40,"capture_id":"capture_1"}', "ses_one"),
    ).toThrow("capture_id")
    expect(() => cuaCallArgs("get_window_state", '{"pid":42,"capture_id":"capture_1"}', "ses_one")).toThrow(
      "capture_id",
    )
    expect(() => cuaCallArgs("type_text", '{"text":"hello","capture_id":"capture_1"}')).toThrow("capture_id")
    expect(() => cuaCallArgs("launch_app", '{"name":"notepad.exe","capture_id":"capture_1"}', "ses_one")).toThrow(
      "capture_id",
    )
    // Control: click is the bound tool — the ID survives the normalizer and reaches the driver.
    expect(
      JSON.parse(cuaCallArgs("click", '{"pid":42,"window_id":99,"capture_id":"capture_1","x":10,"y":20}', "ses_one"))
        .capture_id,
    ).toBe("capture_1")
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
      // The 2026-09-12 Go workflow sent only pid + x/y. Fill the current capture
      // from an image already shown to the model, not from a parent/implicit CLI session.
      expect(JSON.parse(cuaBoundClickArgs('{"pid":42,"x":1000,"y":0.5}', "ses_one", history))).toMatchObject({
        x: 2000,
        y: 1,
        pid: 42,
        window_id: 99,
        capture_id: "capture_1",
        session: "oc-ses_one",
      })
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
      expect(() => cuaBoundClickArgs('{"pid":42,"x":1,"y":0}', "ses_one", consumed)).toThrow("already used")
      const ambiguous = [
        {
          parts: [
            ...history[0].parts,
            {
              type: "tool",
              tool: "cua",
              state: {
                status: "completed",
                metadata: {
                  observation: { ...result.metadata.observation, capture_id: "capture_other", window_id: 100 },
                },
              },
            },
          ],
        },
      ] as unknown as Tool.Context["messages"]
      expect(() => cuaBoundClickArgs('{"pid":42,"x":1,"y":0}', "ses_one", ambiguous)).toThrow("Several windows match")
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
