import type { Argv } from "yargs"
import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { EffectiveNavigation } from "@/cli/cmd/tui/util/effective-navigation"
import { Truncate } from "@/tool/truncate"
import { Effect } from "effect"

const ACTION_ICONS: Record<string, string> = {
  allow: UI.Style.TEXT_SUCCESS_BOLD + "Allow" + UI.Style.TEXT_NORMAL,
  deny: UI.Style.TEXT_DANGER_BOLD + "Deny " + UI.Style.TEXT_NORMAL,
}

const SOURCE_LABELS: Record<string, string> = {
  "config-allow": "config (allow)",
  "config-deny": "config (deny)",
  "config-permission": "config (permission)",
  auto: "auto",
}

export const DirsCommand = cmd({
  command: "dirs <action> [path]",
  describe: "manage directory navigation permissions",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        describe: "Action: list, allow, deny, or remove",
        type: "string",
        choices: ["list", "allow", "deny", "remove"],
      })
      .positional("path", {
        describe: "Directory path (for allow/deny/remove)",
        type: "string",
      })
      .option("verbose", {
        alias: "v",
        describe: "Show raw glob patterns",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const cfg = yield* Config.Service

            switch (args.action) {
              case "list": {
                const config = yield* cfg.get()
                const autoGlobs = [Truncate.truncateGlob()]
                const rules = EffectiveNavigation.collectNavigationRules(config, autoGlobs)
                const deduped = EffectiveNavigation.deduplicateRules(rules)

                if (deduped.length === 0) {
                  UI.println(UI.Style.TEXT_DIM + "No directory navigation rules configured." + UI.Style.TEXT_NORMAL)
                  return
                }

                UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Effective directory navigation rules:" + UI.Style.TEXT_NORMAL)
                UI.println("")

                for (const rule of deduped) {
                  const icon = ACTION_ICONS[rule.action] ?? rule.action
                  const src = SOURCE_LABELS[rule.source] ?? rule.source
                  const display = args.verbose ? rule.pattern : rule.displayPath
                  UI.println(`  ${icon}  ${display}  ${UI.Style.TEXT_DIM}(${src})${UI.Style.TEXT_NORMAL}`)
                }
                return
              }

              case "allow":
              case "deny":
              case "remove": {
                if (!args.path) {
                  UI.println(
                    UI.Style.TEXT_DANGER_BOLD +
                      `Error: path is required for '${args.action}'` +
                      UI.Style.TEXT_NORMAL,
                  )
                  return
                }

                const config = yield* cfg.get()
                const resolved = path.resolve(args.path)
                const allow = [...(config.navigation?.allow ?? [])]
                const deny = [...(config.navigation?.deny ?? [])]

                // Remove from both lists
                const allowIdx = allow.findIndex(
                  (d) => path.resolve(EffectiveNavigation.expandPath(d)) === resolved,
                )
                const denyIdx = deny.findIndex(
                  (d) => path.resolve(EffectiveNavigation.expandPath(d)) === resolved,
                )

                if (allowIdx >= 0) allow.splice(allowIdx, 1)
                if (denyIdx >= 0) deny.splice(denyIdx, 1)

                if (args.action === "allow") {
                  if (
                    allow.some(
                      (d) => path.resolve(EffectiveNavigation.expandPath(d)) === resolved,
                    )
                  ) {
                    UI.println(UI.Style.TEXT_DIM + `Already allowed: ${resolved}` + UI.Style.TEXT_NORMAL)
                    return
                  }
                  allow.push(args.path)
                  UI.println(
                    UI.Style.TEXT_SUCCESS_BOLD + `Added to allowed directories: ${resolved}` + UI.Style.TEXT_NORMAL,
                  )
                } else if (args.action === "deny") {
                  if (
                    deny.some(
                      (d) => path.resolve(EffectiveNavigation.expandPath(d)) === resolved,
                    )
                  ) {
                    UI.println(UI.Style.TEXT_DIM + `Already denied: ${resolved}` + UI.Style.TEXT_NORMAL)
                    return
                  }
                  deny.push(args.path)
                  UI.println(
                    UI.Style.TEXT_DANGER_BOLD + `Added to denied directories: ${resolved}` + UI.Style.TEXT_NORMAL,
                  )
                } else {
                  // remove
                  UI.println(`Removed from navigation: ${resolved}`)
                }

                const updated = {
                  ...config,
                  navigation: {
                    ...config.navigation,
                    allow: allow.length > 0 ? allow : undefined,
                    deny: deny.length > 0 ? deny : undefined,
                  },
                }
                yield* cfg.update(updated, { dispose: false })
                yield* cfg.invalidate(false)
              }
            }
          }),
        )
      },
    })
  },
})
