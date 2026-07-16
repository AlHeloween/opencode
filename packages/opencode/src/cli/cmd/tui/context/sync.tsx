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
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }, { throwOnError: true }),
            sdk.client.session.todo({ sessionID }, { throwOnError: true }),
            sdk.client.session.diff({ sessionID }, { throwOnError: true }),
          ])
          // Guard: skip write if the session was deleted while inflight was running.
          // Without this, a completed inflight can re-add a session that the
          // `session.deleted` event handler already removed from the store.
          if (!fullSyncedSessions.has(sessionID) && Binary.search(store.session, sessionID, (s) => s.id).found === false) {
            return
          }
          const messageList = messages.data ?? []
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
        })()
        inflightSyncs.set(sessionID, task)
        try {
          await task
        } finally {
          if (inflightSyncs.get(sessionID) === task) inflightSyncs.delete(sessionID)
        }
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
          if (updated.length > 100) {
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
                // Cleanup delta buffer for evicted message
                deltaBuffer.delete(oldest.id)
                deltaBufferTimestamps.delete(oldest.id)
              })
            }
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            // Flush any deltas that arrived before this part
            flushDeltaBuffer(event.properties.part.messageID)
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          // Flush any deltas that arrived before this part
          flushDeltaBuffer(event.properties.part.messageID)
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
        setStore(
          "part",
          messageID,
          produce((draft) => {
            const part = draft[result.index]
            const existing = (part as any)[field] ?? ""
            ;(part as any)[field] = existing + delta
          }),
        )
        break
      }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
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
      const sessionListPromise = projectPromise.then(() =>
        sdk.client.session
          .list({})
          .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id))),
      )

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
      const blockingRequests: Promise<unknown>[] = [
        providersPromise,
        providerListPromise,
        agentsPromise,
        configPromise,
        projectPromise,
        sessionListPromise,
      ]

      await Promise.all(blockingRequests)
        .then(async () => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = sessionListPromise

          return Promise.all([
            providersResponse,
            providerListResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            sessionListResponse,
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const consoleState = responses[2]
            const agents = responses[3]
            const config = responses[4]
            const sessions = responses[5]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) {
                const nextIDs = new Set(sessions.map((s) => s.id))
                for (const existing of store.session) {
                  if (!nextIDs.has(existing.id)) cleanupSessionStores(existing.id)
                }
                setStore("session", reconcile(sessions))
              }
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
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
      },
      bootstrap,
    }
    return result
  },
})

