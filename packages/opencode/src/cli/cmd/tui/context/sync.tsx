import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "@tui/context/project"
import { useEvent } from "@tui/context/event"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@opencode-ai/core/util/binary"

export interface JobInfo {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: string
  readonly startedAt: number
  readonly output: string
}
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import * as Log from "@opencode-ai/core/util/log"
import { emptyConsoleState, type ConsoleState } from "@/config/console-state"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      session_jobs: {
        [sessionID: string]: JobInfo[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      session_jobs: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    const fullSyncedSessions = new Set<string>()
    const inflightSyncs = new Map<string, Promise<void>>()
    // Older-than-loaded paging (tracker scroll-up): inflight guard + sessions
    // whose older pages are exhausted (empty/short page from the server).
    const inflightOlder = new Map<string, Promise<boolean>>()
    const olderExhausted = new Set<string>()
    let syncedWorkspace = project.workspace.current()

    // Buffer deltas that arrive before the part is in the store.
    // Keyed by messageID → partID → accumulated delta text.
    const deltaBuffer = new Map<string, Map<string, string>>()
    const deltaBufferTimestamps = new Map<string, number>()

    // Hard caps on delta buffer to prevent memory creep from orphaned entries.
    const MAX_DELTA_BUFFER_SIZE = 500
    const DELTA_BUFFER_TTL_MS = 30_000

    // Debounce recovery sync calls per session to prevent cascading thrash.
    const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()

    // Fields that may receive incremental text deltas (safe for string concatenation).
    const DELTA_SAFE_FIELDS = new Set(["text", "output"])

    // Running delta accumulator for parts already in store (debounced to avoid
    // per-token Solid store churn during streaming at 25–50 deltas/sec).
    const runningDelta = new Map<string, Map<string, string>>()
    const deltaFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const DELTA_DEBOUNCE_MS = 25

    function clearDeltaFlushTimer(messageID: string) {
      const flushTimer = deltaFlushTimers.get(messageID)
      if (!flushTimer) return
      clearTimeout(flushTimer)
      deltaFlushTimers.delete(messageID)
    }

    function clearRunningDeltaState(messageID: string) {
      clearDeltaFlushTimer(messageID)
      runningDelta.delete(messageID)
    }

    /** Apply any debounced (not-yet-written) deltas into the Solid store immediately. */
    function flushRunningDeltaNow(messageID: string) {
      clearDeltaFlushTimer(messageID)
      const deltaBatch = runningDelta.get(messageID)
      if (!deltaBatch || deltaBatch.size === 0) {
        runningDelta.delete(messageID)
        return
      }
      runningDelta.delete(messageID)

      const parts = store.part[messageID]
      if (!parts) return

      batch(() => {
        for (const [key, deltaText] of deltaBatch) {
          const colonIdx = key.lastIndexOf(":")
          const partID = key.slice(0, colonIdx)
          const field = key.slice(colonIdx + 1)
          if (!DELTA_SAFE_FIELDS.has(field)) continue
          const r = Binary.search(parts, partID, (p) => p.id)
          if (!r.found) continue
          setStore("part", messageID, produce((draft) => {
            const part = draft[r.index]
            const existing = (part as any)[field] ?? ""
            ;(part as any)[field] = existing + deltaText
          }))
        }
      })
    }

    /**
     * Merge a server part.updated snapshot without truncating client-side
     * delta-accumulated string fields. Server snapshots can lag behind
     * message.part.delta events already applied (or about to be applied) locally.
     */
    function mergePartSnapshot(prev: Record<string, unknown>, incoming: Record<string, unknown>) {
      const merged = { ...incoming }
      for (const field of DELTA_SAFE_FIELDS) {
        const prevVal = String((prev as any)?.[field] ?? "")
        const incomingVal = String((incoming as any)?.[field] ?? "")
        if (prevVal.length > incomingVal.length) {
          ;(merged as any)[field] = prevVal
        }
      }
      return merged
    }

    function scheduleDeltaFlush(messageID: string) {
      if (deltaFlushTimers.has(messageID)) return
      deltaFlushTimers.set(messageID, setTimeout(() => {
        flushRunningDeltaNow(messageID)
      }, DELTA_DEBOUNCE_MS))
    }

    function pruneDeltaBuffer() {
      // Remove entries exceeding TTL
      const cutoff = Date.now() - DELTA_BUFFER_TTL_MS
      for (const [messageID, ts] of deltaBufferTimestamps) {
        if (ts < cutoff) {
          deltaBuffer.delete(messageID)
          deltaBufferTimestamps.delete(messageID)
        }
      }
    }

    function flushDeltaBuffer(messageID: string) {
      pruneDeltaBuffer()
      const buffer = deltaBuffer.get(messageID)
      if (!buffer) return
      deltaBuffer.delete(messageID)
      deltaBufferTimestamps.delete(messageID)

      const parts = store.part[messageID]
      if (!parts) return

      for (const [partID, accumulated] of buffer) {
        const result = Binary.search(parts, partID, (p) => p.id)
        if (!result.found) {
          // Part still not in store — schedule a targeted recovery
          debouncedRecoverySync({ sessionID: "", messageID, partID })
          continue
        }
        // Store each buffered field individually. Accumulated text may contain
        // multiple field values if the same partID received deltas for different
        // fields before the part arrived, but in practice the first delta
        // triggers recovery which fetches the full part.
        setStore(
          "part",
          messageID,
          produce((draft) => {
            const part = draft[result.index]
            const existing = (part as any).text ?? ""
            ;(part as any).text = existing + accumulated
          }),
        )
      }
    }

    function flushDeltaBufferForSession(sessionID: string) {
      const messages = store.message[sessionID]
      if (!messages) return
      for (const m of messages) {
        if (deltaBuffer.has(m.id)) {
          deltaBuffer.delete(m.id)
          deltaBufferTimestamps.delete(m.id)
        }
      }
    }

    function cleanupSessionStores(sessionID: string) {
      const messageIDs = store.message[sessionID]?.map((m) => m.id) ?? []
      setStore("message", produce((draft) => { delete draft[sessionID] }))
      setStore("session_status", produce((draft) => { delete draft[sessionID] }))
      setStore("session_diff", produce((draft) => { delete draft[sessionID] }))
      setStore("todo", produce((draft) => { delete draft[sessionID] }))
      setStore("permission", produce((draft) => { delete draft[sessionID] }))
      setStore("question", produce((draft) => { delete draft[sessionID] }))
      setStore("part", produce((draft) => {
        for (const mid of messageIDs) delete draft[mid]
      }))
      flushDeltaBufferForSession(sessionID)
      for (const mid of messageIDs) {
        const timer = recoveryTimers.get(mid)
        if (timer) {
          clearTimeout(timer)
          recoveryTimers.delete(mid)
        }
        const flushTimer = deltaFlushTimers.get(mid)
        if (flushTimer) {
          clearTimeout(flushTimer)
          deltaFlushTimers.delete(mid)
        }
        runningDelta.delete(mid)
      }
    }

    function debouncedRecoverySync(input: { sessionID?: string; messageID: string; partID: string }) {
      // Use messageID as dedupe key so multiple deltas for the same
      // message only trigger one recovery.
      const key = input.messageID
      const existing = recoveryTimers.get(key)
      if (existing) clearTimeout(existing)
      recoveryTimers.set(
        key,
        setTimeout(() => {
          recoveryTimers.delete(key)
          const sessionID = input.sessionID || ""
          // Find which session this message belongs to
          const sid = sessionID || findSessionForMessage(input.messageID)
          if (sid) {
            void syncSession(sid, { force: true }).catch((error) => {
              Log.Default.warn("session delta recovery sync failed", {
                sessionID: sid,
                messageID: input.messageID,
                partID: input.partID,
                error: error instanceof Error ? error.message : String(error),
              })
            })
          }
        }, 300),
      )
    }

    function findSessionForMessage(messageID: string): string | undefined {
      for (const [sid, messages] of Object.entries(store.message)) {
        if (messages?.some((m) => m.id === messageID)) return sid
      }
      return undefined
    }

    function hasActiveParts(messageID: string): boolean {
      const parts = store.part[messageID]
      if (!parts || parts.length === 0) return false
      return parts.some((part) => {
        if (part.type !== "tool") return false
        // Only tool parts have state.status — text/reasoning parts are static
        return (part as any).state?.status === "pending" || (part as any).state?.status === "running"
      })
    }

    async function syncSession(sessionID: string, input: { force?: boolean } = {}) {
        if (!input.force && fullSyncedSessions.has(sessionID)) return
        const inflight = inflightSyncs.get(sessionID)
        if (inflight) {
          // Intentionally silent: the original caller already logged any error.
          await inflight.catch(() => {})
          if (!input.force && fullSyncedSessions.has(sessionID)) return
        }
        const task = (async () => {
          try {
            const [session, messages, todo, diff] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true }),
              sdk.client.session.messages({ sessionID, limit: 100 }, { throwOnError: true }),
              sdk.client.session.todo({ sessionID }, { throwOnError: true }),
              sdk.client.session.diff({ sessionID }, { throwOnError: true }),
            ])
            // Safety cap: even if server returns more, we only process up to 100 messages
            const messageList = (messages.data ?? []).slice(0, 100)
            // Guard: skip write if the session was deleted while inflight was running.
            // Without this, a completed inflight can re-add a session that the
            // `session.deleted` event handler already removed from the store.
            if (!fullSyncedSessions.has(sessionID) && Binary.search(store.session, sessionID, (s) => s.id).found === false) {
              return
            }
            const messageInfos = messageList.map((x) => x.info)
            batch(() => {
              setStore(
                produce((draft) => {
                  const match = Binary.search(draft.session, sessionID, (s) => s.id)
                  if (match.found) draft.session[match.index] = session.data!
                  if (!match.found) draft.session.splice(match.index, 0, session.data!)
                  draft.todo[sessionID] = todo.data ?? []
                  draft.session_diff[sessionID] = diff.data ?? []
                }),
              )
              setStore("message", sessionID, reconcile(messageInfos, { key: "id" }))
              for (const message of messageList) {
                setStore("part", message.info.id, reconcile(message.parts, { key: "id" }))
              }
            })
            fullSyncedSessions.add(sessionID)
          } catch (error) {
            // Log error but don't crash the TUI - allow partial session loading
            console.error(`[sync] Failed to sync session ${sessionID}:`, error)
          }
        })()
        inflightSyncs.set(sessionID, task)
        try {
          await task
        } finally {
          if (inflightSyncs.get(sessionID) === task) inflightSyncs.delete(sessionID)
        }
      }
      /**
       * Fetch one older page (before the oldest loaded message) into the store.
       * Tracker scroll-up calls this near the top of the transcript; the server
       * pages model-visible rows only (compacted archive stays session-read).
       * Returns true when new rows were prepended.
       */
      async function loadOlderMessages(sessionID: string): Promise<boolean> {
        if (olderExhausted.has(sessionID)) return false
        const inflight = inflightOlder.get(sessionID)
        if (inflight) return inflight
        const task = (async () => {
          try {
            const oldest = store.message[sessionID]?.[0]
            if (!oldest) return false
            const limit = 100
            // Wire format of MessageV2.cursor (server authority):
            // base64url(JSON {id, time}) — built here to keep the server
            // module (drizzle/db) out of the TUI bundle.
            const before = Buffer.from(
              JSON.stringify({ id: oldest.id, time: oldest.time.created }),
            ).toString("base64url")
            const result = await sdk.client.session.messages(
              { sessionID, limit, before },
              { throwOnError: true },
            )
            const page = result.data ?? []
            // Short page = the remainder: nothing older beyond it.
            if (page.length < limit) olderExhausted.add(sessionID)
            if (page.length === 0) return false
            const infos = page.map((x) => x.info)
            batch(() => {
              setStore(
                "message",
                sessionID,
                produce((draft) => {
                  const existing = new Set(draft.map((m) => m.id))
                  const older = infos.filter((m) => !existing.has(m.id))
                  if (older.length === 0) return
                  draft.unshift(...older)
                  draft.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
                }),
              )
              for (const message of page) {
                if (store.part[message.info.id] === undefined) {
                  setStore("part", message.info.id, reconcile(message.parts, { key: "id" }))
                }
              }
            })
            return true
          } catch (error) {
            Log.Default.error("tui load older messages failed", { sessionID, error })
            return false
          } finally {
            inflightOlder.delete(sessionID)
          }
        })()
        inflightOlder.set(sessionID, task)
        return task
      }
      // Legacy wrapper kept for backward compatibility.
      function recoverSessionSync(input: { sessionID: string; messageID: string; partID: string }) {
        debouncedRecoverySync(input)
      }

      event.subscribe((event) => {
      switch (event.type) {
        case "server.instance.disposed":
          void bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "jobs.updated":
          setStore("session_jobs", event.properties.sessionID, event.properties.jobs as JobInfo[])
          break

        case "session.deleted": {
          const sid = event.properties.sessionID
          const result = Binary.search(store.session, sid, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          // Clean up orphaned session-keyed stores. Without this, deleted
          // sessions accumulate message/part/status reactive proxies that
          // SolidJS tracks for the process lifetime — the primary contributor
          // to the 1.18 GB peak RSS Bun segfault on long-running Windows sessions.
          cleanupSessionStores(sid)
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.sessionID, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          // Only evict oldest messages if they are fully completed
          // (no pending/running parts). Never evict mid-stream.
          const updated = store.message[event.properties.info.sessionID]
          // Bounded but deep enough for tracker-driven older-page loads: the
          // transcript can hold ~4 pages; eviction trims what the user already
          // scrolled past. (100 fought the lazy loader by dropping its rows.)
          if (updated.length > 400) {
            const oldest = updated[0]
            if (oldest && !hasActiveParts(oldest.id)) {
              batch(() => {
                setStore(
                  "message",
                  event.properties.info.sessionID,
                  produce((draft) => {
                    draft.shift()
                  }),
                )
                setStore(
                  "part",
                  produce((draft) => {
                    delete draft[oldest.id]
                  }),
                )
                // Cleanup delta buffers for evicted message
                deltaBuffer.delete(oldest.id)
                deltaBufferTimestamps.delete(oldest.id)
                clearRunningDeltaState(oldest.id)
              })
            }
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const mid = event.properties.messageID
          const result = Binary.search(messages, mid, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          setStore("part", produce((draft) => { delete draft[mid] }))
          deltaBuffer.delete(mid)
          deltaBufferTimestamps.delete(mid)
          clearRunningDeltaState(mid)
          const recovery = recoveryTimers.get(mid)
          if (recovery) {
            clearTimeout(recovery)
            recoveryTimers.delete(mid)
          }
          break
        }
        case "message.part.updated": {
          const messageID = event.properties.part.messageID
          // Apply any debounced client deltas first so the store is at least
          // as complete as the client has seen, then merge the server snapshot
          // without truncating longer delta-accumulated string fields.
          flushRunningDeltaNow(messageID)
          const parts = store.part[messageID]
          if (!parts) {
            setStore("part", messageID, [event.properties.part])
            // Flush any orphan deltas that arrived before this part
            flushDeltaBuffer(messageID)
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", messageID, result.index, produce((draft) => {
              const prev = parts[result.index] as Record<string, unknown>
              const incoming = event.properties.part as Record<string, unknown>
              Object.assign(draft, mergePartSnapshot(prev, incoming))
            }))
            break
          }
          setStore(
            "part",
            messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          // Flush any orphan deltas that arrived before this part
          flushDeltaBuffer(messageID)
          break
        }

        case "message.part.delta": {
        const { messageID, partID, field, delta } = event.properties

        // Only apply delta to known string-type fields to avoid corrupting
        // status enums, numeric values, or other non-concatenable fields.
        if (typeof field !== "string" || !DELTA_SAFE_FIELDS.has(field)) break

        const parts = store.part[messageID]
        if (!parts) {
          // Buffer delta — the part may arrive shortly in part.updated
          let buffer = deltaBuffer.get(messageID)
          if (!buffer) {
            // Evict oldest entry if buffer is full
            if (deltaBuffer.size >= MAX_DELTA_BUFFER_SIZE) {
              const first = deltaBuffer.keys().next().value
              if (first !== undefined) {
                deltaBuffer.delete(first)
                deltaBufferTimestamps.delete(first)
              }
            }
            buffer = new Map()
            deltaBuffer.set(messageID, buffer)
          }
          deltaBufferTimestamps.set(messageID, Date.now())
          const existing = buffer.get(partID) ?? ""
          buffer.set(partID, existing + delta)
          break
        }
        const result = Binary.search(parts, partID, (p) => p.id)
        if (!result.found) {
          // Buffer delta — part may arrive shortly
          let buffer = deltaBuffer.get(messageID)
          if (!buffer) {
            // Evict oldest entry if buffer is full
            if (deltaBuffer.size >= MAX_DELTA_BUFFER_SIZE) {
              const first = deltaBuffer.keys().next().value
              if (first !== undefined) {
                deltaBuffer.delete(first)
                deltaBufferTimestamps.delete(first)
              }
            }
            buffer = new Map()
            deltaBuffer.set(messageID, buffer)
          }
          deltaBufferTimestamps.set(messageID, Date.now())
          const existing = buffer.get(partID) ?? ""
          buffer.set(partID, existing + delta)
          break
        }
        // Part found — debounce store updates to avoid per-token Solid
        // reconciliation during high-frequency streaming (25–50 deltas/sec).
        // First delta of a burst applies immediately; subsequent deltas
        // arriving while a flush timer is pending are batched.
        const hasTimer = deltaFlushTimers.has(messageID)
        if (!hasTimer) {
          // First delta in burst — apply directly to show text immediately
          const r = Binary.search(parts, partID, (p) => p.id)
          if (r.found) {
            setStore("part", messageID, produce((draft) => {
              const part = draft[r.index]
              const existing = (part as any)[field] ?? ""
              ;(part as any)[field] = existing + delta
            }))
          }
        } else {
          // Subsequent delta — buffer for batched flush
          let acc = runningDelta.get(messageID)
          if (!acc) {
            if (runningDelta.size >= MAX_DELTA_BUFFER_SIZE) {
              const first = runningDelta.keys().next().value
              if (first !== undefined) runningDelta.delete(first)
            }
            acc = new Map()
            runningDelta.set(messageID, acc)
          }
          const fieldKey = partID + ":" + field
          acc.set(fieldKey, (acc.get(fieldKey) ?? "") + delta)
        }
        scheduleDeltaFlush(messageID)
        break
      }

        case "message.part.removed": {
          const messageID = event.properties.messageID
          const partID = event.properties.partID
          const parts = store.part[messageID]
          const result = Binary.search(parts, partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          // Drop pending debounced fields for this part only
          const acc = runningDelta.get(messageID)
          if (acc) {
            for (const key of [...acc.keys()]) {
              if (key.startsWith(partID + ":")) acc.delete(key)
            }
            if (acc.size === 0) clearRunningDeltaState(messageID)
          }
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      if (workspace !== syncedWorkspace) {
        fullSyncedSessions.clear()
        syncedWorkspace = workspace
      }
      const projectPromise = project.sync()
      // session.list depends on project.sync() populating projectWorktrees.
      // If called in parallel, listGlobal() sees empty worktrees → zero sessions.
      // Start it as soon as project resolves, but do not block first paint on it.
      const sessionListPromise = projectPromise.then(() =>
        sdk.client.session
          .list({})
          .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id))),
      )

      // Critical for interactive UI (model picker, agents, config, project path)
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })

      await Promise.all([
        providersPromise,
        providerListPromise,
        agentsPromise,
        configPromise,
        projectPromise,
      ])
        .then(async () => {
          const [providers, providerList, agents, config] = await Promise.all([
            providersPromise.then((x) => x.data!),
            providerListPromise.then((x) => x.data!),
            agentsPromise.then((x) => x.data ?? []),
            configPromise.then((x) => x.data!),
          ])

          batch(() => {
            setStore("provider", reconcile(providers.providers))
            setStore("provider_default", reconcile(providers.default))
            setStore("provider_next", reconcile(providerList))
            setStore("agent", reconcile(agents))
            setStore("config", reconcile(config))
          })
          // UI can accept prompts while session list / panels still load
          if (store.status !== "complete") setStore("status", "partial")
        })
        .then(async () => {
          // Apply sessions when ready (already in flight after project.sync)
          const sessions = await sessionListPromise
          batch(() => {
            const nextIDs = new Set(sessions.map((s) => s.id))
            for (const existing of store.session) {
              if (!nextIDs.has(existing.id)) cleanupSessionStores(existing.id)
            }
            setStore("session", reconcile(sessions))
          })
        })
        .then(() => {
          // non-blocking secondary panels
          void Promise.all([
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.session.status({ workspace }).then((x) => {
              setStore("session_status", reconcile(x.data ?? {}))
            }),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            await exit(e)
          } else {
            throw e
          }
        })
    }

    onMount(() => {
      void bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (process.env.OPENCODE_FAST_BOOT) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        async refresh() {
          const start = Date.now() - 30 * 24 * 60 * 60 * 1000
          const list = await sdk.client.session
            .list({ start })
            .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
          const nextIDs = new Set(list.map((s) => s.id))
          for (const existing of store.session) {
            if (!nextIDs.has(existing.id)) cleanupSessionStores(existing.id)
          }
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        sync: syncSession,
        loadOlder: loadOlderMessages,
      },
      bootstrap,
    }
    return result
  },
})

