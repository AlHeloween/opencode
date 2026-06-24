import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SensorHandler } from "../../src/attachment/handlers/sensor"

describe("SensorHandler", () => {
  test("detect returns true for sensor/hdf5 mime types", () => {
    expect(SensorHandler.detect("application/x-hdf5")).toBe(true)
    expect(SensorHandler.detect("application/x-hdf")).toBe(true)
    expect(SensorHandler.detect("image/png")).toBe(false)
    expect(SensorHandler.detect("text/csv")).toBe(false)
  })

  test("classify handles non-HDF5 data gracefully", async () => {
    const att = { type: "file", kind: "sensor", mime: "application/x-hdf5", url: "data:application/octet-stream;base64,AAAA" } as any

    const result = await Effect.runPromise(SensorHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("sensor")
    const meta = result.metadata as any
    expect(meta).toBeDefined()
    expect(meta._tag).toBe("sensor")
    expect(meta.channels).toEqual([])
  })

  test("classify handles non-data URL", async () => {
    const att = { type: "file", kind: "sensor", mime: "application/x-hdf5", url: "https://example.com/data.h5" } as any
    const result = await Effect.runPromise(SensorHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("sensor")
    expect((result.metadata as any).channels).toEqual([])
  })

  test("describe formats sensor info", () => {
    const att: any = {
      kind: "sensor", mime: "application/x-hdf5", filename: "eeg.h5",
      metadata: { _tag: "sensor", channels: ["Fz", "Cz", "Pz"], shapes: [[1000], [1000], [1000]], dtypes: ["float32"], sampleRate: 256, duration: 3.9, units: "uV", format: "hdf5" },
    }
    const desc = SensorHandler.describe(att)
    expect(desc).toContain("eeg.h5")
    expect(desc).toContain("3.9s")
    expect(desc).toContain("256Hz")
    expect(desc).toContain("Fz")
  })

  test("describe handles missing fields", () => {
    const att: any = {
      kind: "sensor", mime: "application/x-hdf5", filename: "unknown.h5",
      metadata: { _tag: "sensor", channels: [], shapes: [], dtypes: [], sampleRate: 0, duration: 0, units: "unknown", format: "hdf5" },
    }
    const desc = SensorHandler.describe(att)
    expect(desc).toContain("unknown.h5")
  })

  test("render returns TUI badge", () => {
    const att: any = {
      kind: "sensor", mime: "application/x-hdf5", filename: "recording.h5",
      metadata: { _tag: "sensor", channels: ["C3", "C4"], shapes: [[5000], [5000]], dtypes: ["float32"], sampleRate: 500, duration: 10, units: "uV", format: "hdf5" },
    }
    const rendered = SensorHandler.render(att)
    expect(rendered.badge.text).toBe("h5")
    expect(rendered.label).toBe("recording.h5")
    expect(rendered.preview).toBe("2ch 10.0s")
  })
})
