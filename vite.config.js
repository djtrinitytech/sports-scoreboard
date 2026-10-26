import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import adminPanel from './api/admin-panel.js'

export default defineConfig(({ mode }) => {
  const localEnv = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(localEnv)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    plugins: [
      react(),
      {
        name: 'local-admin-api',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/api/admin-panel') return next()
            void adminPanel(request, response).catch(next)
          })
        },
      },
    ],
    test: { environment: 'jsdom' },
  }
})
