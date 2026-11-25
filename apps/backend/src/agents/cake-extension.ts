import { defineExtension } from '@earendil-works/pi-durable'

/** The app-owned system prompt is rendered on every turn so settings edits apply to the next request. */
export const createCakeExtension = (readSystemPrompt: () => Promise<string>) =>
  defineExtension({
    name: 'cake',
    sections: [{ key: 'cake-system', render: () => readSystemPrompt() }],
  })
