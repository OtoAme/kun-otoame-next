import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    environment: 'node',
    globals: true
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './')
    }
  }
})
