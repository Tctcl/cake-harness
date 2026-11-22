import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import { applyStoredTheme, watchSystemTheme } from './lib/theme.ts'

// The inline script in `index.html` already painted the stored palette; this keeps it right when the system flips.
applyStoredTheme()
watchSystemTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
