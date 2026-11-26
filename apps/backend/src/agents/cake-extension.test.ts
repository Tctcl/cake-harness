import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { describe, expect, it, vi } from 'vitest'

import { createCakeExtension, createSubagentCakeExtension } from './cake-extension.js'

describe('Cake prompt extensions', () => {
  it('renders the separate global subagent prompt without reading the user-facing prompt', async () => {
    const userPrompt = vi.fn(async () => 'user-facing prompt')
    const subagentPrompt = vi.fn(async () => 'machine-to-machine prompt')
    const ordinary = createCakeExtension(userPrompt)
    const subagent = createSubagentCakeExtension(subagentPrompt)
    const ordinarySection = ordinary.sections?.[0]
    const subagentSection = subagent.sections?.[0]
    if (ordinarySection === undefined || subagentSection === undefined) throw new Error('prompt sections are missing')

    await expect(ordinarySection.render({} as never, BACKGROUND_CONTEXT)).resolves.toBe('user-facing prompt')
    await expect(subagentSection.render({} as never, BACKGROUND_CONTEXT)).resolves.toBe('machine-to-machine prompt')
    expect(userPrompt).toHaveBeenCalledTimes(1)
    expect(subagentPrompt).toHaveBeenCalledTimes(1)
  })
})
