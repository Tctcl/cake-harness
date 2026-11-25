import { fileURLToPath, URL } from 'node:url'

import react from '@cake-harness/vitest-config/react'
import { defineConfig, mergeConfig } from 'vitest/config'

// The shared React preset does not know this app's `@/` alias, which the shadcn components import through.
export default mergeConfig(
  react,
  defineConfig({
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }),
)
