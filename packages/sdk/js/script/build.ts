#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../opencode"))

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "OpencodeClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`

// Patch: prevent stripEmptySlots from deleting empty body slots.
// POST/PUT/PATCH requests need a JSON body (even {}), otherwise the server
// fails with "JSON Parse error: Unexpected EOF" → 400.
// Without this, fork() without messageID sends no body → crash.
for (const dir of ["src/gen/core", "src/v2/gen/core"]) {
  const f = path.join(dir, "params.gen.ts")
  let src = await Bun.file(f).text()
  src = src.replace(
    "if (value && typeof value === \"object\" && !Object.keys(value).length) {",
    "if (value && typeof value === \"object\" && !Object.keys(value).length && slot !== \"body\") {",
  )
  await Bun.write(f, src)
}
await $`bun prettier --write src/gen/core/params.gen.ts`
await $`bun prettier --write src/v2/gen/core/params.gen.ts`

await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
