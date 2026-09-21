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
    /** An unavailable keybind: the footer omits the cell and the handler does not fire. This one IS
     * honoured — the OPTION-level flag that used to share this name was removed 2026-09-20 (see
     * `hidden` below): it named a selectability the renderer never honoured. */
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
  /**
   * The option is NOT part of the list: `filtered()` drops it. That is the whole contract — the row
   * is not dimmed and the cursor does not skip it, because a "visible but not selectable" option is
   * deliberately NOT implemented (an option that cannot be chosen is a surface that lies about being
   * one). Renamed from `disabled` (2026-09-20): the old name promised a selectability the renderer
   * never honoured — the flag only ever removed the row, which is why three dialogs lost rows that
   * their authors meant to be visible.
   */
  hidden?: boolean
  bg?: RGBA
  gutter?: JSX.Element
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
    if (props.skipFilter) return props.options.filter((x) => x.hidden !== true)
    const needle = store.filter.toLowerCase()
    const options = pipe(
      props.options,
      filter((x) => x.hidden !== true),
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

  // Usable text width for Option rows — dialog width minus list paddings. One line per row now,
  // so this is a width and no longer a two-line wrap budget.
  const rowWidth = createMemo(() => {
    const size = dialog.size
    return size === "xlarge" ? 116 : size === "large" ? 88 : 60
  })

  // The row's three columns, computed ONCE for the whole list: a column is a POSITION, and a
  // position must be the same on every row. Per-row widths put each runtime at its own x — the
  // ragged column reported twice.
  //
  // The input is `props.options`, NOT the filtered list: a column belongs to the TABLE, so it
  // must not move while the user types. Computing it from `flat()` made every row shift
  // horizontally on each keystroke, because the longest title in a filtered list is shorter.
  const columns = createMemo(() =>
    rowColumns({
      titles: props.options.map((option) => option.title),
      descriptions: props.options.map((option) => option.description ?? option.category),
      footers: props.options.map((option) => (typeof option.footer === "string" ? option.footer : undefined)),
      rowWidth: rowWidth(),
    }),
  )

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
  /** Hotkeys in COLUMNS, not a wrapped run: BOTH the cell and the name slot inside it are
   * fixed, so the keys sit at the same x down a column (Alexander, 2026-09-20: «hotkeys - четко
   * столбиками»). Three per line at the dialog's width. */
  const KEYBIND_COLUMNS = 3
  const keybindCellWidth = createMemo(() => Math.max(20, Math.floor((rowWidth() - 8) / KEYBIND_COLUMNS)))
  const keybindAll = createMemo(() => [...left(), ...right()])
  // A key aligns only if the name before it does: without a fixed name slot the keybind starts
  // wherever its label happens to end, which is a gap, not a column.
  const keybindLabelWidth = createMemo(() => {
    const all = keybindAll()
    if (all.length === 0) return 0
    return Math.min(20, Math.max(...all.map((item) => item.title.length)) + 1)
  })
  const keybindRows = createMemo(() => {
    const all = keybindAll()
    const out: (typeof all)[] = []
    for (let i = 0; i < all.length; i += KEYBIND_COLUMNS) out.push(all.slice(i, i + KEYBIND_COLUMNS))
    return out
  })
  /** The highlighted option's explanation, computed live so the footer follows
   * the cursor: the list says WHERE you are, the footer says WHAT it does. */
  const hintText = createMemo(() => props.hint?.(selected()))

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
                          columns={columns()}
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
      {/* A dialog that asked for a hint keeps the line for the WHOLE list. Showing the box
       * only while the highlighted row had something to say resized the panel every time the
       * cursor crossed onto a row without one, and the whole dialog jumped (owner, 2026-09-21:
       * «при отрисовке экран дёргается»). An empty reserved line is the price of a stable one. */}
      <Show when={props.hint}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexShrink={0}>
          <Show when={hintText()}>
            <text wrapMode="word">
              <span style={{ fg: theme.text }}>
                <b>{selected()?.title ?? ""}</b>{" "}
              </span>
              <span style={{ fg: theme.textMuted }}>{hintText()}</span>
            </text>
          </Show>
        </box>
      </Show>
      <Show when={keybinds().length} fallback={<box flexShrink={0} />}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="column" flexShrink={0}>
          <For each={keybindRows()}>
            {(row) => (
              <box flexDirection="row" flexShrink={0}>
                <For each={row}>
                  {(item) => (
                    <box width={keybindCellWidth()} flexShrink={0} flexDirection="row">
                      <text width={keybindLabelWidth()} wrapMode="none" fg={theme.text}>
                        <b>{item.title}</b>
                      </text>
                      <text wrapMode="none" fg={theme.textMuted}>
                        {Keybind.toString(item.keybind)}
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

/** A name narrower than this cannot be told apart; every row gives it this much. */
const MIN_TITLE_WIDTH = 24
/** A title column wider than this spends the row on a name nobody reads in full. */
const MAX_TITLE_WIDTH = 28
/** The runtime column is as wide as the widest runtime in the list, up to this. */
const MAX_FOOTER_WIDTH = 48

/**
 * The three columns of a one-line row, computed ONCE for the whole list.
 *
 * Why list-level and not per-row: a column is a POSITION, and a position has to be the same on
 * every row. A per-row budget elided each description to that row's own title and footer, so
 * the runtime began at a different x on every row — the ragged right column reported twice. It
 * looked aligned only while the renderer CLIPPED the description at a fixed edge, and that clip
 * is the mid-word cut the owner called nonsense. Fixed widths give both at once: the ellipsis
 * lands on a word boundary and the columns line up.
 *
 * Pure and exported, so the contract is pinned by tests instead of argued over a screenshot.
 */
export function rowColumns(input: {
  titles: string[]
  descriptions: Array<string | undefined>
  footers: Array<string | undefined>
  rowWidth?: number
}): {
  title: number
  description: number
  footer: number
} {
  const width = input.rowWidth ?? 60
  const longestTitle = input.titles.reduce((acc, title) => Math.max(acc, title.length), 0)
  const longestFooter = input.footers.reduce((acc, footer) => Math.max(acc, footer?.length ?? 0), 0)
  const footer = Math.min(longestFooter, MAX_FOOTER_WIDTH)
  const wanted = Math.max(longestTitle, MIN_TITLE_WIDTH)
  // The title cap exists to protect the DESCRIPTION's column — and only for that. With no
  // description anywhere in the list there is nothing to protect and the name IS the row: a
  // file picker must not have its paths elided at 28 characters, which an unconditional cap
  // would do.
  const title = input.descriptions.some((description) => description !== undefined)
    ? Math.min(wanted, MAX_TITLE_WIDTH)
    : Math.min(wanted, Math.max(MAX_TITLE_WIDTH, width - 10 - footer))
  // The row's box is `rowWidth - 2`; it pads 1 left and 3 right, and its four flow children
  // take three one-cell gaps and a one-cell marker — so `rowWidth - 10` is what the three
  // columns share. The marker-less shape spends the marker's cell on its own left padding, so
  // the arithmetic is identical for both and every row lands on the same grid.
  return { title, description: Math.max(0, width - 10 - title - footer), footer }
}

function Option(props: {
  title: string
  description?: string
  active?: boolean
  current?: boolean
  footer?: JSX.Element | string
  gutter?: JSX.Element
  /** The row's three fixed columns, computed once for the whole list by `rowColumns`. */
  columns: { title: number; description: number; footer: number }
  onMouseOver?: () => void
}) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  // ONE line, three FIXED columns:
  //   [marker/gutter] [title] [description] [runtime]
  // The description is the part that yields — never the identity and never the runtime — and
  // it yields by ELIDING INSIDE ITS OWN COLUMN, so the columns stay aligned and a long sentence
  // ends on an ellipsis instead of being cut mid-word at the panel edge.
  const titleText = createMemo(() => Locale.truncate(props.title, props.columns.title))
  const descriptionText = createMemo(() => {
    const text = props.description
    if (!text) return undefined
    if (props.columns.description <= 4) return undefined
    return Locale.truncate(text, props.columns.description)
  })
  const footerText = createMemo(() => {
    if (typeof props.footer !== "string") return props.footer
    if (props.columns.footer <= 0) return props.footer
    return Locale.truncate(props.footer, props.columns.footer)
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
        width={props.columns.title}
        fg={props.active ? fg : props.current ? theme.primary : theme.text}
        attributes={props.active ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="none"
      >
        {titleText()}
      </text>
      <Show when={descriptionText()}>
        <text
          flexShrink={0}
          width={props.columns.description}
          overflow="hidden"
          wrapMode="none"
          fg={props.active ? fg : theme.textMuted}
        >
          {descriptionText()}
        </text>
      </Show>
      <Show when={props.footer}>
        <text flexShrink={0} width={props.columns.footer} fg={props.active ? fg : theme.textMuted} wrapMode="none">
          {footerText()}
        </text>
      </Show>
    </>
  )
}
