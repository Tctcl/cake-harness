/**
 * Which failures may be retried inside a `Storage` method, and how often.
 *
 * Durable's contract (`types.d.ts`, `Storage`): "An error a method throws is final: it fails the Session, which nothing
 * retries, so retry transient failures inside". This module is that "inside".
 */

/** How long to keep trying. `attempts` counts total tries, so `attempts: 3` means at most two retries. */
export interface RetryOptions {
  readonly attempts: number
  /** First backoff; doubles per attempt, capped at `maxDelayMs`. */
  readonly baseDelayMs: number
  readonly maxDelayMs: number
}

/** The `code` an error carries, which postgres sets to a SQLSTATE and node's sockets to an errno. */
const codeOf = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const { code } = error
  return typeof code === 'string' ? code : undefined
}

/**
 * The connection never opened, so not a single statement ran: even a write is safe to replay.
 * `08001` is sqlclient_unable_to_establish_sqlconnection, `08004` a refused connection, `57P03` a server still
 * starting, `53300` a server refusing for lack of slots.
 */
const neverConnected = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  '08001',
  '08004',
  '57P03',
  '53300',
])

/**
 * The connection was lost with a statement possibly in flight: only a read may be replayed.
 *
 * `ETIMEDOUT` belongs here, not above: a socket that was already open reports it when the server stops answering
 * mid-statement, so a commit may have landed. Replaying it would find its own IDs claimed and report a stored batch as
 * refused.
 */
const connectionLost = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '08003', '08006', '57P01'])

/** Nothing ran, so a write may be retried. */
export const isConnectFailure = (error: unknown): boolean => {
  const code = codeOf(error)
  return code !== undefined && neverConnected.has(code)
}

/** A read may be retried: either nothing ran or nothing was written. */
export const isTransient = (error: unknown): boolean => {
  const code = codeOf(error)
  return code !== undefined && (neverConnected.has(code) || connectionLost.has(code))
}

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** 100, 200, 400, … capped, so a long outage does not turn into one request per second forever. */
const backoffFor = (attempt: number, options: RetryOptions): number =>
  Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs)

/**
 * Run `operation`, retrying only failures `retryable` accepts. Anything else propagates immediately: a definitive error
 * must not be repeated, because the Session treats it as final either way.
 */
export const withRetry = async <T>(
  options: RetryOptions,
  retryable: (error: unknown) => boolean,
  operation: () => Promise<T>,
): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= options.attempts || !retryable(error)) throw error
      await delay(backoffFor(attempt, options))
    }
  }
}

/**
 * Run `operation` until it succeeds or `deadlineMs` has passed, for a caller that would rather wait out a restart than
 * answer. Unlike `withRetry` the bound is time, not attempts: a database that takes eight seconds to come back needs
 * roughly nine attempts, and one that takes 200 ms needs two.
 */
export const withRetryUntil = async <T>(
  deadlineMs: number,
  options: Omit<RetryOptions, 'attempts'>,
  retryable: (error: unknown) => boolean,
  operation: () => Promise<T>,
): Promise<T> => {
  const deadline = Date.now() + deadlineMs
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const remaining = deadline - Date.now()
      if (remaining <= 0 || !retryable(error)) throw error
      await delay(Math.min(backoffFor(attempt, { ...options, attempts: 1 }), remaining))
    }
  }
}
