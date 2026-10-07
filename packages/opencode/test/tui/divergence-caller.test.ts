import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { batch, createEffect, createMemo, createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { arrivalUpdate, sessionTranscriptInput } from "../../src/cli/cmd/tui/util/divergence"
import { createDivergenceReporter } from "../../src/cli/cmd/tui/util/divergence-reporter"
import { revertedRun } from "../../src/cli/cmd/tui/util/reverted-run"

// The CALLER of the divergence reporter: `routes/session/index.tsx` runs
//   createEffect(() => divergenceReporter.observe(sessionTranscriptInput({...})))
// over the sync store, and `context/sync.tsx` feeds that store on
// `message.updated` with `setStore("arrived", sid, arrivalUpdate(id))` plus the
// message row. This test drives the same functions through a real Solid store
// and reactive effect, starting from the empty initial store, and reads the
// JSONL trace back. The Session component itself is not mounted here (it needs
// the full TUI provider tree); its effect body is the single call reproduced below.

type Row = { id: string; role: string }
type Data = {
  session_status: { [sessionID: string]: { type: string } }
  arrived: { [sessionID: string]: string[] }
  message: { [sessionID: string]: Row[] }
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tracePath = () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-caller-"))
  dirs.push(dir)
  return join(dir, "tui-divergence", "1.jsonl")
}
const records = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line))

const SID = "ses_1"

function mount(path: string) {
  const [data, setData] = createStore<Data>({ session_status: {}, arrived: {}, message: {} })
  const [revert, setRevert] = createSignal<{ messageID: string; partID?: string } | undefined>()
  // What the render drops on its own — the hidden-transcript defect class.
  const [dropped, setDropped] = createSignal<ReadonlySet<string>>(new Set())
  const failures: string[] = []
  const reporter = createDivergenceReporter(path, (error) => failures.push(String(error)))
  const dispose = createRoot((dispose) => {
    const messages = createMemo(() => data.message[SID] ?? [])
    const messagesList = createMemo(() => messages().filter((m) => !dropped().has(m.id)))
    createEffect(() => {
      reporter.observe(
        sessionTranscriptInput({
          sessionID: SID,
          data,
          listed: messagesList(),
          revert: revert(),
          revertedRun: (id) => revertedRun(messages(), id),
        }),
      )
    })
    return dispose
  })
  // The `message.updated` handler of sync.tsx: arrival mark first, then the row.
  const messageUpdated = (row: Row) =>
    batch(() => {
      setData("arrived", SID, arrivalUpdate(row.id))
      setData("message", SID, (current) => [...(current ?? []), row])
    })
  // An arrival whose row never reached the store.
  const arrivalOnly = (id: string) => setData("arrived", SID, arrivalUpdate(id))
  return { dispose, failures, messageUpdated, arrivalOnly, setData, setRevert, setDropped }
}

describe("TUI divergence caller", () => {
  test("empty initial store, then a healthy arrival, are both written by the caller", () => {
    const path = tracePath()
    const ui = mount(path)
    ui.messageUpdated({ id: "m1", role: "user" })
    ui.dispose()
    const rows = records(path)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: "snapshot", sessionID: SID, status: "unknown", arrivedCount: 0, heldCount: 0, listedCount: 0 })
    expect(rows[1]).toMatchObject({
      arrivedCount: 1,
      heldCount: 1,
      listedCount: 1,
      hiddenCount: 0,
      missingStoreCount: 0,
      arrived: ["m1"],
    })
    expect(ui.failures).toEqual([])
  })

  test("a status transition with no new message is recorded", () => {
    const path = tracePath()
    const ui = mount(path)
    ui.messageUpdated({ id: "m1", role: "user" })
    ui.setData("session_status", SID, { type: "busy" })
    ui.dispose()
    expect(records(path).at(-1)).toMatchObject({ status: "busy", arrivedCount: 1, hiddenCount: 0 })
  })

  test("the caller forces the hidden and the missing-store alternatives apart", () => {
    const path = tracePath()
    const ui = mount(path)
    ui.messageUpdated({ id: "m1", role: "user" })
    ui.setDropped(new Set(["m1"]))
    ui.arrivalOnly("m2")
    ui.dispose()
    const rows = records(path)
    expect(rows.at(-2)).toMatchObject({ hiddenCount: 1, hidden: ["m1"], missingStoreCount: 0 })
    expect(rows.at(-1)).toMatchObject({ hiddenCount: 1, hidden: ["m1"], missingStoreCount: 1, missingStore: ["m2"] })
  })

  test("a legitimately reverted run is exempt, not hidden", () => {
    const path = tracePath()
    const ui = mount(path)
    ui.messageUpdated({ id: "m1", role: "user" })
    ui.messageUpdated({ id: "m2", role: "assistant" })
    batch(() => {
      ui.setRevert({ messageID: "m1" })
      ui.setDropped(new Set(["m1", "m2"]))
    })
    ui.dispose()
    expect(records(path).at(-1)).toMatchObject({ revertID: "m1", hiddenCount: 0, exemptCount: 2, exempt: ["m2", "m1"] })
  })
})
