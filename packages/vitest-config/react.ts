import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vitest/config'

import base from './base.ts'

/**
 * Shared Vitest preset for React packages: the Node preset plus the React
 * plugin, a jsdom environment and `@testing-library/jest-dom` matchers.
 */
export default mergeConfig(
  base,
  defineConfig({
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }),
)
