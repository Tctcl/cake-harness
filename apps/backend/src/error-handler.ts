import type { FastifyError, FastifyInstance } from 'fastify'

import { AppError } from './errors.js'
import type { SendIndex } from './static.js'

export interface ErrorHandlingOptions {
  /** Include the original error message for unexpected failures in responses. */
  readonly exposeDetails: boolean
  /** Answers a browser navigation that matched no route, or `undefined` when no SPA is mounted. */
  readonly sendIndex: SendIndex | undefined
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
    // A browser navigation that matched no route is the SPA's own route, so it gets index.html. Anything else, an
    // unknown API path included, gets the JSON shape the frontend already knows how to read.
    if (
      options.sendIndex !== undefined &&
      request.method === 'GET' &&
      request.headers.accept?.includes('text/html') === true
    ) {
      options.sendIndex(reply)
      return
    }

    reply.code(404).send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url} not found`))
  })

  server.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AppError) {
      // A refusal (4xx) is the API working: one line with the code, no stack. A signed-out browser alone would otherwise
      // write a warning with a full stack trace for every request it makes.
      if (error.statusCode < 500) request.log.info({ code: error.code, statusCode: error.statusCode }, error.message)
      else request.log.warn({ err: error }, 'request failed')
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
