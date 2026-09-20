import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import {
  createContext,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useKeybind, type KeybindKey } from "@tui/context/keybind"
import { COMMAND_HINTS } from "./command-hints"

type Context = ReturnType<typeof init>
const ctx = createContext<Context>()

export type Slash = {
  name: string
  aliases?: string[]
}

export type CommandOption = DialogSelectOption<string> & {
  keybind?: KeybindKey
  suggested?: boolean
  slash?: Slash
  hidden?: boolean
  enabled?: boolean
}

function init() {
  const root = getOwner()
  const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
  const [suspendCount, setSuspendCount] = createSignal(0)
  const dialog = useDialog()
  const keybind = useKeybind()

  const entries = createMemo(() => {
    const all = registrations().flatMap((x) => x())
    return all.map((x) => ({
      ...x,
      footer: x.keybind ? keybind.print(x.keybind) : undefined,
    }))
  })

  const isEnabled = (option: CommandOption) => option.enabled !== false
  const isVisible = (option: CommandOption) => isEnabled(option) && !option.hidden

  const visibleOptions = createMemo(() => entries().filter((option) => isVisible(option)))
  const suggestedOptions = createMemo(() =>
    visibleOptions()
      .filter((option) => option.suggested)
      .map((option) => ({
        ...option,
        value: `suggested:${option.value}`,
        category: "Suggested",
      })),
  )
  const suspended = () => suspendCount() > 0

  useKeyboard((evt) => {
    if (suspended()) return
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    for (const option of entries()) {
      if (!isEnabled(option)) continue
      if (option.keybind && keybind.match(option.keybind, evt)) {
        evt.preventDefault()
        option.onSelect?.(dialog)
        return
      }
    }
  })

  const result = {
    trigger(name: string) {
      for (const option of entries()) {
        if (option.value === name) {
          if (!isEnabled(option)) return
          option.onSelect?.(dialog)
          return
        }
      }
    },
    slashes() {
      return visibleOptions().flatMap((option) => {
        const slash = option.slash
        if (!slash) return []
        return {
          display: "/" + slash.name,
          description: option.description ?? option.title,
          aliases: slash.aliases?.map((alias) => "/" + alias),
          onSelect: () => result.trigger(option.value),
        }
      })
    },
    keybinds(enabled: boolean) {
      setSuspendCount((count) => count + (enabled ? -1 : 1))
    },
    suspended,
    show() {
      dialog.replace(() => <DialogCommand options={visibleOptions()} suggestedOptions={suggestedOptions()} />)
    },
    register(cb: () => CommandOption[]) {
      const owner = getOwner() ?? root
      if (!owner) return () => {}

      let list: Accessor<CommandOption[]> | undefined

      // TUI plugins now register commands via an async store that runs outside an active reactive scope.
      // runWithOwner attaches createMemo/onCleanup to this owner so plugin registrations stay reactive and dispose correctly.
      runWithOwner(owner, () => {
        list = createMemo(cb)
        const ref = list
        if (!ref) return
        setRegistrations((arr) => [ref, ...arr])
        onCleanup(() => {
          setRegistrations((arr) => arr.filter((x) => x !== ref))
        })
      })

      if (!list) return () => {}
      let done = false
      return () => {
        if (done) return
        done = true
        const ref = list
        if (!ref) return
        setRegistrations((arr) => arr.filter((x) => x !== ref))
      }
    },
  }
  return result
}

export function useCommandDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within a CommandProvider")
  }
  return value
}

export function CommandProvider(props: ParentProps) {
  const value = init()
  const dialog = useDialog()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (value.suspended()) return
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    if (keybind.match("command_list", evt)) {
      evt.preventDefault()
      value.show()
      return
    }
  })

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

/** What the highlighted command DOES, in one line under the list.
 *
 * The text comes from `command-hints.ts` — a per-command table written from the
 * registrations and their handlers, NOT from the keybind descriptions: those are
 * phrased for a keybind list, are terse, and do not exist for a command without a
 * keybind (Alexander, 2026-09-20: «для каждой команды хинт … не копипастить, а
 * написать свою таблицу хинтов проверив кодовую базу»). A command with no entry
 * yet falls back to the `description` its own registration authored.
 *
 * `suggestedOptions()` rewrites a value as `suggested:<value>` for the Suggested
 * section, so the prefix is stripped before the lookup — otherwise every suggested
 * row would silently lose its hint. */
function commandHint(option: CommandOption | undefined) {
  if (!option) return undefined
  const value = option.value.startsWith("suggested:") ? option.value.slice("suggested:".length) : option.value
  return COMMAND_HINTS[value] ?? option.description
}

function DialogCommand(props: { options: CommandOption[]; suggestedOptions: CommandOption[] }) {
  let ref: DialogSelectRef<string>
  const list = () => {
    if (ref?.filter) return props.options
    return [...props.suggestedOptions, ...props.options]
  }
  return <DialogSelect ref={(r) => (ref = r)} title="Commands" options={list()} hint={commandHint} />
}
