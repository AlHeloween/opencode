import * as Log from "@opencode-ai/core/util/log"
import type { MetricsSample, MetricsResult } from "./metrics"
import * as M from "./metrics"
import { normalizeError } from "./errors"
import type { NormalizedError } from "./errors"

const log = Log.create({ prefix: "gateway/h1" })

export interface H1Response {
  status: number
  headers: Headers
  body: ReadableStream<Uint8Array> | null
  metrics: MetricsResult
  requestId?: string
}

export interface H1RequestOptions {
  url: string
  method: string
  headers: Record<string, string>
  body?: string | ArrayBuffer | Uint8Array
  signal?: AbortSignal
}

export async function request(options: H1RequestOptions): Promise<H1Response> {
  const sample: MetricsSample = M.makeSample(0, options.headers["x-request-id"])

  try {
    const mergedSignal = options.signal

    sample.queuedAt = Date.now()

    const response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body as BodyInit | null | undefined,
      signal: mergedSignal,
    })

    sample.socketAcquiredAt = Date.now()
    sample.headersReceivedAt = Date.now()
    sample.status = response.status

    if (!response.body) {
      sample.endedAt = Date.now()
      return {
        status: response.status,
        headers: response.headers,
        body: null,
        metrics: M.computeMetrics(sample),
        requestId: options.headers["x-request-id"],
      }
    }

    let firstChunk = true
    const transformed = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (firstChunk) {
            sample.firstChunkAt = Date.now()
            firstChunk = false
          }
          sample.lastChunkAt = Date.now()
          sample.chunks++
          controller.enqueue(chunk)
        },
        flush() {
          sample.endedAt = Date.now()
        },
      }),
    )

    return {
      status: response.status,
      headers: response.headers,
      body: transformed,
      metrics: M.computeMetrics(sample),
      requestId: options.headers["x-request-id"],
    }
  } catch (err) {
    const normalized = normalizeError(err)
    log.warn("bug: h1 request error", {
      url: options.url,
      category: normalized.category,
      error: normalized.message,
    })

    sample.endedAt = Date.now()
    sample.status = (err as any)?.status || (err as any)?.statusCode || 0

    throw {
      status: sample.status,
      headers: new Headers(),
      body: null,
      metrics: M.computeMetrics(sample),
      error: normalized,
      requestId: options.headers["x-request-id"],
    }
  }
}
