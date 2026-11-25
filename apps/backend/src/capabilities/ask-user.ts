import { defineExtension, defineSignal, defineTool } from '@earendil-works/pi-durable'
import type { JsonValue } from '@earendil-works/chord/json'
import type { Context } from '@earendil-works/chord/context'
import type { SignalState, WakeReason } from '@earendil-works/pi-durable'

export interface AskUserInput {
  readonly question: string
  readonly options?: readonly string[] | undefined
  readonly allowFreeText?: boolean | undefined
}

export interface AskUserQuestion {
  readonly [key: string]: JsonValue
  readonly text: string
  readonly options: string[]
  readonly allowFreeText: boolean
}

export const ASK_USER_ANSWER = defineSignal({
  name: 'cake-ask-user-answer',
  version: 1,
  schema: { type: 'string', minLength: 1, maxLength: 4000 },
})

const parameters = {
  type: 'object',
  properties: {
    question: { type: 'string', minLength: 1 },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      items: { type: 'string', minLength: 1, maxLength: 100 },
    },
    allowFreeText: { type: 'boolean', default: true },
  },
  required: ['question'],
  additionalProperties: false,
} as const

interface AskUserApi {
  readonly callId: string
  readonly wake: WakeReason | undefined
  readonly checkpoint: JsonValue | undefined
  details(value: JsonValue, context: Context): Promise<void>
  readSignal(
    token: typeof ASK_USER_ANSWER,
    key: string,
    context: Context,
  ): Promise<SignalState<unknown> | undefined>
}

const questionFromCheckpoint = (checkpoint: JsonValue | undefined): AskUserQuestion | undefined => {
  if (typeof checkpoint !== 'object' || checkpoint === null || Array.isArray(checkpoint)) return undefined
  const text = checkpoint['text']
  const options = checkpoint['options']
  const allowFreeText = checkpoint['allowFreeText']
  if (typeof text !== 'string' || !Array.isArray(options)) return undefined
  const stringOptions = options.filter((option): option is string => typeof option === 'string')
  if (stringOptions.length !== options.length) return undefined
  if (typeof allowFreeText !== 'boolean') return undefined

  return {
    text,
    options: stringOptions,
    allowFreeText,
  }
}

/** Re-entering after a signal reads the durable value; otherwise this call publishes its card and parks. */
export const executeAskUser = async (
  args: AskUserInput,
  api: AskUserApi,
  context: Context,
) => {
  const question = args.question.trim()
  const options = args.options ?? []
  const allowFreeText = args.allowFreeText ?? true
  if (question === '') throw new Error('question must not be empty')
  if (options.length === 1 || options.length > 6) throw new Error('options must contain 2–6 choices')
  if (options.some((option) => option.trim() === '' || option.length > 100)) {
    throw new Error('each option must be a non-empty short choice')
  }
  if (options.length === 0 && !allowFreeText) throw new Error('a question without free text needs options')

  const key = api.callId
  const signal = await api.readSignal(ASK_USER_ANSWER, key, context)
  if (signal !== undefined && 'value' in signal) {
    if (typeof signal.value !== 'string') throw new Error('the ask_user answer signal was not text')

    return { output: [{ type: 'text' as const, text: `The user answered: ${signal.value}` }] }
  }
  if (api.wake?.reason === 'signal') {
    throw new Error('the ask_user answer signal woke without a committed value')
  }

  const details =
    questionFromCheckpoint(api.checkpoint) ??
    { text: question, options: [...options], allowFreeText }
  await api.details(details, context)

  return {
    sleep: {
      signals: [ASK_USER_ANSWER.key(key)],
      checkpoint: details,
    },
  }
}

const askUser = defineTool({
  name: 'ask_user',
  description: 'Ask the user a blocking question and wait for their answer before continuing.',
  parameters,
  replay: 'safe',
  async execute(args, api, context) {
    // The harness validates this JSON schema before execution; its static type cannot infer the object properties.
    return executeAskUser(args as AskUserInput, api, context)
  },
})

/** Environment-free: the question is answered through the durable harness signal, not workspace tools. */
export const createAskUserExtension = () =>
  defineExtension({ name: 'ask-user', tools: [askUser] })
