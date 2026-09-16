import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"

const apiProxyTarget =
  process.env.ADMIN_API_PROXY_TARGET ?? "http://localhost:3000"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 3200, // 修改为你想要的端口号（例如 3000）
    proxy: { "/api": apiProxyTarget },
    strictPort: true, // 可选：若端口已被占用则直接报错，而不是自动切换到下一个可用端口
  },
})
