import type { InputSubmissionDraft } from '@earendil-works/pi-durable'

import type { CallableSubagent } from '../subagents/subagent-repository.js'

/** The entry kind a user input carrying a reminder is placed as, so the transcript can split the two apart again. */
const TURN_INPUT_KIND = 'cake.turn'

/** A tool this turn offers, reduced to the one line the reminder can afford. */
export interface ReminderTool {
  readonly name: string
  readonly description: string
}

/** A skill the agent is granted. Nothing runs one yet; the reminder only says it exists. */
export interface ReminderSkill {
  readonly name: string
  readonly description: string
}

export interface TurnReminderInput {
  readonly instructions: string
  readonly tools: readonly ReminderTool[]
  /** Live sub agents this agent may call with `delegate`; empty for a sub agent, which cannot delegate. */
  readonly subagents: readonly CallableSubagent[]
  readonly skills: readonly ReminderSkill[]
}

/** How much of a tool's description the reminder keeps before it is an essay rather than a purpose. */
const PURPOSE_LIMIT = 80

/** The first sentence of a tool's registered description, on one line and short enough to read at a glance. */
export const toolPurpose = (description: string): string => {
  const text = description.replace(/\s+/g, ' ').trim()
  const end = text.indexOf('. ')
  const sentence = end === -1 ? text : text.slice(0, end + 1)
  if (sentence.length <= PURPOSE_LIMIT) return sentence

  return `${sentence.slice(0, PURPOSE_LIMIT - 1).trimEnd()}…`
}

const heading = 'Cake appends this to every message you answer. The user did not write it.'

const toolLine = (tool: ReminderTool): string => `${tool.name} (${toolPurpose(tool.description)})`

const subagentLine = (subagent: CallableSubagent): string => {
  const purpose = subagent.description.trim() === '' ? '' : `: ${subagent.description.trim()}`

  return `${subagent.name} (${subagent.id})${purpose}\n`
    + `  default model ${subagent.modelId}; allowed models ${subagent.allowedModels.join(', ')}`
}

const skillLine = (skill: ReminderSkill): string =>
  skill.description.trim() === '' ? skill.name : `${skill.name} (${skill.description.trim()})`

/**
 * The reminder that follows every user message: the agent's instructions, then a compact account of what it can use in
 * this turn. It is rebuilt from live rows on each submission rather than baked into the system message, so a sub agent
 * assigned, a tool granted or a skill added between two turns is named from the turn that sees it. Tool schemas still
 * travel as tools; the reminder only names them, which keeps it to a couple of hundred tokens.
 *
 * `undefined` when there is nothing to say, which is the one case where the model gets the plain user message.
 */
export const renderReminder = (input: TurnReminderInput): string | undefined => {
  const instructions = input.instructions.trim()
  const sections: string[] = []

  if (instructions !== '') sections.push(`Instructions\n${instructions}`)
  if (input.tools.length > 0) sections.push(`Tools: ${input.tools.map(toolLine).join(', ')}`)
  if (input.subagents.length > 0) {
    sections.push(
      `Sub agents for delegate (id as subagentId; omit the model unless another is genuinely better):\n`
        + `${input.subagents.map(subagentLine).join('\n')}`,
    )
  }
  if (input.skills.length > 0) sections.push(`Skills: ${input.skills.map(skillLine).join(', ')}`)
  if (sections.length === 0) return undefined

  return [heading, ...sections].join('\n\n')
}

/** A steer joins the run already in flight, so its submission carries the user's words and nothing else. */
export type TurnBusyMode = 'steer' | 'followUp' | 'reject'

/**
 * The submission durable admits for one user turn. The reminder is a second content block of the same user message, so
 * the model reads it after the words it belongs to and the transcript can show it as its own row; the entry's data
 * records the exact text, which is what makes that split unambiguous.
 *
 * A steer is exempt: it is the user interrupting their own run, and the model already has the reminder of the turn it
 * is running.
 */
export const turnSubmission = (
  text: string,
  reminder: string | undefined,
  whenBusy?: TurnBusyMode,
): InputSubmissionDraft => {
  const busy = whenBusy === undefined ? {} : { whenBusy }
  if (reminder === undefined || whenBusy === 'steer') return { type: 'input', content: text, ...busy }

  return {
    type: 'input',
    content: [
      { type: 'text', text },
      { type: 'text', text: reminder },
    ],
    entry: { kind: TURN_INPUT_KIND, data: { reminder } },
    ...busy,
  }
}

/** The reminder recorded with a user input, if it carried one. */
export const reminderOf = (data: unknown): string | undefined => {
  if (typeof data !== 'object' || data === null || Array.isArray(data) || !('reminder' in data)) return undefined

  return typeof data.reminder === 'string' && data.reminder !== '' ? data.reminder : undefined
}
