import { fileURLToPath } from 'node:url'

import type { Context } from '@earendil-works/chord/context'
import { Connection, RemoteExecutionEnv, isConnectionLost } from '@earendil-works/pi-env'
import type { Reply } from '@earendil-works/pi-env'
import type { EnvTarget } from '@earendil-works/pi-durable'
import type { ExecutionEnv } from '@earendil-works/pi-durable/env'

import type { EnvironmentApi } from './api.js'
import type { DaemonInstaller } from './daemon-installer.js'
import type { ThreadRepository } from '../threads/thread-repository.js'
import type { WorkspaceRepository } from '../workspaces/workspace-repository.js'
import type { DelegationRepository } from '../delegations/delegation-repository.js'

const WORKSPACE_CWD = '/home/dev/workspace'

interface CachedEnvironment {
  readonly connection: Connection
}

class ObservedConnection extends Connection {
  readonly #onLost: () => void

  constructor(options: ConstructorParameters<typeof Connection>[0], onLost: () => void) {
    super(options)
    this.#onLost = onLost
  }

  override async request(...args: Parameters<Connection['request']>): Promise<Reply> {
    try {
      return await super.request(...args)
    } catch (error) {
      if (isConnectionLost(error)) this.#onLost()
      throw error
    }
  }
}

export interface ExecutionEnvironmentOptions {
  readonly threads: Pick<ThreadRepository, 'findByConversation' | 'find'>
  readonly workspaces: Pick<WorkspaceRepository, 'find'>
  readonly delegations: Pick<DelegationRepository, 'findByChildConversation'>
  readonly environments: Pick<EnvironmentApi, 'ofWorkspace' | 'start'>
  readonly installer: DaemonInstaller
}

export interface ExecutionEnvironmentProvider {
  open(target: EnvTarget, context: Context): Promise<ExecutionEnv | undefined>
  close(): Promise<void>
}

// tsx leaves this module's URL ending in .ts; tsc rewrites the specifier to .js. Node 26 runs the source bridge directly.
const bridgePath = (): string => {
  const extension = fileURLToPath(import.meta.url).endsWith('.ts') ? 'ts' : 'js'

  return fileURLToPath(new URL(`./daemon-bridge.${extension}`, import.meta.url))
}

/** One lazily-started daemon connection per environment, shared by every conversation and tool call in that workspace. */
export const createExecutionEnvironment = (
  options: ExecutionEnvironmentOptions,
): ExecutionEnvironmentProvider => {
  const cached = new Map<string, CachedEnvironment>()
  const opening = new Map<string, Promise<CachedEnvironment>>()
  let closed = false

  const connect = async (environmentId: string, context: Context): Promise<CachedEnvironment> => {
    // EnvironmentApi.start owns ensureRunning and setContainer: a replaced container never leaves this cache using its old id.
    const started = await options.environments.start(environmentId)
    if (started === undefined || started.containerId === null) {
      throw new Error(`environment ${environmentId} has no running container`)
    }
    const daemonPath = await options.installer.ensure(started.containerId)
    const connection = new ObservedConnection(
      { command: [process.execPath, bridgePath(), started.containerId, daemonPath] },
      () => {
        if (cached.get(environmentId) === entry) cached.delete(environmentId)
        connection.close()
      },
    )
    const entry: CachedEnvironment = { connection }

    try {
      // This performs the PI-ENV token sync and hello before a tool can see the environment.
      await connection.info(context.abortSignal)
      if (closed) throw new Error('the execution environment provider is closed')
      cached.set(environmentId, entry)
      return entry
    } catch (error) {
      connection.close()
      throw error
    }
  }

  const forEnvironment = (environmentId: string, context: Context): Promise<CachedEnvironment> => {
    const existing = cached.get(environmentId)
    if (existing !== undefined) return Promise.resolve(existing)
    const pending = opening.get(environmentId)
    if (pending !== undefined) return pending

    const created = connect(environmentId, context)
    opening.set(environmentId, created)
    void created.finally(() => {
      if (opening.get(environmentId) === created) opening.delete(environmentId)
    }).catch(() => {
      // The caller receives the connection failure; this handler only keeps the bookkeeping promise from being unhandled.
    })

    return created
  }

  return {
    async open(target, context) {
      if (closed) return undefined
      const direct = await options.threads.findByConversation(Number(target.conversationId))
      const delegation = direct === undefined
        ? await options.delegations.findByChildConversation(Number(target.conversationId))
        : undefined
      const thread = direct ?? (delegation === undefined
        ? undefined
        : await options.threads.find(delegation.parentThreadId))
      if (thread === undefined) return undefined
      const workspace = await options.workspaces.find(thread.workspaceId)
      if (workspace === undefined) return undefined
      // General's container runs skills and MCP servers, never the agent's own shell or file tools.
      if (workspace.isDefault) return undefined
      const environment = (await options.environments.ofWorkspace(workspace.id))[0]
      if (environment === undefined) return undefined

      const { connection } = await forEnvironment(environment.id, context)

      // cwd is per conversation, not per container: a shared mutable env would race parallel worktree delegations.
      return new RemoteExecutionEnv({
        connection,
        id: `pi-env:${environment.id}`,
        cwd: target.cwd ?? WORKSPACE_CWD,
      })
    },

    async close() {
      closed = true
      await Promise.allSettled(opening.values())
      for (const { connection } of cached.values()) connection.close()
      cached.clear()
    },
  }
}
