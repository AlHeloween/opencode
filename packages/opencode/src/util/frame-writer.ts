/**
 * Frame-synchronized terminal writer.
 *
 * OpenTUI's renderer owns process.stdout and writes frame bytes via the native
 * Zig renderer during renderNative().  Writing escape sequences directly to
 * stdout (or the terminal device fd) during a frame can interleave bytes,
 * corrupting the display.
 *
 * FrameSyncWriter queues terminal writes and flushes them immediately after
 * each FRAME event — when renderNative() has completed and no rendering is
 * active.  This gives the terminal image pipeline a controlled output slot
 * inside the main rendering flow.
 *
 * Usage:
 *   // In app.tsx after renderer init:
 *   FrameSyncWriter.init(renderer)
 *
 *   // In components (schedule timing + writeNow for device write):
 *   FrameSyncWriter.schedule(() => FrameSyncWriter.writeNow(seq))
 */
import { CliRenderEvents, type CliRenderer } from "@opentui/core"
import { writeToTerminal } from "./terminal-write"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "util.frame-writer" })

type WriteFn = () => void

let _renderer: CliRenderer | null = null
let _pending: WriteFn[] = []
let _flushing = false

function flush(): void {
  if (_flushing) return
  _flushing = true
  try {
    const batch = _pending
    _pending = []
    for (const fn of batch) {
      try {
        fn()
      } catch (err) {
        log.warn("bug: frame writer flush failed", { error: String(err) })
      }
    }
  } finally {
    _flushing = false
  }
}

export const FrameSyncWriter = {
  /**
   * Initialize the frame writer with the OpenTUI renderer.
   * Must be called once after renderer is created (in app.tsx).
   */
  init(renderer: CliRenderer): void {
    if (_renderer) {
      log.debug("FrameSyncWriter already initialized, replacing")
      this.destroy()
    }
    _renderer = renderer
    renderer.on(CliRenderEvents.FRAME, flush)
    log.debug("FrameSyncWriter initialized")
  },

  /**
   * Schedule a write to execute after the next FRAME event.
   * Safe to call from any context (effect, microtask, timeout).
   *
   * If no renderer is initialized (e.g. headless mode), the write
   * is executed immediately via queueMicrotask as a fallback.
   */
  schedule(fn: WriteFn): void {
    if (!_renderer) {
      log.debug("FrameSyncWriter: no renderer, writing immediately")
      queueMicrotask(() => {
        try {
          fn()
        } catch (err) {
          log.warn("bug: immediate terminal write failed", { error: String(err) })
        }
      })
      return
    }
    _pending.push(fn)
    // Ensure a frame is scheduled so the write is not stranded under idle
    // render-loop elimination (no continuous paint when nothing else dirties UI).
    _renderer.requestRender()
  },

  /**
   * Write immediately (bypassing frame sync), directly to the terminal device.
   * Only for cases where frame sync is impossible (e.g., shutdown), or when
   * called from inside a schedule() callback after the frame has completed.
   */
  writeNow(data: string): void {
    writeToTerminal(data)
  },

  /**
   * Clean up the frame listener. Called during renderer shutdown.
   */
  destroy(): void {
    if (_renderer) {
      _renderer.off(CliRenderEvents.FRAME, flush)
      _renderer = null
    }
    _pending = []
  },
}
