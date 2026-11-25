import { useSyncExternalStore } from 'react'

/** Below Tailwind's `md`: a phone, or a window too narrow for side-by-side columns. */
const QUERY = '(max-width: 767px)'

// jsdom, which the tests run in, has no `matchMedia`; there the layout is the wide one.
const supported = (): boolean => typeof window.matchMedia === 'function'

const subscribe = (onChange: () => void): (() => void) => {
  if (!supported()) return () => {}

  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)

  return () => media.removeEventListener('change', onChange)
}

const snapshot = (): boolean => supported() && window.matchMedia(QUERY).matches

/**
 * Whether the screen is too narrow for columns. Read from the media query rather than from a resize listener, so it
 * flips exactly where the stylesheet's `md` breakpoint does.
 */
export const useNarrowScreen = (): boolean => useSyncExternalStore(subscribe, snapshot, () => false)
