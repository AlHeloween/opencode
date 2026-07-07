/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { DialogProvider } from "../../../src/cli/cmd/tui/ui/dialog"
import { DialogTuiConfig } from "../../../src/cli/cmd/tui/ui/dialog-tui-config"
import { ThemeProvider } from "../../../src/cli/cmd/tui/context/theme"
import { KeybindProvider } from "../../../src/cli/cmd/tui/context/keybind"
import { TuiConfigProvider } from "../../../src/cli/cmd/tui/context/tui-config"
import { KVProvider } from "../../../src/cli/cmd/tui/context/kv"
import type { TuiConfig } from "../../../src/cli/cmd/tui/config/tui"

const defaultConfig: TuiConfig.Info = {
  theme: "opencode",
  scroll_speed: 3,
  diff_style: "auto",
  mouse: true,
  image_protocol: "auto",
  keybinds: {},
}

describe("dialog-tui-config", () => {
  test("renders without crashing", async () => {
    const app = await testRender(() => (
      <KVProvider>
        <TuiConfigProvider config={defaultConfig}>
          <KeybindProvider>
            <ThemeProvider mode="dark">
              <DialogProvider>
                <DialogTuiConfig />
              </DialogProvider>
            </ThemeProvider>
          </KeybindProvider>
        </TuiConfigProvider>
      </KVProvider>
    ))
    expect(app).toBeDefined()
  })
})
