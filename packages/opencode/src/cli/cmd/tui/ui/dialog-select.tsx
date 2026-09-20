import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { entries, filter, flatMap, groupBy, pipe } from "remeda"
import { batch, createEffect, createMemo, For, Show, type JSX, on } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import * as fuzzysort from "fuzzysort"
import { isDeepEqual } from "remeda"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import { getScrollAcceleration } from "../util/scroll"
import { useTuiConfig } from "../context/tui-config"

export interface DialogSelectProps<T> {
  title: string
  placeholder?: string
  options: DialogSelectOption<T>[]
  flat?: boolean
  ref?: (ref: DialogSelectRef<T>) => void
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  skipFilter?: boolean
  keybind?: {
    keybind?: Keybind.Info
    title: string
    side?: "left" | "right"
    disabled?: boolean
    onTrigger: (option: DialogSelectOption<T>) => void
  }[]
  current?: T
  /** Position the cursor on this option's row WITHOUT touching the
   * "current" (←) marker. For dialogs that re-create themselves after an
   * in-place action (DialogAgent ctrl+t variant cycle) so the highlighted
   * row stays stable instead of resetting to the first option. */
  cursorValue?: T
  /** Footer hint for the highlighted option — the command palette uses it to
   * explain what the SELECTED command does, changing as the cursor moves.
   * Return undefined to hide the line. Additive: dialogs that do not pass it
   * are unaffected. */
  hint?: (option: DialogSelectOption<T> | undefined) => string | undefined
}

export interface DialogSelectOption<T = any> {
  title: string
  value: T
  description?: string
  footer?: JSX.Element | string
  category?: string
  categoryView?: JSX.Element
  disabled?: boolean
  bg?: RGBA
  gutter?: JSX.Element
  margin?: JSX.Element
  onSelect?: (ctx: DialogContext) => void
}

export type DialogSelectRef<T> = {
  filter: string
  filtered: DialogSelectOption<T>[]
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const [store, setStore] = createStore({
    selected: 0,
    // The VALUE the cursor sits on, not just its ordinal.
    //
    // `selected` alone is an index into a list that is rebuilt reactively:
    // for the model picker `options()` recomputes from sync.data.provider,
    // favorites and recents, and its sort reads cost data that arrives
    // asynchronously. Re-anchoring used to happen only when the filter or
    // `props.current` changed, so any other rebuild left the index pointing at
    // whatever model had moved into that slot — the cursor silently jumped to a
    // different row, and Enter selected that one (2026-09-18, Alexander:
    // highlighted Z.ai via OpenRouter, got GLM-5.3-Flash-BF16 via Hugging Face).
    anchor: undefined as T | undefined,
    filter: "",
    input: "keyboard" as "keyboard" | "mouse",
  })

  /** Move the cursor and remember WHAT it is on, so a rebuild cannot repoint it. */
  function setCursor(index: number) {
    setStore("selected", index)
    setStore("anchor", () => flat()[index]?.value)
  }

  createEffect(
    on(
      () => props.current,
      (current) => {
        if (current) {
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            setCursor(currentIndex)
          }
        }
      },
    ),
  )

  createEffect(
    on(
      () => props.cursorValue,
      (cursorValue) => {
        if (cursorValue === undefined) return
        const index = flat().findIndex((opt) => isDeepEqual(opt.value, cursorValue))
        if (index >= 0) setCursor(index)
      },
    ),
  )

  let input: InputRenderable

  const filtered = createMemo(() => {
    if (props.skipFilter) return props.options.filter((x) => x.disabled !== true)
    const needle = store.filter.toLowerCase()
    const options = pipe(
      props.options,
      filter((x) => x.disabled !== true),
    )
    if (!needle) return options

    // prioritize title matches (weight: 2) over category matches (weight: 1).
    // users typically search by the item name, and not its category.
    const result = fuzzysort
      .go(needle, options, {
        keys: ["title", "category"],
        scoreFn: (r) => r[0].score * 2 + r[1].score,
      })
      .map((x) => x.obj)

    return result
  })

  // When the filter changes due to how TUI works, the mousemove might still be triggered
  // via a synthetic event as the layout moves underneath the cursor. This is a workaround to make sure the input mode remains keyboard
  // that the mouseover event doesn't trigger when filtering.
  createEffect(() => {
    filtered()
    setStore("input", "keyboard")
  })

  const flatten = createMemo(() => props.flat && store.filter.length > 0)

  const grouped = createMemo<[string, DialogSelectOption<T>[]][]>(() => {
    if (flatten()) return [["", filtered()]]
    const result = pipe(
      filtered(),
      groupBy((x) => x.category ?? ""),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
    )
    return result
  })

  const flat = createMemo(() => {
    return pipe(
      grouped(),
      flatMap(([_, options]) => options),
    )
  })

  // The list is rebuilt whenever its inputs change — provider sync, favorites,
  // recents, a sort that reads late-arriving cost data. Follow the anchored
  // VALUE to its new position instead of leaving the ordinal where it was.
  createEffect(
    on(flat, (options) => {
      const anchor = store.anchor
      if (anchor === undefined) return
      const index = options.findIndex((opt) => isDeepEqual(opt.value, anchor))
      if (index >= 0) {
        if (index !== store.selected) setStore("selected", index)
        return
      }
      // The anchored option is gone (filtered out, deprecated, provider
      // dropped). Clamp rather than leave an index past the end, and drop the
      // anchor so the next move re-establishes it.
      setStore("selected", Math.min(store.selected, Math.max(0, options.length - 1)))
      setStore("anchor", () => options[store.selected]?.value)
    }),
  )

  // Usable text width for Option rows (rev 4: long rows must split into two
  // lines instead of overlapping/crushing) — dialog width minus list paddings.
  const rowWidth = createMemo(() => {
    const size = dialog.size
    return size === "xlarge" ? 116 : size === "large" ? 88 : 60
  })

  // Header geometry, from the SAME width the rows use.
  //
  // The row width must be stated EXPLICITLY: the flex chain above it resolves to content
  // size, so `justifyContent="space-between"` had no free space to hand out and the esc
  // hint sat hard against the title even with the dialog almost empty (reported
  // 2026-09-19) — the same pattern in dialog-confirm/dialog-alert/dialog-prompt is
  // affected for the same reason.
  //
  // `titleWidth` then keeps a title from overrunning the row at the smallest size:
  // 60 − 8 (padding) − 3 ("esc") − 1 (gap) = 48.
  const headerWidth = createMemo(() => rowWidth() - 8)
  const titleWidth = createMemo(() => headerWidth() - 4)

  const rows = createMemo(() => {
    const headers = grouped().reduce((acc, [category], i) => {
      if (!category) return acc
      return acc + (i > 0 ? 2 : 1)
    }, 0)
    // One line per option, always (Alexander, 2026-09-20: «все в одну строчку»). A row used
    // to be allowed a second line for a long description, and the height had to model it;
    // now the DESCRIPTION yields width instead of taking a line, so this count is exact.
    const lines = grouped().reduce((acc, [, options]) => acc + options.length, 0)
    return lines + headers
  })

  const dimensions = useTerminalDimensions()
  const height = createMemo(() => Math.min(rows(), Math.floor(dimensions().height / 2) - 6))

  const selected = createMemo(() => flat()[store.selected])

  createEffect(
    on([() => store.filter, () => props.current], ([filter, current]) => {
      setTimeout(() => {
        if (filter.length > 0) {
          moveTo(0, true)
        } else if (current && props.cursorValue === undefined) {
          // cursorValue wins the race: this delayed effect fires AFTER mount and
          // used to drag the cursor to `current`, overriding the restore position
          // (2026-08-30, Alexander: ctrl+t cursor jump regression).
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            moveTo(currentIndex, true)
          }
        }
      }, 0)
    }),
  )

  function move(direction: number) {
    if (flat().length === 0) return
    let next = store.selected + direction
    if (next < 0) next = flat().length - 1
    if (next >= flat().length) next = 0
    moveTo(next, true)
  }

  function moveTo(next: number, center = false) {
    setCursor(next)
    const option = selected()
    if (option) props.onMove?.(option)
    if (!scroll) return
    const target = scroll.getChildren().find((child) => {
      return child.id === JSON.stringify(selected()?.value)
    })
    if (!target) return
    const y = target.y - scroll.y
    if (center) {
      const centerOffset = Math.floor(scroll.height / 2)
      scroll.scrollBy(y - centerOffset)
    } else {
      if (y >= scroll.height) {
        scroll.scrollBy(y - scroll.height + 1)
      }
      if (y < 0) {
        scroll.scrollBy(y)
        if (isDeepEqual(flat()[0].value, selected()?.value)) {
          scroll.scrollTo(0)
        }
      }
    }
  }

  const keybind = useKeybind()
  useKeyboard((evt) => {
    setStore("input", "keyboard")

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) move(-1)
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) move(1)
    if (evt.name === "pageup") move(-10)
    if (evt.name === "pagedown") move(10)
    if (evt.name === "home") moveTo(0)
    if (evt.name === "end") moveTo(flat().length - 1)

    if (evt.name === "return") {
      const option = selected()
      if (option) {
        evt.preventDefault()
        evt.stopPropagation()
        if (option.onSelect) option.onSelect(dialog)
        props.onSelect?.(option)
      }
    }

    for (const item of props.keybind ?? []) {
      if (item.disabled || !item.keybind) continue
      if (Keybind.match(item.keybind, keybind.parse(evt))) {
        const s = selected()
        if (s) {
          evt.preventDefault()
          item.onTrigger(s)
        }
      }
    }
  })

  let scroll: ScrollBoxRenderable | undefined
  const ref: DialogSelectRef<T> = {
    get filter() {
      return store.filter
    },
    get filtered() {
      return filtered()
    },
  }
  props.ref?.(ref)

  const keybinds = createMemo(() => props.keybind?.filter((x) => !x.disabled && x.keybind) ?? [])
  const left = createMemo(() => keybinds().filter((item) => item.side !== "right"))
  const right = createMemo(() => keybinds().filter((item) => item.side === "right"))
  /** Hotkeys in COLUMNS, not a wrapped run: every hint gets the SAME cell width, so the keys
   * line up vertically and the eye can scan down a column (Alexander, 2026-09-20: «hotkeys -
   * четко столбиками»). Three per line at the dialog's width. */
  const KEYBIND_COLUMNS = 3
  const keybindCellWidth = createMemo(() => Math.max(20, Math.floor((rowWidth() - 8) / KEYBIND_COLUMNS)))
  const keybindRows = createMemo(() => {
    const all = [...left(), ...right()]
    const out: (typeof all)[] = []
    for (let i = 0; i < all.length; i += KEYBIND_COLUMNS) out.push(all.slice(i, i + KEYBIND_COLUMNS))
    return out
  })
  /** The highlighted option's explanation, computed live so the footer follows
   * the cursor: the list says WHERE you are, the footer says WHAT it does. */
  const hintText = createMemo(() => props.hint?.(selected()))

  // Usable text width for Option rows (rev 4: long rows must split into two
  // lines instead of overlapping/crushing) — dialog width minus list paddings.
  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between" width={headerWidth()}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {Locale.truncate(props.title, titleWidth())}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box paddingTop={1}>
          <input
            onInput={(e) => {
              batch(() => {
                setStore("filter", e)
                props.onFilter?.(e)
              })
            }}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            focusedTextColor={theme.textMuted}
            ref={(r) => {
              input = r
              input.traits = { status: "FILTER" }
              setTimeout(() => {
                if (!input) return
                if (input.isDestroyed) return
                input.focus()
              }, 1)
            }}
            placeholder={props.placeholder ?? "Search"}
            placeholderColor={theme.textMuted}
          />
        </box>
      </box>
      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>No results found</text>
          </box>
        }
      >
        <scrollbox
          paddingLeft={1}
          paddingRight={1}
          scrollbarOptions={{ visible: false }}
          scrollAcceleration={scrollAcceleration()}
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          maxHeight={height()}
        >
          <For each={grouped()}>
            {([category, options], index) => (
              <>
                <Show when={category}>
                  <box paddingTop={index() > 0 ? 1 : 0} paddingLeft={3}>
                    <Show
                      when={options[0]?.categoryView}
                      fallback={
                        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                          {category}
                        </text>
                      }
                    >
                      {options[0]?.categoryView}
                    </Show>
                  </box>
                </Show>
                <For each={options}>
                  {(option) => {
                    const active = createMemo(() => isDeepEqual(option.value, selected()?.value))
                    const current = createMemo(() => isDeepEqual(option.value, props.current))
                    return (
                      <box
                        id={JSON.stringify(option.value)}
                        flexDirection="row"
                        position="relative"
                        // The row needs an EXPLICIT width, for the same reason the header does:
                        // that flex chain resolves to content size, so `flex-end` on the footer
                        // had no free space to consume and every row's model sat at a different
                        // x — measured on /agents at scope:worktree, the right column landed at
                        // 977/870/808/840/800/810 px (Alexander: «Теперь посмотри на
                        // форматирование»). With a stated width the footer reaches the panel's
                        // right edge and the rows share ONE column.
                        width={rowWidth() - 2}
                        onMouseMove={() => {
                          setStore("input", "mouse")
                        }}
                        onMouseUp={() => {
                          option.onSelect?.(dialog)
                          props.onSelect?.(option)
                        }}
                        onMouseOver={() => {
                          if (store.input !== "mouse") return
                          const index = flat().findIndex((x) => isDeepEqual(x.value, option.value))
                          if (index === -1) return
                          moveTo(index)
                        }}
                        onMouseDown={() => {
                          const index = flat().findIndex((x) => isDeepEqual(x.value, option.value))
                          if (index === -1) return
                          moveTo(index)
                        }}
                        backgroundColor={active() ? (option.bg ?? theme.primary) : RGBA.fromInts(0, 0, 0, 0)}
                        paddingLeft={current() || option.gutter ? 1 : 3}
                        paddingRight={3}
                        gap={1}
                      >
                        <Show when={!current() && option.margin}>
                          <box position="absolute" left={1} flexShrink={0}>
                            {option.margin}
                          </box>
                        </Show>
                        <Option
                          title={option.title}
                          // Flatten (filter active, flat=true) hides the section
                          // headers, so the category (provider name) must remain
                          // visible — it moves to the DESCRIPTION slot. The old
                          // code swapped it into the FOOTER slot, REPLACING the
                          // capability footer — model metadata (reasoning/tools/
                          // vision/ctx) vanished the moment the user typed a
                          // filter (2026-09-02, Alexander).
                          footer={option.footer}
                          description={
                            flatten()
                              ? (option.description ?? option.category)
                              : option.description !== category
                                ? option.description
                                : undefined
                          }
                          active={active()}
                          current={current()}
                          gutter={option.gutter}
                          rowWidth={rowWidth()}
                        />
                      </box>
                    )
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
      <Show when={hintText()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexShrink={0}>
          <text wrapMode="word">
            <span style={{ fg: theme.text }}>
              <b>{selected()?.title ?? ""}</b>{" "}
            </span>
            <span style={{ fg: theme.textMuted }}>{hintText()}</span>
          </text>
        </box>
      </Show>
      <Show when={keybinds().length} fallback={<box flexShrink={0} />}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="column" flexShrink={0}>
          <For each={keybindRows()}>
            {(row) => (
              <box flexDirection="row" flexShrink={0}>
                <For each={row}>
                  {(item) => (
                    <box width={keybindCellWidth()} flexShrink={0}>
                      <text wrapMode="none">
                        <span style={{ fg: theme.text }}>
                          <b>{item.title}</b>{" "}
                        </span>
                        <span style={{ fg: theme.textMuted }}>{Keybind.toString(item.keybind)}</span>
                      </text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

/** A model name below this is not identifiable; the runtime hint yields first. */
const MIN_TITLE_WIDTH = 24

/**
 * Width the description may take in a one-line row.
 *
 * Pure, and exported so a test pins the CONTRACT rather than the appearance: the description
 * is the part that yields, so its budget is the dialog width minus the marker/gutter, the
 * title's indent, the gaps, the row's right padding and the runtime hint.
 */
export function descriptionBudget(input: { title: string; footer?: JSX.Element | string; rowWidth?: number }): number {
  const width = input.rowWidth ?? 60
  const footerLen = typeof input.footer === "string" ? input.footer.length : 0
  // The title occupies its own length OR ITS FLOOR — the floor wins for a short name, and
  // missing that made the budget wider than the space the layout actually hands out, so the
  // description was clipped by the renderer with no ellipsis and ran into the runtime hint
  // (measured on /agents: «Autonomous development orchestrato huggingfac…»).
  const titleWidth = Math.max(input.title.length, MIN_TITLE_WIDTH)
  // 2 marker/gutter + 3 title indent + 2 gaps + 3 row padding right + 2 separators
  return width - 12 - titleWidth - footerLen
}

function Option(props: {
  title: string
  description?: string
  active?: boolean
  current?: boolean
  footer?: JSX.Element | string
  gutter?: JSX.Element
  /** Dialog inner width (medium 60 / large 88 / xlarge 116) — rows whose
   * title + description + footer exceed it drop the description to a second
   * muted line instead of crushing the title against the footer (rev 4). */
  rowWidth?: number
  onMouseOver?: () => void
}) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  // ONE line, in columns:
  //   [marker/gutter] [title: floor] [description: what is left] [runtime hint: right]
  // What yields is the DESCRIPTION — never the identity and never the runtime — because a
  // row is a statement about one subject and its name and its runtime are the parts that may
  // not be cut. The description is elided to the width it is given, so a long one ends in an
  // ellipsis rather than being clipped mid-word at the panel edge.
  const descriptionText = createMemo(() => {
    const text = props.description
    if (!text) return undefined
    if (typeof props.footer !== "string") return text
    const budget = descriptionBudget({ title: props.title, footer: props.footer, rowWidth: props.rowWidth })
    if (budget <= 4) return undefined
    return Locale.truncate(text, budget)
  })

  return (
    <>
      <Show when={props.current}>
        <text flexShrink={0} fg={props.active ? fg : props.current ? theme.primary : theme.text} marginRight={0}>
          ●
        </text>
      </Show>
      <Show when={!props.current && props.gutter}>
        <box flexShrink={0} marginRight={0}>
          {props.gutter}
        </box>
      </Show>
      <text
        flexShrink={0}
        minWidth={MIN_TITLE_WIDTH}
        fg={props.active ? fg : props.current ? theme.primary : theme.text}
        attributes={props.active ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="none"
        paddingLeft={3}
      >
        {Locale.truncate(props.title, 61)}
      </text>
      <Show when={descriptionText()}>
        <text flexShrink={1} overflow="hidden" wrapMode="none" fg={props.active ? fg : theme.textMuted}>
          {descriptionText()}
        </text>
      </Show>
      <Show when={props.footer}>
        <box flexShrink={0}>
          <text fg={props.active ? fg : theme.textMuted} wrapMode="none">
            {props.footer}
          </text>
        </box>
      </Show>
    </>
  )
}
