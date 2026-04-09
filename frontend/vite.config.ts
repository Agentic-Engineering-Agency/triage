import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/auth": {
        target: "http://localhost:4111",
        changeOrigin: true,
      },
      "/chat": {
        target: "http://localhost:4111",
        changeOrigin: true,
        // Only proxy POST (AI streaming) — GET /chat is the SPA route
        bypass(req) {
          if (req.method !== "POST") return req.url;
        },
      },
    },
  },
})
