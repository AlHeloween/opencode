/**
 * Global recents allowlist (t87): the ordered list every model layer is gated
 * against before a model is used.
 *
 * The list lives on the ONE cross-worktree key — `globalRecents` in the
 * exe-adjacent global config (`Global.Path.config/opencode.jsonc`, written only
 * by the owner through the TUI). A layer value outside it is not used: the
 * model is taken from the global list instead, the refusal is logged
 * `warn("bug: layer model not in global recents")` and shown on a surface —
 * never silent (AGENTS.md: every option controllable).
 *
 * This is ONE lookup of ONE key as a gate, not a parent walk and not
 * inheritance (AGENTS.md § Storage Paradigm, rule 4 — plan §5): the layer
 * value was already materialised by fill; the gate only checks membership.
 * An absent key (or an empty/unreadable one) means legacy mode — no layer is
 * gated, and the reason is warned once per read, never per layer.
 */
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { parse as parseJsonc } from "jsonc-parser"
import { firstUp } from "@/provider/model-chain/chain"
import type { ChainHealth, ChainMember } from "@/provider/model-chain/chain"

export const GLOBAL_RECENTS_KEY = "globalRecents"

/** Ordered `provider/model` strings, priority first. Duplicates collapse, blanks and shapeless entries drop. */
export function parseGlobalRecents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== "string") continue
    const key = entry.trim()
    if (!key) continue
    const slash = key.indexOf("/")
    if (slash <= 0 || slash === key.length - 1) continue
    if (!out.includes(key)) out.push(key)
  }
  return out
}

export function listKey(ref: { providerID: string; modelID: string }): string {
  return `${ref.providerID}/${ref.modelID}`
}

/** Variant-stripped compare: `prov/model:variant` and `prov/model` name the same list slot. */
function base(key: string): string {
  return key.split(":")[0]!
}

/** True when the ref names a slot of the allowlist. */
export function isListMember(ref: { providerID: string; modelID: string }, list: readonly string[]): boolean {
  const key = base(listKey(ref))
  return list.some((entry) => base(entry) === key)
}

/**
 * Gate ONE layer value. An undefined list is legacy mode (pass-through); an
 * in-list value passes; anything else warns and reads as absent so the caller
 * falls to the next layer — the value itself is kept in its file, never deleted.
 */
export function gateLayerModel<T extends { providerID: string; modelID: string }>(
  value: T | undefined,
  list: readonly string[] | undefined,
  site: { layer: string; agent: string },
): T | undefined {
  if (value === undefined) return undefined
  if (list === undefined) return value
  if (isListMember(value, list)) return value
  Log.Default.warn("bug: layer model not in global recents", {
    layer: site.layer,
    agent: site.agent,
    model: listKey(value),
  })
  return undefined
}

/** The allowlist as chain members, in owner order — head first. */
export function globalRecentsToChain(list: readonly string[]): ChainMember[] {
  const out: ChainMember[] = []
  for (const entry of list) {
    const slash = entry.indexOf("/")
    if (slash <= 0 || slash === entry.length - 1) continue
    out.push({ providerID: entry.slice(0, slash), modelID: entry.slice(slash + 1) })
  }
  return out
}

/**
 * Owner-priority fallback: the first UP member of the list (a member with no
 * signal is tried, never skipped — same rule as `firstUp`). Last resort is the
 * head itself, even DOWN: a list the owner set always names something runnable.
 */
export function resolveGlobalHead(
  list: readonly string[] | undefined,
  health: ReadonlyMap<string, ChainHealth>,
): ChainMember | undefined {
  if (list === undefined || list.length === 0) return undefined
  const chain = globalRecentsToChain(list)
  return firstUp(chain, health) ?? chain[0]
}

/** Read the L4 key. Absent key = legacy (silent undefined); present-but-empty or unreadable = warn + undefined. */
export async function readGlobalRecents(): Promise<string[] | undefined> {
  const names = ["opencode.jsonc", "opencode.json", "config.json"]
  for (const name of names) {
    const file = path.join(Global.Path.config, name)
    try {
      if (!(await Filesystem.exists(file))) continue
      const raw = await Filesystem.readText(file)
      const data = parseJsonc(raw) as Record<string, unknown> | undefined
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        Log.Default.warn("bug: global config is not a readable object — no layer gated", { file })
        return undefined
      }
      if (!(GLOBAL_RECENTS_KEY in data)) return undefined
      const list = parseGlobalRecents(data[GLOBAL_RECENTS_KEY])
      if (list.length === 0) {
        Log.Default.warn("bug: global recents list empty — no layer gated", { file })
        return undefined
      }
      return list
    } catch (error) {
      Log.Default.warn("bug: global recents unreadable — no layer gated", {
        file,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }
  return undefined
}
