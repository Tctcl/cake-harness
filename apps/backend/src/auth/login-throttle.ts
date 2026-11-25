/**
 * Failed sign-ins per client address, kept in this process. Ten failures in fifteen minutes is far beyond a person who
 * mistyped and far below what guessing needs, and a restart forgetting the count costs an attacker nothing they could
 * not get by waiting. One process serves an install, so there is no second counter to keep in step.
 */
export const LOGIN_FAILURE_LIMIT = 10
export const LOGIN_WINDOW_MS = 15 * 60 * 1000

interface Window {
  readonly startedAt: number
  failures: number
}

export class LoginThrottle {
  readonly #windows = new Map<string, Window>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /** Milliseconds until `client` may try again, or 0 when it may try now. */
  retryAfterMs(client: string): number {
    const window = this.#current(client)
    if (window === undefined || window.failures < LOGIN_FAILURE_LIMIT) return 0

    return window.startedAt + LOGIN_WINDOW_MS - this.#now()
  }

  recordFailure(client: string): void {
    const window = this.#current(client)
    if (window === undefined) {
      this.#windows.set(client, { startedAt: this.#now(), failures: 1 })
      this.#forgetExpired()
      return
    }

    window.failures += 1
  }

  /** A successful sign-in clears the address: the failures before it were the person, not an attack. */
  recordSuccess(client: string): void {
    this.#windows.delete(client)
  }

  #current(client: string): Window | undefined {
    const window = this.#windows.get(client)
    if (window === undefined) return undefined
    if (this.#now() - window.startedAt < LOGIN_WINDOW_MS) return window

    this.#windows.delete(client)
    return undefined
  }

  /** Swept when a new address appears, so the map holds at most one window's worth of addresses. */
  #forgetExpired(): void {
    const now = this.#now()
    for (const [client, window] of this.#windows) {
      if (now - window.startedAt >= LOGIN_WINDOW_MS) this.#windows.delete(client)
    }
  }
}
