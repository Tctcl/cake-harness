import { existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

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

  // `wildcard: false` makes one GET route per built file, and every route passes the sign-in check unless it is marked
  // public. The bundle is what draws the sign-in form, so its files are public. Only these exact paths are marked, so no
  // API route is affected. Without this, a signed-out browser got 401 JSON for `/` and never saw the form.
  const files = builtFiles(root)
  server.addHook('onRoute', (route) => {
    if (files.has(route.url)) route.config = { ...route.config, public: true }
  })

  server.register(fastifyStatic, { root, wildcard: false })

  return (reply) => {
    void reply.sendFile('index.html')
  }
}

/** The URL of every file under `root`, plus `/` for the index: the routes `@fastify/static` registers for them. */
const builtFiles = (root: string): ReadonlySet<string> => {
  const urls = new Set<string>(['/'])
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    urls.add(`/${relative(root, join(entry.parentPath, entry.name)).split(sep).join('/')}`)
  }

  return urls
}
