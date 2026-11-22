export interface AppErrorOptions {
  readonly statusCode?: number
  readonly code?: string
  readonly cause?: unknown
}

// Errors that may cross the HTTP boundary: the status and code are part of the
// response contract, unlike a plain internal failure.
export class AppError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.statusCode = options.statusCode ?? 500
    this.code = options.code ?? 'INTERNAL_ERROR'
  }
}
