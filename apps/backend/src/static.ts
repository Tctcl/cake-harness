import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply } from 'fastify'

/** Send one file from the mounted directory, as the answer to a browser navigation. */
export type SendIndex = (reply: FastifyReply) => void

/**
 * Mounts the built SPA at `/` and answers the function that serves `index.html`.
 *
 * Deliberately synchronous: `setNotFoundHandler` only takes effect before the instance boots, so the caller has to be
 * able to register the fallback in the same tick it registers this. Fastify queues the `@fastify/static` registration
 * itself and boots it before serving, which is all `sendFile` needs.
 *
 * Answers `undefined` when no directory is configured: `pnpm dev` serves the frontend from Vite, and the image build is
 * the only thing that sets `FRONTEND_DIR`.
 */
export function registerStatic(server: FastifyInstance, directory: string | undefined): SendIndex | undefined {
  if (directory === undefined) {
    return undefined
  }

  const root = resolve(directory)
  if (!existsSync(join(root, 'index.html'))) {
    // A missing build is a broken deployment, not a page that 404s later.
    throw new Error(`FRONTEND_DIR ${root} has no index.html`)
  }

  server.register(fastifyStatic, { root, wildcard: false })

  return (reply) => {
    void reply.sendFile('index.html')
  }
}
