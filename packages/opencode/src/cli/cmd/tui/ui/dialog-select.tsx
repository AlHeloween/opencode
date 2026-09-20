import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { entries, filter, flatMap, groupBy, pipe } from "remeda"
import { batch, createEffect, createMemo, For, Show, type JSX, on } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import * as fuzzysort from "fuzzysort"
import { isDeepEqual } from "remeda"
import { dialogSizeWidth, useDialog, type DialogContext } from "@tui/ui/dialog"
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

  const dimensions = useTerminalDimensions()

  // The width every row is laid out against: the size table CAPPED BY THE TERMINAL, which is
  // exactly how `Dialog` clamps the panel (`maxWidth = terminal − 2`, ui/dialog.tsx). Reading
  // the size name alone was a real defect: /agents asked for `xlarge`, the terminal was
  // narrower, the panel was clamped — and the rows still laid out for 116 columns, so the
  // model column ran past the panel and was cut at its right edge (measured 2026-09-20).
  const rowWidth = createMemo(() => Math.min(dialogSizeWidth(dialog.size), dimensions().width - 2))

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

  // Row geometry, from the SAME one width table as the header.
  //
  // The row is a flex child of the scrollbox, and a child in a flex column gets NO width
  // from its parent — so the row resolved to CONTENT size, overran the dialog and the last
  // columns were cut mid-word with no ellipsis (measured 2026-09-20 in the /agents capture:
  // `huggingface/zai-org/GLM-5.3-`). The row now states its width explicitly below, and
  // these two derived the fields' budgets, so an ellipsis is REACHABLE instead of being
  // clipped away with the text.
  //
  // The left padding is stated ONCE: the marker renders absolutely at columns 1..3, so a
  // row that carries one must start at 5, a gutter alone needs 3, and the "current" row
  // (whose dot is in the flow) needs 1. The budget reads the same function, or it would be
  // computed against a padding the row does not use.
  const rowPaddingLeft = (option: DialogSelectOption<T>) =>
    isDeepEqual(option.value, props.current) ? 1 : option.margin ? 5 : 3
  // Row box is (dialog − 2) for the scrollbox padding; then its own padding, the gutter
  // and the gap (2), and the field's own indent (3), with one spare column so the ellipsis
  // itself is never the character that gets cut.
  const rowTextWidth = (option: DialogSelectOption<T>) => rowWidth() - 11 - rowPaddingLeft(option)

  const rows = createMemo(() => {
    const headers = grouped().reduce((acc, [category], i) => {
      if (!category) return acc
      return acc + (i > 0 ? 2 : 1)
    }, 0)
    // Count the lines a row actually renders. This used to assume one line per
    // option, which stopped being true when long rows started splitting their
    // description onto a second line — the list height, and every scroll
    // computation derived from it, was short by the number of split rows.
    const lines = grouped().reduce(
      (acc, [category, options]) =>
        acc +
        options.reduce(
          (sum, option) =>
            sum +
            (isTwoLineRow({
              title: option.title,
              description: flatten()
                ? (option.description ?? option.category)
                : option.description !== category
                  ? option.description
                  : undefined,
              footer: option.footer,
              rowWidth: rowWidth(),
            })
              ? 2
              : 1),
          0,
        ),
      0,
    )
    return lines + headers
  })

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
                        paddingLeft={rowPaddingLeft(option)}
                        paddingRight={3}
                        gap={1}
                        // Stated EXPLICITLY for the same reason as the header row: without
                        // it the flex chain resolves to content size and the content runs past
                        // the dialog edge, where it is cut mid-word. Same table as
                        // `rowTextWidth`, so the width and the budget cannot disagree.
                        width={rowWidth() - 2}
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
                          textWidth={rowTextWidth(option)}
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
      <Show when={keybinds().length} fallback={<box flexShrink={0} />}>
        <box
          paddingRight={2}
          paddingLeft={4}
          flexDirection="row"
          flexWrap="wrap"
          justifyContent="space-between"
          flexShrink={0}
          paddingTop={1}
        >
          <box flexDirection="row" flexWrap="wrap" flexShrink={1} gap={2}>
            <For each={left()}>
              {(item) => (
                <text flexShrink={0}>
                  <span style={{ fg: theme.text }}>
                    <b>{item.title}</b>{" "}
                  </span>
                  <span style={{ fg: theme.textMuted }}>{Keybind.toString(item.keybind)}</span>
                </text>
              )}
            </For>
          </box>
          <box flexDirection="row" flexWrap="wrap" flexShrink={1} gap={2}>
            <For each={right()}>
              {(item) => (
                <text flexShrink={0}>
                  <span style={{ fg: theme.text }}>
                    <b>{item.title}</b>{" "}
                  </span>
                  <span style={{ fg: theme.textMuted }}>{Keybind.toString(item.keybind)}</span>
                </text>
              )}
            </For>
          </box>
        </box>
      </Show>
    </box>
  )
}

/** A model name below this is not identifiable; the footer yields first. */
const MIN_TITLE_WIDTH = 24

/**
 * Does this row render on two lines?
 *
 * Shared by the renderer and by the list's line count. They used to decide this
 * separately — the renderer split long rows while `rows()` still counted one
 * line each, so the scrollbox height was short by the number of split rows.
 * One predicate, two callers: they cannot drift again.
 */
export function isTwoLineRow(input: {
  title: string
  description?: string
  footer?: JSX.Element | string
  rowWidth?: number
}): boolean {
  if (!input.description) return false
  const width = input.rowWidth ?? 60
  const footerLen = typeof input.footer === "string" ? input.footer.length : 6
  // scrollbox padding 2, row padding 6, marker/gutter ~2, gaps 2 — usable
  // width is roughly dialogWidth - 12; inline needs title + description +
  // footer plus separators.
  return input.title.length + input.description.length + footerLen + 4 > width - 12
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
  /** The row's TEXT budget, from the same width table. Fields are truncated to it
   * so an over-long name yields an ellipsis instead of being cut mid-word at the
   * dialog edge (`Locale.truncate(props.title, 61)` was a hard 61 for every size). */
  textWidth?: number
  onMouseOver?: () => void
}) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  const twoLine = createMemo(() =>
    isTwoLineRow({
      title: props.title,
      description: props.description,
      footer: props.footer,
      rowWidth: props.rowWidth,
    }),
  )

  // ONE budget table for the row's three fields, so the title, the footer and the
  // description cannot each invent their own width. The footer is metadata: it yields
  // first and never takes more than half the row. The name keeps a floor, because a
  // row whose name is unreadable is not a row. The description gets the full width
  // when it has a line to itself.
  const textWidth = () => props.textWidth ?? 60
  const footerBudget = () =>
    typeof props.footer === "string" ? Math.min(props.footer.length, Math.max(8, Math.floor(textWidth() / 2))) : 0
  const titleText = () =>
    Locale.truncate(
      props.title,
      Math.max(MIN_TITLE_WIDTH, textWidth() - (footerBudget() > 0 ? footerBudget() + 1 : 0)),
    )
  const footerText = () =>
    typeof props.footer === "string" ? Locale.truncate(props.footer, footerBudget()) : props.footer
  const descText = () => (props.description ? Locale.truncate(props.description, textWidth()) : undefined)
  const descInlineText = () =>
    props.description
      ? Locale.truncate(props.description, Math.max(8, textWidth() - titleText().length - footerBudget() - 2))
      : undefined

  return (
    <Show
      when={twoLine()}
      fallback={
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
            flexGrow={1}
            fg={props.active ? fg : props.current ? theme.primary : theme.text}
            attributes={props.active ? TextAttributes.BOLD : undefined}
            overflow="hidden"
            wrapMode="none"
            paddingLeft={3}
          >
            {titleText()}
            <Show when={props.description}>
              <span style={{ fg: props.active ? fg : theme.textMuted }}> {descInlineText()}</span>
            </Show>
          </text>
          <Show when={props.footer}>
            <box flexShrink={0} overflow="hidden">
              <text fg={props.active ? fg : theme.textMuted} wrapMode="none" overflow="hidden">
                {footerText()}
              </text>
            </box>
          </Show>
        </>
      }
    >
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
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row">
          <text
            flexGrow={1}
            // The model NAME is what the row is for. A footer wide enough to
            // fill the row used to squeeze this to three characters ("Z.a",
            // "Dee") and butt it against the price with no gap — the row became
            // unreadable exactly when it carried the most information.
            // The title keeps a floor and the footer yields instead.
            flexShrink={0}
            minWidth={MIN_TITLE_WIDTH}
            fg={props.active ? fg : props.current ? theme.primary : theme.text}
            attributes={props.active ? TextAttributes.BOLD : undefined}
            overflow="hidden"
            wrapMode="none"
            paddingLeft={3}
          >
            {titleText()}
          </text>
          <Show when={props.footer}>
            <box flexShrink={1} overflow="hidden">
              <text fg={props.active ? fg : theme.textMuted} wrapMode="none" overflow="hidden">
                {footerText()}
              </text>
            </box>
          </Show>
        </box>
        <Show when={props.description}>
          <text
            paddingLeft={3}
            overflow="hidden"
            wrapMode="none"
            fg={props.active ? fg : theme.textMuted}
          >
            {descText()}
          </text>
        </Show>
      </box>
    </Show>
  )
}
