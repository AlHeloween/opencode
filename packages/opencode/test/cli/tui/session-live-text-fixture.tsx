/** @jsxImportSource @opentui/solid */
import { expect } from "bun:test"
import { onMount } from "solid-js"
import { testRender } from "@opentui/solid"
import { Bus } from "@/bus"
import { SDKProvider } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { ProjectProvider } from "@tui/context/project"
import { ArgsProvider } from "@tui/context/args"
import { ExitProvider } from "@tui/context/exit"
import { KVProvider } from "@tui/context/kv"
import { RouteProvider, useRoute } from "@tui/context/route"
import { TuiConfigProvider } from "@tui/context/tui-config"
import { ThemeProvider } from "@tui/context/theme"
import { LocalProvider } from "@tui/context/local"
import { KeybindProvider } from "@tui/context/keybind"
import { PromptStashProvider } from "@tui/component/prompt/stash"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { CommandProvider } from "@tui/component/dialog-command"
import { FrecencyProvider } from "@tui/component/prompt/frecency"
import { PromptHistoryProvider } from "@tui/component/prompt/history"
import { PromptRefProvider } from "@tui/context/prompt"
import { EditorContextProvider } from "@tui/context/editor"
import { ToastProvider, Toast, useToast } from "@tui/ui/toast"
import { Session } from "@tui/routes/session"
import type { RevertTestUI } from "./session-revert-fixture"

export async function waitFor(ui: RevertTestUI, fn: () => boolean, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await ui.renderOnce()
    if (fn()) return
    if (Date.now() >= deadline) throw new Error(`bounded wait expired: ${label}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

export async function mountLiveSession(input: { url: string; directory: string; sid: string }) {
  type Handles = {
    sync: ReturnType<typeof useSync>
    dialog: ReturnType<typeof useDialog>
    toast: ReturnType<typeof useToast>
    route: ReturnType<typeof useRoute>
  }
  let resolve!: (handles: Handles) => void
  const ready = new Promise<Handles>((done) => {
    resolve = done
  })
  const Harness = () => {
    const sync = useSync()
    const dialog = useDialog()
    const toast = useToast()
    const route = useRoute()
    onMount(() => {
      resolve({ sync, dialog, toast, route })
    })
    return <text>LIVE_TEXT_STAND</text>
  }
  const events = {
    async subscribe(handler: (event: any) => void) {
      return Bus.subscribeAll((payload) => handler(JSON.parse(JSON.stringify({ directory: input.directory, payload }))))
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
                          <LocalProvider>
                            <KeybindProvider>
                              <PromptStashProvider>
                                <DialogProvider>
                                  <CommandProvider>
                                    <FrecencyProvider>
                                      <PromptHistoryProvider>
                                        <PromptRefProvider>
                                          <EditorContextProvider>
                                            <Toast />
                                            <Harness />
                                            <Session />
                                          </EditorContextProvider>
                                        </PromptRefProvider>
                                      </PromptHistoryProvider>
                                    </FrecencyProvider>
                                  </CommandProvider>
                                </DialogProvider>
                              </PromptStashProvider>
                            </KeybindProvider>
                          </LocalProvider>
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
    { width: 100, height: 35 },
  )) as RevertTestUI
  try {
    const handles = await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("live Session stand not ready")), 20_000)),
    ])
    await handles.sync.session.sync(input.sid)
    await ui.renderOnce()
    return {
      ui,
      handles,
      async frame() {
        await ui.renderOnce()
        return ui.captureCharFrame()
      },
      async navigate(sessionID: string) {
        handles.route.navigate({ type: "session", sessionID })
        await ui.renderOnce()
        expect(ui.captureCharFrame()).toBeTruthy()
      },
    }
  } catch (error) {
    ui.renderer.destroy()
    throw error
  }
}
