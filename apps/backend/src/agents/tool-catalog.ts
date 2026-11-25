import type { RegistrySnapshot } from '@earendil-works/pi-durable'

import type { ToolRepository } from '../capabilities/tool-repository.js'

/** Synchronize one owner's catalog from the same registry sessions use; called before default agents are repaired. */
export const syncToolCatalog = async (
  tools: ToolRepository,
  ownerId: string,
  registry: RegistrySnapshot,
): Promise<void> => {
  await tools.sync(
    ownerId,
    registry.tools().map(({ tool }) => ({
      name: tool.name,
      parameters: tool.parameters,
      ...(tool.description === undefined ? {} : { description: tool.description }),
    })),
  )
}
