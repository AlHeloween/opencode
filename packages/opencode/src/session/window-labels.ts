import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { MessageV2 } from "./message-v2"

/**
 * THE LABELS OF A FILE THAT ARE STILL IN THE MODEL'S WINDOW.
 *
 * The old→new map the `edit` tool prints is only useful for the labels the model HOLDS: a mapping for a label the
 * model cannot see is noise, and a mapping MISSING for one it holds leaves a stale hash in the working picture
 * (owner, 2026-10-21: «просто дать список строк файла которые изменились, но есть в контентном окне»).
 *
 * «In the window» is not a guess and not a prose reconstruction: it is what the runtime's OWN replay puts on the
 * wire. A result that was released, cleared by the fold, folded for size, narrowed by a `kept` selection or expired
 * by its declared span has LEFT the window — the wire carries a placeholder in its place, and the labels it printed
 * are not in the model's context any more. Everything else is still there, and the labels it shows are still held.
 *
 * READ-ONLY. This module reads the message list and each part's own state; it never rewrites a part, a stored
 * output or the wire. The window is an INPUT to the map, and the map is appended in the edit result only.
 */

export type WindowLabelsOptions = {
  /**
   * The replay's own options — the SAME object the conversion uses. A window computed with a different turn or a
   * different replay cap would be a window that lies about what the wire carries, and the lie is invisible.
   */
  replay?: MessageV2.ConversionOptions
  /**
   * The directory a relative path resolves against — the `read` tool's own base (`Instance.directory`), so the
   * path the model typed and the path the runtime resolved are the same file.
   */
  base?: string
}

/**
 * The resolver the session runtime hands every tool: «the labels of this file the model can still see».
 *
 * It answers with a SET, never with `undefined`: an empty set is an answer too — the model holds no label of that
 * file — and the map must not confuse it with «the window is unknown».
 */
export type WindowLabelsResolver = (filePath: string) => ReadonlySet<string>

/**
 * The labels of `filePath` the model can still SEE, computed from the runtime's own replay selection.
 *
 * `undefined` is never returned: an empty set is an answer too — it says the model holds NO label of that file,
 * which is a different fact from «the window is unknown» and the map must not confuse them.
 */
export function windowLabelsFor(
  messages: readonly MessageV2.WithParts[],
  filePath: string,
  options?: WindowLabelsOptions,
): ReadonlySet<string> {
  const labels = new Set<string>()
  const target = canonical(filePath, options?.base)
  if (target === undefined) return labels
  const parts = new Map<string, MessageV2.Part>()
  for (const message of messages) for (const part of message.parts) parts.set(part.id, part)
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      // A part whose declared span has passed stopped sending its payload: its bytes left the window.
      if (options?.replay?.turn !== undefined && MessageV2.isSpanExpired(part, options.replay.turn)) continue
      const text = MessageV2.replayedToolOutput({ id: part.id, tool: part.tool, state: part.state }, options?.replay).text
      const shown = MessageV2.labelsIn(text)
      if (shown.length === 0) continue
      if (!belongsTo({ id: part.id, input: part.state.input }, text, target, options, parts, new Set())) continue
      for (const label of shown) labels.add(label)
    }
  }
  return labels
}

/**
 * Does this part's text belong to the file we ask about?
 *
 * Three ways to name a file, in the order the runtime's own bytes give them: the path the result PRINTED (`read`
 * prints `<path>…</path>`), the path the call was given (`input.filePath` — the only name a narrowed `kept` result
 * still carries, because a kept selection is rows without the header) and — for a `recall`, which answers with
 * rows under a header of its own — the part it recalled.
 */
function belongsTo(
  identity: { id: string; input: Record<string, unknown> },
  text: string,
  target: string,
  options: WindowLabelsOptions | undefined,
  parts: Map<string, MessageV2.Part>,
  seen: Set<string>,
): boolean {
  const printed = /<path>(.*?)<\/path>/.exec(text)?.[1]
  if (printed !== undefined) return samePath(printed, target)
  const input = identity.input
  const typed = input["filePath"]
  if (typeof typed === "string") return samePath(resolved(typed, options?.base), target)
  const source = input["id"]
  if (typeof source === "string" && !seen.has(source)) {
    seen.add(source)
    const from = parts.get(source)
    if (from === undefined || from.type !== "tool" || from.state.status !== "completed") return false
    return belongsTo(
      { id: from.id, input: from.state.input },
      MessageV2.replayedToolOutput({ id: from.id, tool: from.tool, state: from.state }, options?.replay).text,
      target,
      options,
      parts,
      seen,
    )
  }
  return false
}

/** The path the runtime itself would use: resolved against the base `read` uses, then normalized the way `read` normalizes. */
function canonical(filePath: string, base: string | undefined): string | undefined {
  try {
    return AppFileSystem.normalizePath(resolved(filePath, base))
  } catch {
    return undefined
  }
}

/** The path as the runtime resolves it — absolute, against the same base `read` and `edit` resolve against. */
function resolved(filePath: string, base: string | undefined): string {
  return base === undefined ? path.resolve(filePath) : path.resolve(base, filePath)
}

/** Windows paths are case-insensitive; POSIX ones are not. */
function samePath(a: string, b: string): boolean {
  if (a === b) return true
  return process.platform === "win32" && a.toLowerCase() === b.toLowerCase()
}
