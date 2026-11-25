import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Every prefix the client calls has to be listed here, because anything unlisted is answered by the development
    // server itself: the SPA fallback hands back `index.html`, and the caller parses HTML as JSON. The list follows
    // `apps/backend/src/plugins/index.ts`, where each route module is registered.
    proxy: {
      // `ws` so the development server forwards the terminal attach upgrade instead of answering it with a 404.
      '/threads': { target: 'http://127.0.0.1:8080', ws: true },
      '/workspaces': { target: 'http://127.0.0.1:8080', ws: true },
      '/agents': { target: 'http://127.0.0.1:8080' },
      '/tools': { target: 'http://127.0.0.1:8080' },
      '/prompts': { target: 'http://127.0.0.1:8080' },
      '/skills': { target: 'http://127.0.0.1:8080' },
      '/mcp': { target: 'http://127.0.0.1:8080' },
      '/providers': { target: 'http://127.0.0.1:8080' },
      '/credentials': { target: 'http://127.0.0.1:8080' },
      '/environments': { target: 'http://127.0.0.1:8080', ws: true },
      '/updates': { target: 'http://127.0.0.1:8080' },
      '/me': { target: 'http://127.0.0.1:8080' },
      '/users': { target: 'http://127.0.0.1:8080' },
      '/roles': { target: 'http://127.0.0.1:8080' },
      '/settings': { target: 'http://127.0.0.1:8080' },
      '/auth': { target: 'http://127.0.0.1:8080' },
      '/health': { target: 'http://127.0.0.1:8080' },
    },
  },
})
