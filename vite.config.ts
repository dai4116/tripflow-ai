import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: { host: true },
  test: {
    environment: 'happy-dom',
    // Kept disjoint from the node:test suite (`*.test.ts`, run via `npm
    // test`) by naming convention alone — no shared config, no risk of one
    // runner trying to execute the other's files.
    include: ['src/**/*.spec.ts'],
  },
})
