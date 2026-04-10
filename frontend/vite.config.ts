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
    allowedHosts: true,
    // NOTE: /chat is intentionally NOT proxied from Vite to the runtime.
    // It is a client-side React Router route (the chat page) AND also a
    // runtime streaming endpoint. In our dev setup Caddy already sends
    // POST /chat → runtime via the @chat_post matcher. If Vite proxies
    // GET /chat to runtime, the Mastra server replies with its default
    // Mastra Studio UI, which hijacks our React chat page on any browser
    // refresh or direct navigation to /chat.
    proxy: {
      '/api': 'http://runtime:4111',
      '/auth': 'http://runtime:4111',
      '/health': 'http://runtime:4111',
    },
  },
})
