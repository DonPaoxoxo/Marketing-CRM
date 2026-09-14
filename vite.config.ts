import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: {
    port: 5173,
    // Proxy the API so the browser always talks to one origin. That removes CORS
    // entirely — in development and in production alike — which matters because
    // the session cookie is httpOnly and SameSite=Lax and should never need to be
    // a cross-site cookie.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
})
