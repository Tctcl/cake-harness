import type { ContextView } from '@earendil-works/pi-durable'
import type { Message, TextContent, Tool } from '@earendil-works/pi-ai'

/**
 * What one conversation's next request is made of, in tokens. Everything is estimated locally: no provider reports a
 * split, and the counts have to exist before the first answer arrives, so `Math.ceil(chars / 4)` is the whole method —
 * close enough for a bar chart, and the same approximation the harness itself uses to decide when to compact.
 */
export type ContextCategoryKind = 'messages' | 'systemPrompt' | 'systemTools'

export interface ContextCategory {
  readonly kind: ContextCategoryKind
  readonly tokens: number
}

export interface ContextUsage {
  /** The model the newest answer ran with; `null` until the conversation has answered once. */
  readonly provider: string | null
  readonly modelId: string | null
  /** The model's window, or `null` when the model is not in the catalog any more. */
  readonly contextWindow: number | null
  /** Sum of the categories: the estimated size of the request. */
  readonly used: number
  /** Window minus used, or `null` without a known window. Never negative. */
  readonly remaining: number | null
  /** In the order a reader expects: the transcript, the prompt that frames it, then the tools offered with it. */
  readonly categories: readonly ContextCategory[]
}

const CHARS_PER_TOKEN = 4

/** Rough token count for one piece of prompt text; empty text is free rather than one token. */
export const estimateTokens = (text: string): number =>
  text === '' ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN)

const textOf = (content: string | readonly TextContent[]): string =>
  typeof content === 'string' ? content : content.map((block) => block.text).join('')

/** The system messages of a request: the leading prompt, its sections and the tool declarations, all as one entry list. */
const isSystem = (message: Message): boolean => message.role === 'system'

/**
 * The prompt and the tools as the next request would carry them, replayed in entry order. A section is replaced by name
 * and deleted by a `null`; a tool arrives with `toolsAdded` and leaves with `toolsRemoved`, so the last declaration of a
 * name wins and a removed tool is gone even if it was declared before.
 */
export const replaySystem = (entries: ContextView['entries']): { prompt: string; tools: Tool[] } => {
  const parts: string[] = []
  const sections = new Map<string, string>()
  const tools = new Map<string, Tool>()

  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      if (message.role !== 'system') continue

      const text = textOf(message.content)
      // Later system entries carry instructions and section edits, not a second base prompt: only the leading text counts.
      if (text !== '') parts.push(text)

      for (const [key, value] of Object.entries(message.sections ?? {})) {
        if (value === null) sections.delete(key)
        else sections.set(key, value)
      }

      for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool)
      for (const reference of message.toolsRemoved ?? []) tools.delete(reference.name)
    }
  }

  const prompt = [...parts, ...sections.values()].join('\n\n')

  return { prompt, tools: [...tools.values()] }
}

/**
 * One tool as the provider receives it. The schema is what dominates a tool's size — a name alone is a few tokens, so
 * measuring only the description would make every tool look free.
 */
const toolText = (tool: Tool): string =>
  JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  })

export const measureContext = (
  view: ContextView,
  model: { readonly provider: string; readonly modelId: string } | null,
  contextWindow: number | null,
): ContextUsage => {
  const { prompt, tools } = replaySystem(view.entries)

  const categories: ContextCategory[] = [
    {
      kind: 'messages',
      tokens: view.messages
        .filter((message) => !isSystem(message))
        .reduce((total, message) => total + estimateTokens(JSON.stringify(message)), 0),
    },
    { kind: 'systemPrompt', tokens: estimateTokens(prompt) },
    {
      kind: 'systemTools',
      tokens: tools.reduce((total, tool) => total + estimateTokens(toolText(tool)), 0),
    },
  ]

  const used = categories.reduce((total, category) => total + category.tokens, 0)

  return {
    provider: model?.provider ?? null,
    modelId: model?.modelId ?? null,
    contextWindow,
    used,
    remaining: contextWindow === null ? null : Math.max(0, contextWindow - used),
    categories,
  }
}
