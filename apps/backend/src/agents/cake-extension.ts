import { defineExtension } from '@earendil-works/pi-durable'

/**
 * The app-owned system prompt, frozen by the first request of a conversation. It renders from the snapshot rather than
 * from the live setting, because a prompt that changes up front invalidates the provider's whole cached prefix;
 * editing the setting steers new conversations only.
 */
export const createCakeExtension = (systemPrompt: (conversationId: number) => Promise<string>) =>
  defineExtension({
    name: 'cake',
    sections: [{ key: 'cake-system', render: (input) => systemPrompt(Number(input.conversationId)) }],
  })

/** Deliberately separate from `cake`: selecting a sub agent must not inherit the user-facing global prompt. */
export const createSubagentCakeExtension = (systemPrompt: (conversationId: number) => Promise<string>) =>
  defineExtension({
    name: 'cake-subagent',
    sections: [{ key: 'cake-system', render: (input) => systemPrompt(Number(input.conversationId)) }],
  })
