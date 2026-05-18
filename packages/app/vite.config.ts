import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: process.env.VITE_HOST ?? "127.0.0.1",
    allowedHosts: (process.env.VITE_ALLOWED_HOSTS ?? "localhost,127.0.0.1")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    port: 3000,
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
