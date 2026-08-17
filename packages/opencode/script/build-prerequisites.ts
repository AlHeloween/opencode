import fs from "fs"
import path from "path"

export function assertWindowsBuildPrerequisites(packageDir: string) {
  const workspaceDir = path.resolve(packageDir, "../..")
  const required = [
    ["@opentui/core", path.join(packageDir, "node_modules", "@opentui", "core")],
    ["@opentui/core-win32-x64", path.join(packageDir, "node_modules", "@opentui", "core-win32-x64")],
    ["@parcel/watcher", path.join(packageDir, "node_modules", "@parcel", "watcher")],
    [
      "local OpenTUI Windows artifact",
      path.join(workspaceDir, "packages", "opentui", "packages", "core-win32-x64", "opentui.dll"),
    ],
    [
      "local OpenTUI Windows module",
      path.join(workspaceDir, "packages", "opentui", "packages", "core-win32-x64", "index.js"),
    ],
    [
      "local OpenTUI Windows manifest",
      path.join(workspaceDir, "packages", "opentui", "packages", "core-win32-x64", "package.json"),
    ],
  ]
  const missing = required.filter((item) => !fs.existsSync(item[1]))
  if (missing.length === 0) return

  throw new Error(
    `Missing build prerequisites:\n${missing.map((item) => `- ${item[0]}: ${item[1]}`).join("\n")}\nRun \`bun install\` from the repository root before retrying the build.`,
  )
}
