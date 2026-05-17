# Backport: Performance hotfixes from Local_Development

Cherry-pick 5 low-risk performance fixes identified in `research/research_v1.md`.

## 1. AsyncQueue: O(1) dequeue for resolver queue

**File:** `packages/opencode/src/util/queue.ts`

**Problem:** The data queue uses a linked-list (O(1) shift), but the resolver queue at line 16 still uses `this.resolvers.shift()` — O(n) array shift on each dequeue.

**Fix:** Convert the `resolvers` array to a linked-list, mirroring the existing `Node<T>` pattern already used for the data queue.

**Current (lines 12-16):**
```ts
private resolvers: ((value: T) => void)[] = []

push(item: T) {
  const node = new Node(item)
  const resolve = this.resolvers.shift()  // O(n)
```

**After:** Add a `ResolverNode` class and dual linked-list pointers. The resolver is popped from the head in `push()` and appended to the tail in `next()`.

**Note:** Per explorer validation, the resolver queue is inherently low-traffic (only pending waiters when consumers call `next()` before data is available). No tests exist for AsyncQueue, so mechanical correctness is the priority.

## 2. MCP concurrency cap (prompts/resources listing)

**File:** `packages/opencode/src/mcp/index.ts`

**Problem:** Line 664 in `collectFromConnected()` uses `concurrency: "unbounded"` for parallel prompts/resources listing across connected MCP clients.

**Fix:** Change `{ concurrency: "unbounded" }` to `{ concurrency: 4 }`.

**Line 664:**
```ts
// Before:
{ concurrency: "unbounded" },

// After:
{ concurrency: 4 },
```

**Note:** Per explorer validation, this is NOT startup — MCP client startup already uses `concurrency: 4` at line 510. This `collectFromConnected` is called on-demand by `MCP.prompts()` (line 670) and `MCP.resources()` (line 675). The fix caps parallel listPrompts/listResources calls.

## 3. bash.ts: fix quadratic string accumulation

**File:** `packages/opencode/src/tool/bash.ts`

**Problem:** Line 461 uses `full += chunk` in a hot stream loop. On large bash output, repeated string concatenation is O(n^2).

**Fix:** Replace `full` with a `chunks: string[]` array and track bytes via running counter.

**Current (lines 423, 461, 469):**
```ts
let full = ""
// ...
full += chunk
// ...
trunc.write(full)
full = ""
```

**After:**
```ts
const chunks: string[] = []
let fullBytes = 0
// ...
chunks.push(chunk)
fullBytes += Buffer.byteLength(chunk, "utf-8")
// ...
trunc.write(chunks.join(""))
chunks.length = 0
fullBytes = 0
```

**All call sites to update:**
- Line 423: `let full = ""` → `const chunks: string[] = []; let fullBytes = 0`
- Line 461: `full += chunk` → `chunks.push(chunk); fullBytes += Buffer.byteLength(chunk, "utf-8")`
- Line 462: `Buffer.byteLength(full, "utf-8")` → `fullBytes`
- Line 463: `trunc.write(full)` → `trunc.write(chunks.join(""))`
- Line 469: `full = ""` → `chunks.length = 0; fullBytes = 0`

**Note:** Per explorer validation, `full` is bounded by `maxBytes` (flushed to disk when exceeded), so the O(n^2) impact is limited. But the fix is still correct and cleaner.

## 4. Stream page size: 50 → 500

**File:** `packages/opencode/src/session/message-v2.ts`

**Problem:** Line 1025 uses `const size = 50` for message stream pagination. Larger pages reduce SQLite round-trips by 10x.

**Fix:** Change `50` to `500`.

**Line 1025:**
```ts
// Before:
const size = 50

// After:
const size = 500
```

**Note:** All callers of `stream()` iterate to completion (load all messages for a session). Memory impact: 500 messages × ~5KB ≈ 2.5MB per page — negligible.

## 5. Doom-loop check: cache parts instead of DB query

**File:** `packages/opencode/src/session/processor.ts`

**Problem:** In the `tool-call` event handler (line 311), `MessageV2.parts(ctx.assistantMessage.id)` queries the DB for ALL parts of the assistant message, then slices the last 3. This DB round-trip fires on every tool call.

**Fix:** Cache recent tool-call events in `ProcessorContext`. Use a ring buffer instead of DB query.

**Add to ProcessorContext (line 67):**
```ts
interface ProcessorContext extends Input {
  // ... existing fields ...
  recentToolCalls: { toolName: string; input: unknown }[]
}
```

**Initialize in `create()` (ctx construction around line 117-131):**
```ts
recentToolCalls: [],
```

**Replace lines 311-325:**
```ts
// Before:
const parts = MessageV2.parts(ctx.assistantMessage.id)
const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

if (
  recentParts.length !== DOOM_LOOP_THRESHOLD ||
  !recentParts.every(
    (part) =>
      part.type === "tool" &&
      part.tool === value.toolName &&
      part.state.status !== "pending" &&
      Bun.deepEquals(part.state.input, value.input),
  )
) {
  return
}

// After:
ctx.recentToolCalls.push({ toolName: value.toolName, input: value.input })
if (ctx.recentToolCalls.length > DOOM_LOOP_THRESHOLD) ctx.recentToolCalls.shift()

const last = ctx.recentToolCalls
if (
  last.length !== DOOM_LOOP_THRESHOLD ||
  !last.every((c) => c.toolName === value.toolName && Bun.deepEquals(c.input, value.input))
) {
  return
}
```

**Note:** Per explorer validation, `MessageV2` import stays (used extensively elsewhere in processor.ts for types, `fromError`, `ContextOverflowError`, etc.). The cache resets per processing session (each `create()` call), which is functionally equivalent and actually more correct — avoids querying the DB for parts that were already streamed through this same processor.

## 6. Gateway: SSE chunk coalescing

**Files:** `packages/opencode/src/provider/gateway/adaptive-client.ts`

**Problem:** The gateway's `TransformStream` (lines 555-604) forwards every raw SSE chunk immediately via `controller.enqueue(chunk)`. For streaming responses with hundreds of chunks, each `enqueue()` wakes the Effect SSE parser fiber downstream. Coalescing reduces fiber wake-ups 10x.

**Pipeline:** `raw SSE chunks → queue → provider-aware coalescing window → fewer enqueue operations`

**Fix — SSE chunk coalescing:**

Add a `CoalescingTransform` that sits between `response.body` and the existing metrics `TransformStream`. It buffers incoming chunks and flushes by:
- **Time**: every 50ms (balance latency vs batching)
- **Count**: every 10 chunks (limit buffer size)
- **Stream end**: immediate flush on final chunk

```ts
class CoalescingTransform {
  private buffer: Uint8Array[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly flushMs: number
  private readonly maxChunks: number

  constructor(opts: { flushMs?: number; maxChunks?: number } = {}) {
    this.flushMs = opts.flushMs ?? 50
    this.maxChunks = opts.maxChunks ?? 10
  }

  push(chunk: Uint8Array, controller: TransformStreamDefaultController) {
    this.buffer.push(chunk)
    if (this.buffer.length >= this.maxChunks) {
      this.flush(controller)
      return
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush(controller)
      }, this.flushMs)
    }
  }

  flush(controller: TransformStreamDefaultController) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.buffer.length === 0) return
    const merged = new Uint8Array(this.buffer.reduce((sum, b) => sum + b.length, 0))
    let offset = 0
    for (const chunk of this.buffer) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.buffer.length = 0
    controller.enqueue(merged)
  }

  cancel() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }
}
```

**Implantation** (adaptive-client.ts, lines 553-604):
Chain `CoalescingTransform` before the existing metrics `TransformStream` using an extra `pipeThrough()`:

```ts
// Before:
const trackedBody = response.body.pipeThrough(
  new TransformStream({ transform(chunk, controller) { ... } })
)

// After:
const coalescer = new CoalescingTransform()
const trackedBody = response.body
  .pipeThrough(new TransformStream({
    transform(chunk, controller) { coalescer.push(chunk, controller) },
    flush(controller) { coalescer.flush(controller) },
    cancel() { coalescer.cancel() },
  }))
  .pipeThrough(
    new TransformStream({ transform(chunk, controller) { ... } })
  )
```

**Tradeoffs acknowledged (per explorer validation):**
- `sample.chunks` will count coalesced chunks (~10x lower) — acceptable, metrics remain valid at coarser resolution
- `ttftMs` / `totalMs` are unaffected
- `writeLog()` reduction is marginal (already batched by `async-logger` at 100ms intervals)
- Store `record*()` batching is dropped — these are O(1) in-memory Map operations, providing no meaningful improvement
- Byte concatenation is safe for newline-delimited SSE — downstream parser sees complete events
- `cancel()` handler added per explorer finding (prevents timer leak on stream abort)
- LLM SSE chunks are typically 200-2000 bytes — 10 chunks max ≈ 5-20KB buffer

**Note:** H2 session reuse is already implemented (lines 404-469). Outgoing request batching via HTTP/2 multiplexing is handled automatically by Node.js when multiple `http2.request()` calls share the same session.

## 7. Restore TUI sidebar: connection type per provider

**Files:**
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx` (TUI render)
- `packages/opencode/src/provider/gateway/mod.ts` (expose route protocol data)

**Problem:** The `Local_Development_old` TUI sidebar displayed per-provider connection type (`Protocol: h2` vs `Protocol: http/1.1`). This was lost during merge. The TUI SDK `Provider` type no longer carries `gateway.protocol` — the gateway config lives in a separate system (`config-manager.ts` / `gateway.jsonc`) not projected into the TUI state.

**What exists today:**
- `__gatewayLiveStatus` global (updated every 5s): `{ activeStreams, inflightRequests, h2Sessions }` — stream counts, **no** per-provider protocol
- `Store.getAllRoutes()` (in-memory): `{ key: { provider, model, ... }, adjustment: { protocol: { alpnNegotiated: "h2"|"http/1.1" } } }` — has per-route protocol

**Fix — Step 1: Expose route protocols via global (`mod.ts`):**

In the periodic status update (line 128-138), also publish per-route protocol info:
```ts
;(globalThis as any).__gatewayRoutes = Store.getAllRoutes().map((r) => ({
  provider: r.key.provider,
  protocol: r.adjustment.protocol.alpnNegotiated,
}))
```

**Fix — Step 2: Read in TUI sidebar (`context.tsx`):**

In the `state()` memo, read protocol from routes matching the current provider:
```ts
const routes = (globalThis as any).__gatewayRoutes as
  | Array<{ provider: string; protocol: string }>
  | undefined
const protocol = routes?.find((r) => r.provider === last.providerID)?.protocol
```

And render:
```tsx
{protocol ? <text fg={theme().textMuted}>Protocol: {protocol}</text> : null}
{liveStatus?.activeStreams > 0 ? (
  <text fg={theme().textMuted}>Streams: {liveStatus.activeStreams}</text>
) : null}
```

**What we can restore:**
| Element | Source | Status |
|---------|--------|--------|
| `Protocol: h2` / `Protocol: http/1.1` | `__gatewayRoutes` (new, from `Store.getAllRoutes`) | New global needed |
| `Streams: N` (active connections) | `__gatewayLiveStatus.activeStreams` | Already live |
| `Greeting` header | Static text | Trivial |

**What we CANNOT restore (prerequisite doesn't exist):**
| Element | Why |
|---------|-----|
| `Streaming: enabled/disabled` | Gateway streaming toggle — config lives in `config-manager.ts`, not in TUI state. Would need async config loading in SolidJS memo. Skipped for now. |

## Not implementing

- `concurrency: "unbounded"` in `tool/read.ts:82`, `session/processor.ts:521`, `session/prompt.ts:156` — separate changes not part of this backport
- `full += chunk` in other files — research doc only identified `bash.ts`
- Database topology split — too invasive (per research recommendation)
- Native markdownify — requires Rust binary we don't have
