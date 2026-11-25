import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './components/auth/auth-gate.tsx'
import { applyStoredTheme, watchSystemTheme } from './lib/theme.ts'

// The inline script in `index.html` already painted the stored palette; this keeps it right when the system flips.
applyStoredTheme()
watchSystemTheme()

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root element to render into')

createRoot(root).render(
  <StrictMode>
    <AuthGate>{(signOut) => <App onSignOut={signOut} />}</AuthGate>
  </StrictMode>,
)
