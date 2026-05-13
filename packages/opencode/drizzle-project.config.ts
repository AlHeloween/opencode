import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/storage/schema-project.sql.ts",
  out: "./migration-project",
  dbCredentials: {
    url: "./.opencode/project.db",
  },
})
