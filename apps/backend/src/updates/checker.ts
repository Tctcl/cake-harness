import type { ReleaseChannel } from '../config.js'
import type { ReleaseSource } from './releases.js'

/**
 * What this install knows about being out of date. `available` is `null` when the answer is not knowable — a checkout
 * has no version to compare, and a staging install tracks a moving tag rather than a release.
 */
export interface UpdateStatus {
  readonly channel: ReleaseChannel
  readonly current: string | null
  readonly latest: string | null
  readonly available: boolean | null
  /** When the last check finished, ISO, or `null` before the first one. */
  readonly checkedAt: string | null
  /** Where to read about the release, or `null` before the first successful check. */
  readonly url: string | null
  /** Why the last check failed, or `null` when it succeeded. A failed check keeps the previous answer. */
  readonly error: string | null
}

export interface UpdateCheckerOptions {
  readonly channel: ReleaseChannel
  readonly version: string | undefined
  readonly releases: ReleaseSource
  /** Milliseconds between checks; `0` disables the timer and leaves the checks to `check()`. */
  readonly intervalMs: number
}

export interface UpdateChecker {
  /** The answer as of the last completed check. Never touches the network. */
  status(): UpdateStatus
  /** Ask now; concurrent callers share one request. */
  check(): Promise<UpdateStatus>
  /** Check once and then on the interval; a no-op when the interval is `0`. */
  start(): void
  stop(): void
}

/** `1.2.10` beats `1.2.9`, which comparing the strings would get wrong. */
const isNewer = (candidate: string, current: string): boolean => {
  const left = candidate.split('.').map(Number)
  const right = current.split('.').map(Number)

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }

  return false
}

/**
 * The periodic question "is there a newer release". One at a time, and a failure is recorded rather than thrown: an
 * unreachable GitHub must not take the process down, and the frontend needs the reason.
 */
export const createUpdateChecker = (options: UpdateCheckerOptions): UpdateChecker => {
  let status: UpdateStatus = {
    channel: options.channel,
    current: options.version ?? null,
    latest: null,
    url: null,
    available: null,
    checkedAt: null,
    error: null,
  }

  let inFlight: Promise<UpdateStatus> | undefined
  let timer: NodeJS.Timeout | undefined

  const checkOnce = async (): Promise<UpdateStatus> => {
    // Staging publishes over one tag, so "newer" is not a version question; the check would report a difference on
    // every merge and mean nothing. The field stays `null` instead of claiming an update is available.
    if (options.channel === 'staging' || options.version === undefined) {
      status = { ...status, checkedAt: new Date().toISOString(), error: null }
      return status
    }

    try {
      const release = await options.releases.latest()
      const latest = release.tag.replace(/^v/, '')

      status = {
        ...status,
        latest,
        url: release.url,
        available: isNewer(latest, options.version),
        checkedAt: new Date().toISOString(),
        error: null,
      }
    } catch (error) {
      // The previous version numbers stay: a transient failure is not news about the release.
      status = {
        ...status,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return status
  }

  return {
    status: () => status,

    check() {
      // A forced refresh from the frontend and the timer must not become two requests.
      inFlight ??= checkOnce().finally(() => {
        inFlight = undefined
      })

      return inFlight
    },

    start() {
      if (options.intervalMs === 0 || timer !== undefined) return

      void this.check()
      // `unref` so a pending check never keeps the process alive during shutdown.
      timer = setInterval(() => void this.check(), options.intervalMs)
      timer.unref()
    },

    stop() {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    },
  }
}
