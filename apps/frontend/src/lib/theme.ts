/**
 * Light, dark, or whatever the system says. The class on `html` is the only state: the stylesheet reads it, and a test
 * or a developer can flip it by hand. `index.html` repeats the first line of this module inline so the first paint does
 * not flash the wrong palette — it cannot import this file, so both read the same storage key.
 */
export type Theme = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'cake-theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

const listeners = new Set<() => void>()

let preference: Theme = read()

/** The stored preference, or `system` when nothing was chosen or storage is unavailable (a private window throws). */
function read(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)

    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  } catch {
    return 'system'
  }
}

const prefersDark = (): boolean => window.matchMedia(DARK_QUERY).matches

/** Paint the palette the preference resolves to. `dark` is the only class that matters; light is the stylesheet default. */
function apply(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

function announce(): void {
  for (const listener of listeners) listener()
}

export const currentTheme = (): Theme => preference

export function setTheme(theme: Theme): void {
  preference = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage refused (a private window, or quota): the palette still changes for this session.
  }
  apply(theme)
  announce()
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Follow the system while `system` is selected; a chosen palette ignores it. Called once at startup. */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia(DARK_QUERY)
  const onChange = () => {
    if (preference !== 'system') return

    apply('system')
    announce()
  }

  media.addEventListener('change', onChange)

  return () => {
    media.removeEventListener('change', onChange)
  }
}

export const applyStoredTheme = (): void => apply(preference)
