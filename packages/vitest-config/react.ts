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
      // The setup file lets Testing Library wait up to 5 s for an element; a test that waits for two of them on a slow
      // CI runner must not hit the default 5 s test limit first, which failed passing tests at random.
      testTimeout: 15_000,
    },
  }),
)
