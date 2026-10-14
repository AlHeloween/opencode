/** @jsxImportSource @opentui/solid */
import { expect } from "bun:test"
import { createSignal, onMount } from "solid-js"
import { testRender, useKeyboard } from "@opentui/solid"
import { Bus } from "../../packages/opencode/src/bus"
import { SDKProvider } from "../../packages/opencode/src/cli/cmd/tui/context/sdk"
import { SyncProvider, useSync } from "../../packages/opencode/src/cli/cmd/tui/context/sync"
import { ProjectProvider } from "../../packages/opencode/src/cli/cmd/tui/context/project"
import { ArgsProvider } from "../../packages/opencode/src/cli/cmd/tui/context/args"
import { ExitProvider } from "../../packages/opencode/src/cli/cmd/tui/context/exit"
import { KVProvider } from "../../packages/opencode/src/cli/cmd/tui/context/kv"
import { RouteProvider } from "../../packages/opencode/src/cli/cmd/tui/context/route"
import { TuiConfigProvider } from "../../packages/opencode/src/cli/cmd/tui/context/tui-config"
import { ThemeProvider } from "../../packages/opencode/src/cli/cmd/tui/context/theme"
import { KeybindProvider } from "../../packages/opencode/src/cli/cmd/tui/context/keybind"
import { DialogProvider, useDialog } from "../../packages/opencode/src/cli/cmd/tui/ui/dialog"
import { ToastProvider } from "../../packages/opencode/src/cli/cmd/tui/ui/toast"
import { DialogMessage } from "../../packages/opencode/src/cli/cmd/tui/routes/session/dialog-message"

export async function qualifyRenderer() {
  const Marker = () => {
    const [state, setState] = createSignal("ENTER_PENDING")
    useKeyboard((event) => { if (event.name === "return") setState("ENTER_OK") })
    return <text>{state()}</text>
  }
  const ui = await testRender(() => <Marker />, { width: 100, height: 30 })
  try {
    await ui.renderOnce()
    expect(ui.captureCharFrame()).toContain("ENTER_PENDING")
    ui.mockInput.pressEnter()
    await ui.renderOnce()
    expect(ui.captureCharFrame()).toContain("ENTER_OK")
  } finally { ui.renderer.destroy() }
}

export async function mountDialog(input: { url: string; directory: string; sid: string }) {
  type Handles = { sync: ReturnType<typeof useSync>; dialog: ReturnType<typeof useDialog> }
  let resolve!: (handles: Handles) => void
  const ready = new Promise<Handles>((done) => { resolve = done })
  const prompts: unknown[] = []
  const Harness = () => {
    const sync = useSync()
    const dialog = useDialog()
    onMount(() => { resolve({ sync, dialog }) })
    return <text>UNDO_DIALOG_STAND</text>
  }
  const events = {
    async subscribe(handler: (event: any) => void) {
      return Bus.subscribeAll((payload) => handler({ directory: input.directory, payload }))
    },
  }
  const ui = await testRender(() => (
    <ArgsProvider>
      <ExitProvider>
        <KVProvider>
          <ToastProvider>
            <RouteProvider initialRoute={{ type: "session", sessionID: input.sid }}>
              <TuiConfigProvider config={{ theme: "opencode", scroll_speed: 3, diff_style: "auto", mouse: true, image_protocol: "auto", keybinds: {} }}>
                <SDKProvider url={input.url} directory={input.directory} events={events}>
                  <ProjectProvider>
                    <SyncProvider>
                      <ThemeProvider mode="dark">
                        <KeybindProvider>
                          <DialogProvider><Harness /></DialogProvider>
                        </KeybindProvider>
                      </ThemeProvider>
                    </SyncProvider>
                  </ProjectProvider>
                </SDKProvider>
              </TuiConfigProvider>
            </RouteProvider>
          </ToastProvider>
        </KVProvider>
      </ExitProvider>
    </ArgsProvider>
  ), { width: 100, height: 30 })
  try {
    const handles = await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("real SyncProvider not ready")), 20_000)),
    ])
    await handles.sync.session.sync(input.sid)
    return {
      ui, prompts, handles,
      async open(sessionID: string, messageID: string) {
        handles.dialog.replace(() => <DialogMessage sessionID={sessionID} messageID={messageID} setPrompt={(prompt) => prompts.push(prompt)} />)
        await ui.renderOnce()
        expect(ui.captureCharFrame()).toContain("Revert")
      },
      async enter() {
        if (ui.captureCharFrame().includes("Cancel queued message")) {
          ui.mockInput.pressArrow("down")
          await ui.renderOnce()
        }
        ui.mockInput.pressEnter()
        await ui.renderOnce()
      },
    }
  } catch (error) {
    ui.renderer.destroy()
    throw error
  }
}
