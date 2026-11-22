import type { FastifyError, FastifyInstance } from 'fastify'

import { AppError } from './errors.js'

export interface ErrorHandlingOptions {
  /** Include the original error message for unexpected failures in responses. */
  readonly exposeDetails: boolean
}

interface ErrorBody {
  readonly error: {
    readonly code: string
    readonly message: string
  }
}

function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } }
}

// Fastify error handlers are encapsulated, so this must be called on the root
// instance: routes registered in plugins inherit it, siblings would not.
export function registerErrorHandling(
  server: FastifyInstance,
  options: ErrorHandlingOptions,
): void {
  server.setNotFoundHandler((request, reply) => {
    reply.code(404).send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url} not found`))
  })

  server.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ err: error }, 'request failed')
      reply.code(error.statusCode).send(errorBody(error.code, error.message))
      return
    }

    if (error.validation) {
      request.log.info({ err: error }, 'request validation failed')
      reply.code(400).send(errorBody('VALIDATION_ERROR', error.message))
      return
    }

    request.log.error({ err: error }, 'unhandled request error')

    const statusCode =
      error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500

    reply
      .code(statusCode)
      .send(
        errorBody(
          statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
          statusCode === 500 && !options.exposeDetails ? 'Internal server error' : error.message,
        ),
      )
  })
}
