import { defineConfig, PluginOption } from "vite"
import { defineConfig as solidStartConfig } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import tailwindcss from "@tailwindcss/vite"

const nitroConfig: any = (() => {
  const target = process.env.OPENCODE_DEPLOYMENT_TARGET
  if (target === "cloudflare") {
    return {
      compatibilityDate: "2024-09-19",
      preset: "cloudflare_module",
      cloudflare: {
        nodeCompat: true,
      },
    }
  }
  return {}
})()

export default defineConfig({
  plugins: [
    tailwindcss(),
    solidStartConfig() as PluginOption,
    nitro({
      ...nitroConfig,
      baseURL: process.env.OPENCODE_BASE_URL,
    }),
  ],
  server: {
    host: process.env.VITE_HOST ?? "127.0.0.1",
    allowedHosts: (process.env.VITE_ALLOWED_HOSTS ?? "localhost,127.0.0.1")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  },
  worker: {
    format: "es",
  },
})
