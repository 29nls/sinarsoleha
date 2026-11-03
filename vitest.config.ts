import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const appDir = fileURLToPath(new URL('./app', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': appDir,
      '@': appDir,
    },
  },
  test: {
    environment: 'node',
    // Playwright E2E specs live under e2e/ and run via `npm run test:e2e`.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
})
