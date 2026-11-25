import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// The default one-second wait for `findBy*`/`waitFor` is shorter than a screen with several stubbed requests takes to
// settle when the whole suite runs in parallel on a small CI runner, which made passing tests fail at random. A
// longer ceiling only matters when a test would fail anyway; passing ones return as soon as the element appears.
configure({ asyncUtilTimeout: 5000 })

// Testing Library only registers its automatic cleanup when Vitest globals are
// enabled; this repo imports test APIs explicitly, so unmount manually.
afterEach(() => {
  cleanup()
})
