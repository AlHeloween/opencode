import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "upgrade" })

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) return
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch((e) => {
    log.warn("bug: failed to check latest version for upgrade", { error: e instanceof Error ? e.message : String(e) })
  })
  if (!latest) return

  if (Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE) {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (InstallationVersion === latest) return

  let kind: ReturnType<typeof Installation.getReleaseType>
  try {
    kind = Installation.getReleaseType(InstallationVersion, latest)
  } catch {
    log.debug("upgrade skipped: unparseable version", { version: InstallationVersion })
    return
  }

  if (config.autoupdate === "notify" || kind !== "patch") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch((e) => {
      log.warn("bug: upgrade installation failed", { error: e instanceof Error ? e.message : String(e) })
    })
}
