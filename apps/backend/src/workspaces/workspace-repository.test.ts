import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { EnvironmentRepository } from '../environments/environment-repository.js'
import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { ThreadRepository } from '../threads/thread-repository.js'
import {
  DEFAULT_AGENT_ID,
  DEFAULT_WORKSPACE_DESCRIPTION,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
} from './defaults.js'
import { WorkspaceRepository } from './workspace-repository.js'

/**
 * Runs against a real server like the thread suite: `DATABASE_URL` must point at a disposable database, and each case
 * gets its own table prefix. Without the variable the file reports nothing instead of failing.
 */
/** The image a workspace records until its container is first started; the value `WORKSPACE_IMAGE` defaults to. */
const IMAGE = 'cake-harness/dev-env:dev'

const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('WorkspaceRepository (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  const withWorkspaces = async (
    use: (
      workspaces: WorkspaceRepository,
      threads: ThreadRepository,
      ownerId: string,
      environments: EnvironmentRepository,
    ) => Promise<void>,
  ): Promise<void> => {
    const prefix = `w${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    const { schema } = storage
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, schema)
      await use(
        new WorkspaceRepository(storage.pool, schema),
        new ThreadRepository(storage.pool, schema),
        ownerId,
        new EnvironmentRepository(storage.pool, schema),
      )
    } finally {
      await storage.close({} as never)
    }
  }

  describe('WorkspaceRepository', () => {
    it('lists the seeded default workspace', async () => {
      await withWorkspaces(async (workspaces, _threads, ownerId) => {
        const all = await workspaces.list(ownerId)

        expect(all).toHaveLength(1)
        expect(all[0]).toMatchObject({
          id: DEFAULT_WORKSPACE_ID,
          name: DEFAULT_WORKSPACE_NAME,
          description: DEFAULT_WORKSPACE_DESCRIPTION,
          isDefault: true,
          allowAll: true,
        })
        await expect(workspaces.default(ownerId)).resolves.toMatchObject({ id: DEFAULT_WORKSPACE_ID })
      })
    })

    it('records a workspace with its ceiling', async () => {
      await withWorkspaces(async (workspaces) => {
        const workspace = await workspaces.create('00000000-0000-4000-8000-000000000001', {
          name: 'Platform',
          description: 'Needs to reach everything',
          allowAll: false,
        }, IMAGE)

        expect(workspace).toMatchObject({
          name: 'Platform',
          description: 'Needs to reach everything',
          isDefault: false,
          allowAll: false,
        })
        await expect(workspaces.find(workspace.id)).resolves.toMatchObject({ id: workspace.id })
      })
    })

    it('creates the one environment the workspace runs in', async () => {
      await withWorkspaces(async (workspaces, _threads, ownerId, environments) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        const attached = await environments.ofWorkspace(workspace.id)

        expect(attached).toHaveLength(1)
        expect(attached[0]).toMatchObject({ name: 'Platform', image: IMAGE, containerId: null })
      })
    })

    it('gives General an environment at startup, once', async () => {
      await withWorkspaces(async (workspaces, _threads, ownerId, environments) => {
        await expect(environments.ofWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toEqual([])
        await expect(workspaces.ensureEnvironments(ownerId, IMAGE)).resolves.toBe(1)

        const attached = await environments.ofWorkspace(DEFAULT_WORKSPACE_ID)
        expect(attached).toHaveLength(1)
        expect(attached[0]).toMatchObject({ name: DEFAULT_WORKSPACE_NAME, image: IMAGE, containerId: null })
        await expect(workspaces.ensureEnvironments(ownerId, IMAGE)).resolves.toBe(0)
      })
    })

    it('gives a workspace that lost its environment one again, once', async () => {
      await withWorkspaces(async (workspaces, _threads, ownerId, environments) => {
        await workspaces.ensureEnvironments(ownerId, IMAGE)
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        const [environment] = await environments.ofWorkspace(workspace.id)
        if (environment === undefined) throw new Error('the workspace was created without an environment')

        // Deleting the row takes the link with it, which is the state an install predating the rule is in.
        await environments.remove(environment.id)
        await expect(environments.ofWorkspace(workspace.id)).resolves.toEqual([])

        await expect(workspaces.ensureEnvironments(ownerId, 'cake-harness/dev-env:next')).resolves.toBe(1)
        const [healed] = await environments.ofWorkspace(workspace.id)
        expect(healed).toMatchObject({ name: 'Platform', image: 'cake-harness/dev-env:next' })

        // Nothing is missing the second time, which is what makes it safe to run on every boot.
        await expect(workspaces.ensureEnvironments(ownerId, 'cake-harness/dev-env:next')).resolves.toBe(0)
      })
    })

    it('puts a new workspace on top of the list', async () => {
      await withWorkspaces(async (workspaces, _threads, ownerId) => {
        const first = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        const second = await workspaces.create(ownerId, { name: 'Research' }, IMAGE)

        // Newest first, and the default workspace — the one that was already there — last: the list is arranged, not
        // derived from a timestamp, so creating a workspace has to move the others down itself.
        const all = await workspaces.list(ownerId)
        expect(all.map((workspace) => workspace.name)).toEqual([
          'Research',
          'Platform',
          DEFAULT_WORKSPACE_NAME,
        ])
        expect(all.map((workspace) => workspace.position)).toEqual([0, 1, 2])
        expect(first.position).toBe(0)
        expect(second.position).toBe(0)
      })
    })

    it('keeps the order the user drags into place', async () => {
      await withWorkspaces(async (workspaces, _threads, ownerId) => {
        const platform = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        const research = await workspaces.create(ownerId, { name: 'Research' }, IMAGE)

        const reordered = await workspaces.reorder(ownerId, [
          DEFAULT_WORKSPACE_ID,
          research.id,
          platform.id,
        ])

        expect(reordered.map((workspace) => workspace.name)).toEqual([
          DEFAULT_WORKSPACE_NAME,
          'Research',
          'Platform',
        ])
        await expect(workspaces.list(ownerId)).resolves.toMatchObject(
          reordered.map((workspace) => ({ id: workspace.id, position: workspace.position })),
        )
      })
    })

    it('refuses an order that does not name every workspace exactly once', async () => {
      await withWorkspaces(async (workspaces, _threads, ownerId) => {
        const platform = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)

        await expect(workspaces.reorder(ownerId, [platform.id])).rejects.toMatchObject({
          code: 'WORKSPACE_ORDER_INVALID',
        })
        await expect(
          workspaces.reorder(ownerId, [platform.id, platform.id, DEFAULT_WORKSPACE_ID]),
        ).rejects.toMatchObject({ code: 'WORKSPACE_ORDER_INVALID' })
        await expect(
          workspaces.reorder(ownerId, [platform.id, '00000000-0000-4000-8000-000000000009']),
        ).rejects.toMatchObject({ code: 'WORKSPACE_ORDER_INVALID' })
      })
    })

    it('refuses to edit, archive or delete the default workspace', async () => {
      await withWorkspaces(async (workspaces) => {
        await expect(
          workspaces.update(DEFAULT_WORKSPACE_ID, { name: 'Renamed' }),
        ).rejects.toMatchObject({ code: 'WORKSPACE_IMMUTABLE', statusCode: 403 })
        await expect(workspaces.archive(DEFAULT_WORKSPACE_ID)).rejects.toMatchObject({
          code: 'WORKSPACE_IMMUTABLE',
        })
        await expect(workspaces.restore(DEFAULT_WORKSPACE_ID)).rejects.toMatchObject({
          code: 'WORKSPACE_IMMUTABLE',
        })
        await expect(workspaces.remove(DEFAULT_WORKSPACE_ID)).rejects.toMatchObject({
          code: 'WORKSPACE_IMMUTABLE',
        })
      })
    })

    it('edits a workspace', async () => {
      await withWorkspaces(async (workspaces) => {
        const workspace = await workspaces.create(
          '00000000-0000-4000-8000-000000000001',
          { name: 'Platform' },
          IMAGE,
        )

        const renamed = await workspaces.update(workspace.id, { name: 'Platform v2' })

        expect(renamed).toMatchObject({ name: 'Platform v2' })
        await expect(workspaces.update(workspace.id, {})).resolves.toMatchObject({
          name: 'Platform v2',
        })
        await expect(
          workspaces.update('00000000-0000-4000-8000-00000000beef', { name: 'x' }),
        ).resolves.toBeUndefined()
      })
    })

    it('archives a workspace with its agents and threads', async () => {
      await withWorkspaces(async (workspaces, threads, ownerId) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        const thread = await threads.create(ownerId, 1, {
          workspaceId: workspace.id,
          agentId: DEFAULT_AGENT_ID,
        })

        const archived = await workspaces.archive(workspace.id)
        expect(archived?.archivedAt).toBeInstanceOf(Date)
        await expect(workspaces.list(ownerId)).resolves.toHaveLength(1) // the seeded default only
        await expect(workspaces.list(ownerId, { archived: true })).resolves.toHaveLength(1)
        // The scope is what hides work, so the agent and the thread go with it.
        await expect(threads.list(ownerId)).resolves.toHaveLength(0)
        await expect(threads.list(ownerId, { archived: true })).resolves.toMatchObject([
          { id: thread.id },
        ])

        // Restoring the workspace leaves each row to be restored on its own.
        const restored = await workspaces.restore(workspace.id)
        expect(restored?.archivedAt).toBeNull()
        await expect(threads.list(ownerId)).resolves.toHaveLength(0)
      })
    })

    it('refuses to remove a live workspace', async () => {
      await withWorkspaces(async (workspaces, _threads, ownerId) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)

        await expect(workspaces.remove(workspace.id)).rejects.toMatchObject({
          code: 'WORKSPACE_NOT_ARCHIVED',
          statusCode: 409,
        })
      })
    })

    it('refuses to remove an archived workspace holding a thread restored on its own', async () => {
      await withWorkspaces(async (workspaces, threads, ownerId) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        const thread = await threads.create(ownerId, 1, {
          workspaceId: workspace.id,
          agentId: DEFAULT_AGENT_ID,
        })

        await workspaces.archive(workspace.id)
        await threads.restore(thread.id)

        await expect(workspaces.remove(workspace.id)).rejects.toMatchObject({
          code: 'WORKSPACE_IN_USE',
          statusCode: 409,
        })
      })
    })

    it('deletes an archived workspace and answers undefined afterwards', async () => {
      await withWorkspaces(async (workspaces, _threads, ownerId) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        await workspaces.archive(workspace.id)

        await expect(workspaces.remove(workspace.id)).resolves.toBe(true)
        await expect(workspaces.remove(workspace.id)).resolves.toBe(false)
        await expect(workspaces.find(workspace.id)).resolves.toBeUndefined()
      })
    })
  })

  afterAll(async () => {
    if (created.length === 0) return
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      for (const table of created) {
        const drop = `DROP TABLE IF EXISTS ${table} CASCADE`
        await client.query(drop)
      }
    } finally {
      await client.end()
    }
  })
}
