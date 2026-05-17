# Fix Web Embed Bundle Build Failure — Log Module Browser Incompatibility

## Root Cause

Adding `import * as Log from "@opencode-ai/core/util/log"` to 15 files in `packages/app/src/` pulled the full `log.ts` module chain into the browser bundle:

```
log.ts → global.ts → flock.ts → hash.ts → import { createHash } from "crypto"
```

Vite replaces Node.js builtins with `__vite-browser-external` (exports nothing). Rollup errors because `hash.ts` tries to import `createHash` from this no-export stub.

## Pre-existing vs New

**New.** Before our changes, no file in `packages/app/src/` imported `@opencode-ai/core/util/log`, so the Node.js modules were never pulled into the browser bundle. The existing web bundle at `packages/app/dist/` is from a prior build (5/15/2026).

## Affected Files (the 15 we added `import * as Log` to)

| File | How Log is used |
|------|----------------|
| `src/context/terminal.tsx` | `Log.Default.warn(...)` |
| `src/context/global-sync.tsx` | `Log.Default.warn(...)` |
| `src/context/global-sdk.tsx` | `Log.Default.warn(...)` |
| `src/context/command.tsx` | `Log.Default.debug(...)` |
| `src/context/layout.tsx` | `Log.Default.debug(...)` |
| `src/context/permission.tsx` | `Log.Default.debug(...)` |
| `src/context/global-sync/bootstrap.ts` | `Log.Default.warn(...)` |
| `src/context/global-sync/child-store.ts` | `Log.Default.warn(...)` |
| `src/pages/session.tsx` | `Log.Default.debug(...)` |
| `src/pages/session/message-timeline.tsx` | `Log.Default.warn(...)` |
| `src/pages/session/use-session-commands.tsx` | `Log.Default.debug(...)` |
| `src/pages/layout.tsx` | `Log.Default.debug(...)` |
| `src/components/prompt-input/submit.ts` | `Log.Default.debug(...)` |
| `src/utils/notification-click.ts` | `Log.Default.debug(...)` |
| `src/utils/server-health.ts` | `Log.Default.debug(...)` |

## Fix: Vite Resolve Alias → Browser-Safe No-Op Stub

The web bundle has no filesystem to write logs to. A no-op logger is the correct behavior for browser context. The real logger continues working in TUI/server.

### Phase 1: Create browser-safe log stub

**File:** `packages/app/src/utils/log-browser.ts`

```ts
import type { Level, Logger } from "@opencode-ai/core/util/log"

const noop = () => {}

const noopLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  tag: () => noopLogger,
  clone: () => noopLogger,
  time: () => ({ stop: noop, [Symbol.dispose]: noop }),
}

export type { Level, Logger }
export interface Options { print?: boolean }
export const Default = noopLogger
export function create(): Logger { return noopLogger }
export async function init(_options?: Options): Promise<void> {}
export async function reopen(): Promise<void> {}
export function bugReport(): unknown[] { return [] }
export function file(): string { return "" }

// Level Zod enum stub — only exported for type compatibility.
// No app file uses Level at runtime, but types may reference it.
export const Level = undefined as any
```

**Tasks:**
1. [ ] Create `packages/app/src/utils/log-browser.ts` with the corrected stub (all 10 exports from `log.ts` covered)
2. [ ] Verify `Level` Zoo enum is never used at runtime by any of the 15 affected app files

### Phase 2: Add vite resolve alias

**File:** `packages/app/vite.js`

Add alias mapping `@opencode-ai/core/util/log` to the browser stub:

```js
resolve: {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "@opencode-ai/core/util/log": fileURLToPath(new URL("./src/utils/log-browser.ts", import.meta.url)),
  },
},
```

**Tasks:**
3. [ ] Add alias line to `packages/app/vite.js` in the existing `resolve.alias` block (after line 18)

### Phase 3: Build and verify

**Tasks:**
4. [ ] Run `pwsh _build.ps1` from repo root
5. [ ] Verify web bundle builds without error
6. [ ] Verify `packages/opencode` typecheck still passes
