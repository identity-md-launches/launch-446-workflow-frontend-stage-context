import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Static export for content-addressed hosting: relative base, no server rewrites,
// everything bundled locally. The export lands at the repository root `dist/`.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
