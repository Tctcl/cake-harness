import { defineConfig } from 'vitest/config'

/**
 * Shared Vitest preset for Node packages.
 *
 * Tests live next to the code they cover, in files ending with `.test.ts`.
 * They run in the Node environment and carry no implicit globals: import
 * `describe`, `it` and `expect` from `vitest`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
    // A package that silently runs zero tests is a broken gate, not a pass.
    passWithNoTests: false,
  },
})
