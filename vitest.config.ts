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
  },
})
