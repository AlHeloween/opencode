*** Begin Patch

*** Update File: packages/opencode/src/session/processor.ts
Replace streamStallTimeoutMs default and Effect.timeoutOrElse with Stream.timeout

@@ Line 30-35: Add constant, fix default from 30_000_000 to 120_000
<<<<
const CACHE_INPUT_DELTA_THRESHOLD = 100_000
const CACHE_COLD_START_INPUT_THRESHOLD = 100_000
function streamStallTimeoutMs() {
  const value = Number(process.env.OPENCODE_STREAM_STALL_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : 30_000_000
}
>>>>
const CACHE_INPUT_DELTA_THRESHOLD = 100_000
const CACHE_COLD_START_INPUT_THRESHOLD = 100_000
const STREAM_STALL_DEFAULT_MS = 120_000
function streamStallTimeoutMs() {
  const value = Number(process.env.OPENCODE_STREAM_STALL_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : STREAM_STALL_DEFAULT_MS
}

@@ Line 753-778: Replace timeoutOrElse with Stream.timeout + completion-flag
<<<<
            const stream = llm.stream(streamInput)
            const stallTimeoutMs = streamStallTimeoutMs()

            yield* stream.pipe(
              Stream.tap((event) => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain,
              Effect.timeoutOrElse({
                duration: `${stallTimeoutMs} millis`,
                orElse: () =>
                  Effect.gen(function* () {
                    if (!ctx.toolCallEmitted) {
                      ctx.stalled = true
                      log.warn("bug: llm stream stalled before tool call", {
                        sessionID: ctx.sessionID,
                        agent: ctx.assistantMessage.agent,
                        modelID: ctx.model.id,
                        messageID: ctx.assistantMessage.id,
                        timeoutMs: stallTimeoutMs,
                      })
                      return
                    }
                    yield* halt(new Error(`LLM stream stalled after tool call for ${stallTimeoutMs}ms`))
                  }),
              }),
            )
>>>>
            const stream = llm.stream(streamInput)
            const stallTimeoutMs = streamStallTimeoutMs()
            let streamCompleted = false

            yield* stream.pipe(
              Stream.tap((event) => {
                if (event.type === "finish-step") streamCompleted = true
                return handleEvent(event)
              }),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.timeout(`${stallTimeoutMs} millis`),
              Stream.runDrain,
            )

            if (!streamCompleted && !ctx.needsCompaction) {
              ctx.stalled = true
              log.warn("bug: llm stream stalled", {
                sessionID: ctx.sessionID,
                agent: ctx.assistantMessage.agent,
                modelID: ctx.model.id,
                messageID: ctx.assistantMessage.id,
                timeoutMs: stallTimeoutMs,
              })
            }

*** End Patch
