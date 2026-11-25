import type { ToolingState } from './tooling/contract.js'

/** How long a report may take; a backend that is down must not hold up a boot. */
const TIMEOUT_MS = 5_000

export interface ReportResult {
  readonly delivered: boolean
  /** The status the backend answered with, or `null` when it could not be reached at all. */
  readonly status: number | null
}

/**
 * Sends the container's state back to the backend. A failure is reported, never
 * thrown: the environment works whether or not the backend heard about it, and
 * refusing to boot over a stale display would be the wrong trade.
 */
export const reportState = async (
  url: string,
  state: ToolingState,
  fetchFn: typeof fetch = fetch,
): Promise<ReportResult> => {
  try {
    const response = await fetchFn(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    return { delivered: response.ok, status: response.status }
  } catch {
    return { delivered: false, status: null }
  }
}
