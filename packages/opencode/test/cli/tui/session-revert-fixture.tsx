/** @jsxImportSource @opentui/solid */
import { expect } from "bun:test"
import { onMount } from "solid-js"
import { createSignal } from "solid-js"
import { testRender, useKeyboard } from "@opentui/solid"
import { Bus } from "@/bus"
import { SDKProvider } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { ProjectProvider } from "@tui/context/project"
import { ArgsProvider } from "@tui/context/args"
import { ExitProvider } from "@tui/context/exit"
import { KVProvider } from "@tui/context/kv"
import { RouteProvider } from "@tui/context/route"
import { TuiConfigProvider } from "@tui/context/tui-config"
import { ThemeProvider } from "@tui/context/theme"
import { KeybindProvider } from "@tui/context/keybind"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { ToastProvider, Toast, useToast } from "@tui/ui/toast"
import { DialogMessage } from "@tui/routes/session/dialog-message"

export interface RevertTestUI {
  renderOnce: () => Promise<void>
  captureCharFrame: () => string
  mockInput: {
    pressEnter: () => void
    pressArrow: (direction: "up" | "down" | "left" | "right") => void
  }
  renderer: {
    destroy: () => void
  }
}

export async function qualifyRenderer() {
  const Marker = () => {
    const [state, setState] = createSignal("ENTER_PENDING")
    useKeyboard((event) => {
      if (event.name === "return") setState("ENTER_OK")
    })
    return <text>{state()}</text>
  }
  const ui = (await testRender(() => <Marker />, { width: 100, height: 30 })) as RevertTestUI
  try {
    await ui.renderOnce()
    expect(ui.captureCharFrame()).toContain("ENTER_PENDING")
    ui.mockInput.pressEnter()
    await ui.renderOnce()
    expect(ui.captureCharFrame()).toContain("ENTER_OK")
  } finally {
    ui.renderer.destroy()
  }
}

export async function waitFor(ui: RevertTestUI, fn: () => boolean, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await ui.renderOnce()
    if (fn()) return
    if (Date.now() >= deadline) throw new Error(`bounded wait expired: ${label}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

export async function mountRevertDialog(input: { url: string; directory: string; sid: string }) {
  type Handles = {
    sync: ReturnType<typeof useSync>
    dialog: ReturnType<typeof useDialog>
    toast: ReturnType<typeof useToast>
  }
  let resolve!: (handles: Handles) => void
  const ready = new Promise<Handles>((done) => {
    resolve = done
  })
  const prompts: unknown[] = []
  const Harness = () => {
    const sync = useSync()
    const dialog = useDialog()
    const toast = useToast()
    onMount(() => {
      resolve({ sync, dialog, toast })
    })
    return <text>REVERT_REGRESSION_STAND</text>
  }
  const events = {
    async subscribe(handler: (event: any) => void) {
      return Bus.subscribeAll((payload) => handler({ directory: input.directory, payload }))
    },
  }
  const ui = (await testRender(
    () => (
      <ArgsProvider>
        <ExitProvider>
          <KVProvider>
            <ToastProvider>
              <RouteProvider initialRoute={{ type: "session", sessionID: input.sid }}>
                <TuiConfigProvider
                  config={{
                    theme: "opencode",
                    scroll_speed: 3,
                    diff_style: "auto",
                    mouse: true,
                    image_protocol: "auto",
                    keybinds: {},
                  }}
                >
                  <SDKProvider url={input.url} directory={input.directory} events={events}>
                    <ProjectProvider>
                      <SyncProvider>
                        <ThemeProvider mode="dark">
                          <KeybindProvider>
                            <DialogProvider>
                              <Toast />
                              <Harness />
                            </DialogProvider>
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
    ),
    { width: 100, height: 30 },
  )) as RevertTestUI
  try {
    const handles = await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("real SyncProvider not ready")), 20_000)),
    ])
    await handles.sync.session.sync(input.sid)
    return {
      ui,
      prompts,
      handles,
      async open(sessionID: string, messageID: string) {
        handles.dialog.replace(() => (
          <DialogMessage sessionID={sessionID} messageID={messageID} setPrompt={(prompt) => prompts.push(prompt)} />
        ))
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
