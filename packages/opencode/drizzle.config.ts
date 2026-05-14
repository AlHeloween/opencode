import { defineConfig } from "drizzle-kit"
import path from "path"
import os from "os"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: path.join(os.tmpdir(), "opencode-drizzle.db"),
  },
})
