import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import type { FauxResponseFactory } from '@earendil-works/pi-ai/providers/faux'
import { getCurrentSystemPrompt } from '@earendil-works/pi-ai/utils/transcript'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import { describe, expect, it } from 'vitest'

import { chatMessages } from '../agent.js'
import type { CallableSubagent } from '../subagents/subagent-repository.js'
import { createCakeExtension } from './cake-extension.js'
import { reminderOf, renderReminder, toolPurpose, turnSubmission } from './turn-reminder.js'
import type { ReminderTool } from './turn-reminder.js'

const CONTEXT = BACKGROUND_CONTEXT

const tool = (name: string, description: string): ReminderTool => ({ name, description })

const READ = tool('read', 'Read the contents of a file. Supports text files and images.')
const BASH = tool('bash', 'Execute a bash command in the current working directory.')

const reviewer: CallableSubagent = {
  id: '5d4e3f60-7b8c-4d1e-9f2a-3b4c5d6e7f80',
  name: 'Reviewer',
  description: 'Reviews one focused task',
  modelId: 'default',
  thinkingLevel: 'medium',
  allowedModels: ['default', 'other'],
}

const auditor: CallableSubagent = {
  id: '6e5f4071-8c9d-4e2f-8a3b-4c5d6e7f8091',
  name: 'Auditor',
  description: 'Audits a change',
  modelId: 'other',
  thinkingLevel: 'low',
  allowedModels: ['other'],
}

const plain = { instructions: '', tools: [], subagents: [], skills: [] } as const

describe('renderReminder', () => {
  it('carries the instructions first, then tools, sub agents and skills', () => {
    const reminder = renderReminder({
      instructions: ' Answer in French. ',
      tools: [READ, BASH],
      subagents: [reviewer],
      skills: [{ name: 'pdf', description: 'Extracts text from PDFs' }],
    })

    expect(reminder).toContain('Answer in French.')
    expect(reminder).toContain('read (Read the contents of a file.)')
    expect(reminder).toContain('bash (Execute a bash command in the current working directory.)')
    expect(reminder).toContain(`${reviewer.name} (${reviewer.id}): Reviews one focused task`)
    expect(reminder).toContain('default model default; allowed models default, other')
    expect(reminder).toContain('pdf (Extracts text from PDFs)')

    // The model reads the instructions before the account of what it can use.
    expect(reminder?.indexOf('Answer in French.') ?? 0).toBeLessThan(reminder?.indexOf('Tools:') ?? 0)
  })

  it('drops a section it has nothing to say about and is undefined when none is left', () => {
    const reminder = renderReminder({ ...plain, tools: [READ] })

    expect(reminder).toContain('Tools: read (Read the contents of a file.)')
    expect(reminder).not.toContain('Instructions')
    expect(reminder).not.toContain('Sub agents')
    expect(reminder).not.toContain('Skills')
    expect(renderReminder(plain)).toBeUndefined()
  })

  it('stays small: a typical agent is well under 300 tokens', () => {
    const reminder = renderReminder({
      instructions: 'Prefer the smallest change that solves the request.',
      tools: [
        tool('read', 'Read the contents of a file. Supports text files and images.'),
        tool('write', 'Write content to a file. Creates the file if it does not exist.'),
        tool('edit', 'Edit a single file using exact text replacement.'),
        tool('bash', 'Execute a bash command in the current working directory.'),
        tool('grep', 'Search file contents for a pattern.'),
        tool('find', 'Find files by name or glob.'),
        tool('ls', 'List a directory.'),
        tool('git', 'Run one of the read-only git subcommands.'),
        tool('web_fetch', 'Fetch a public URL and return it as text.'),
      ],
      subagents: [reviewer, auditor],
      skills: [],
    })
    // Rough English tokenisation is enough to catch a reminder that stopped being compact.
    const tokens = (reminder ?? '').trim().split(/\s+/).length

    expect(tokens).toBeLessThan(300)
  })
})

describe('toolPurpose', () => {
  it('keeps the first sentence, on one line, clipped when it runs long', () => {
    expect(toolPurpose('Read a file. Also images.')).toBe('Read a file.')
    expect(toolPurpose('No full stop here')).toBe('No full stop here')
    expect(toolPurpose(`${'word '.repeat(40)}end.`)).toHaveLength(80)
    expect(toolPurpose('Two\nlines. Then more.')).toBe('Two lines.')
  })
})

describe('turnSubmission', () => {
  it('appends the reminder as a second block of the same user message and records it on the entry', () => {
    expect(turnSubmission('hello', 'the reminder')).toEqual({
      type: 'input',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'the reminder' },
      ],
      entry: { kind: 'cake.turn', data: { reminder: 'the reminder' } },
    })
  })

  it('sends the plain message when there is no reminder', () => {
    expect(turnSubmission('hello', undefined)).toEqual({ type: 'input', content: 'hello' })
  })

  it('never appends anything to a steer', () => {
    expect(turnSubmission('stop, look at the other file', 'the reminder', 'steer')).toEqual({
      type: 'input',
      content: 'stop, look at the other file',
      whenBusy: 'steer',
    })
  })

  it('still appends to a follow-up, which is an ordinary user message for the next run', () => {
    expect(turnSubmission('and then?', 'the reminder', 'followUp')).toMatchObject({
      content: [
        { type: 'text', text: 'and then?' },
        { type: 'text', text: 'the reminder' },
      ],
      whenBusy: 'followUp',
    })
  })
})

describe('reminderOf', () => {
  it('reads only a non-empty string reminder off an entry data value', () => {
    expect(reminderOf({ reminder: 'text' })).toBe('text')
    expect(reminderOf({ reminder: '' })).toBeUndefined()
    expect(reminderOf({ reminder: 3 })).toBeUndefined()
    expect(reminderOf({ other: 'text' })).toBeUndefined()
    expect(reminderOf(null)).toBeUndefined()
    expect(reminderOf('text')).toBeUndefined()
    expect(reminderOf(undefined)).toBeUndefined()
  })
})

describe('the transcript keeps the reminder out of the user bubble', () => {
  it('shows only what the person typed and keeps the exact reminder beside it', () => {
    const reminder = 'Tools: read (Read the contents of a file.)'
    const messages = chatMessages([
      {
        id: 4,
        conversationId: 1,
        kind: 'cake.turn',
        data: { reminder },
        model: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What does this repository do?' },
            { type: 'text', text: reminder },
          ],
          timestamp: 0,
        }],
      },
    ] as never)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 4,
      role: 'user',
      text: 'What does this repository do?',
      blocks: [{ type: 'text', text: 'What does this repository do?' }],
      reminder,
    })
  })

  it('leaves an input that carried no reminder exactly as it was', () => {
    const messages = chatMessages([
      {
        id: 5,
        conversationId: 1,
        kind: 'pi.user',
        model: [{ role: 'user', content: 'just words', timestamp: 0 }],
      },
    ] as never)

    expect(messages[0]).toMatchObject({ id: 5, role: 'user', text: 'just words' })
    expect(messages[0]?.reminder).toBeUndefined()
  })
})

/** Two turns of a real harness: the second request is what this suite is about. */
describe('a turn carries the sub agents that exist when it starts', () => {
  it('names a sub agent assigned between two turns in the second request only', async () => {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'parent' }, { id: 'default' }, { id: 'other' }] })
    const models = createModels()
    models.setProvider(faux.provider)
    const memory = new MemoryStorage()
    const harness = await Harness.open(memory, { models, registry: createRegistry() }, CONTEXT)
    try {
      const conversation = await harness.createConversation(
        {
          ownership: { kind: 'ownerless' },
          agent: { model: { provider: 'faux', modelId: 'parent' }, thinkingLevel: 'low' },
        },
        CONTEXT,
      )
      let callable: CallableSubagent[] = [reviewer]
      const turn = async (text: string): Promise<void> => {
        const reminder = renderReminder({ instructions: '', tools: [READ], subagents: callable, skills: [] })
        await (await conversation.submit(turnSubmission(text, reminder), CONTEXT)).wait(CONTEXT)
      }
      const userTexts: string[] = []
      const capture = (context: Parameters<FauxResponseFactory>[0]) => {
        // The request's own input is the last user message; earlier turns are history.
        const last = context.messages.findLast((message) => message.role === 'user')
        if (last?.role === 'user') {
          userTexts.push(typeof last.content === 'string'
            ? last.content
            : last.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n'))
        }

        return fauxAssistantMessage('done')
      }
      faux.setResponses([capture, capture])

      await turn('first')
      // The user assigns a second sub agent while the conversation is already going.
      callable = [reviewer, auditor]
      await turn('second')

      expect(userTexts).toHaveLength(2)
      expect(userTexts[0]).toContain('Reviewer')
      expect(userTexts[0]).not.toContain('Auditor')
      expect(userTexts[1]).toContain('Reviewer')
      expect(userTexts[1]).toContain('Auditor')
      expect(userTexts[1]).toContain('default model other; allowed models other')
    } finally {
      await harness.close(CONTEXT)
      await memory.close(CONTEXT)
    }
  }, 20_000)

  it('moves the instructions out of the system message on the turn that starts using the reminder', async () => {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'parent' }] })
    const models = createModels()
    models.setProvider(faux.provider)
    const registry = createRegistry()
    const cake = createCakeExtension(async () => 'the global system prompt')
    registry.install(cake)
    const memory = new MemoryStorage()
    const harness = await Harness.open(memory, { models, registry }, CONTEXT)
    try {
      const conversation = await harness.createConversation(
        {
          ownership: { kind: 'ownerless' },
          // An older conversation: its instructions were part of the system message when it was created.
          agent: {
            model: { provider: 'faux', modelId: 'parent' },
            thinkingLevel: 'low',
            extensions: [cake],
            tools: [],
            instructions: 'Never edit a file without asking.',
          },
        },
        CONTEXT,
      )
      const systemPrompts: string[] = []
      const userTexts: string[] = []
      const capture = (context: Parameters<FauxResponseFactory>[0]) => {
        systemPrompts.push(getCurrentSystemPrompt(context.messages))
        const last = context.messages.findLast((message) => message.role === 'user')
        if (last?.role === 'user') {
          userTexts.push(typeof last.content === 'string'
            ? last.content
            : last.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n'))
        }

        return fauxAssistantMessage('done')
      }
      faux.setResponses([capture, capture])
      const submit = async (text: string): Promise<void> => {
        const reminder = renderReminder({
          instructions: 'Never edit a file without asking.',
          tools: [READ],
          subagents: [],
          skills: [],
        })
        await (await conversation.submit(turnSubmission(text, reminder), CONTEXT)).wait(CONTEXT)
      }

      await submit('first')
      expect(systemPrompts[0]).toContain('Never edit a file without asking.')

      // What every submission now does: the append is the only thing left in the system message.
      await conversation.configure({ instructions: null }, CONTEXT)
      await submit('second')

      expect(systemPrompts[1]).toContain('the global system prompt')
      expect(systemPrompts[1]).not.toContain('Never edit a file without asking.')
      expect(userTexts[1]).toContain('Never edit a file without asking.')
    } finally {
      await harness.close(CONTEXT)
      await memory.close(CONTEXT)
    }
  }, 20_000)
})
