export * as ConfigManaged from "./managed"

import path from "path"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "config" })

function systemManagedConfigDir(): string {
  return path.dirname(process.execPath)
}

export function managedConfigDir() {
  return process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
}

export async function readManagedPreferences() {
  return
}
