// Probe: are the keybind descriptions (written in config/keybinds.ts as Effect
// Schema annotations) reachable at RUNTIME from the exported zod object?
//
// If yes, the command palette's footer hint can reuse the ONE authoritative
// text that already exists for every keybind — no second owner, no new prose.
//
// Run: bun experiments/2026-09-20_palette-hint/probe-keybind-descriptions.ts
import { ConfigKeybinds } from "../../packages/opencode/src/config/keybinds"

const shape = ConfigKeybinds.Keybinds.shape as Record<string, any>
const names = Object.keys(shape)
console.log("keybind fields:", names.length)

for (const key of ["messages_toggle_conceal", "session_compact", "command_list"]) {
  const field = shape[key]
  const candidates = {
    "field.description": field?.description,
    "field._def.description": field?._def?.description,
  }
  console.log(key, JSON.stringify(candidates))
}

const sample = shape["messages_toggle_conceal"]
console.log("has _def:", !!sample?._def, "| _def keys:", sample?._def ? Object.keys(sample._def).join(",") : "-")
console.log("sample typeName:", sample?._def?.typeName)
