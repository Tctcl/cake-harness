/**
 * Which workspace groups are folded shut. This is how the list is being read, not what the list is: the order lives in
 * the database so it follows the account, while a collapsed group is a per-browser convenience and stays here. A
 * workspace the list no longer shows is dropped from the set on the next write, so an archived id does not accumulate.
 */
const STORAGE_KEY = 'tlabs-collapsed-workspaces'

/** The stored set, or none when nothing was chosen or storage is unavailable (a private window throws). */
export function readCollapsed(): ReadonlySet<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) return new Set()

    const parsed: unknown = JSON.parse(stored)

    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeCollapsed(ids: ReadonlySet<string>, known: readonly string[]): void {
  const kept = new Set(known.filter((id) => ids.has(id)))

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...kept]))
  } catch {
    // Storage refused (a private window, or quota): the group still folds for this session.
  }
}
