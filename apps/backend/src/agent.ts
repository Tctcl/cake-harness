import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import {
  CompactionEntry,
  Harness,
  LiveDoc,
  ResetEntry,
  SessionFailed,
  UsageDoc,
  createRegistry,
} from '@earendil-works/pi-durable'
import type {
  Conversation,
  ConversationId,
  Cursor,
  EntryRecord,
  Storage,
  UsageState,
} from '@earendil-works/pi-durable'

import type { Config } from './config.js'
import { AppError } from './errors.js'
import type { ContextUsage } from './context-usage.js'
import { measureContext } from './context-usage.js'
import { clipped, liveActivity } from './live-activity.js'
import type { LiveActivity } from './live-activity.js'
import { AgentRepository } from './agents/agent-repository.js'
import type { AgentInput, AgentPatch, AgentProfile } from './agents/agent-repository.js'
import { createCapabilityApi } from './capabilities/api.js'
import type { CapabilityApi } from './capabilities/api.js'
import { createCredentialApi } from './credentials/api.js'
import type { CredentialApi } from './credentials/api.js'
import { CredentialRepository } from './credentials/credential-repository.js'
import { createEnvironmentApi } from './environments/api.js'
import type { EnvironmentApi } from './environments/api.js'
import { noSecrets, createCipherGateSecrets } from './secrets/ciphergate.js'
import { DockerContainers } from './environments/container-runtime.js'
import { EnvironmentRepository } from './environments/environment-repository.js'
import { CapabilityLinks } from './capabilities/capability-links.js'
import { WorkspaceMcpServerRepository } from './capabilities/mcp-repository.js'
import { PromptRepository, SkillRepository } from './capabilities/text-repository.js'
import { createProviderApi } from './providers/api.js'
import type { ProviderApi } from './providers/api.js'
import { checkKey, fetchModels } from './providers/provider-client.js'
import { ProviderRepository } from './providers/provider-repository.js'
import { registerKeyProvider, storedCredentials } from './providers/stored-credentials.js'
import { PROVIDER, resolveRunSettings, validateRunSettings } from './agents/run-settings.js'
import type { KeyCatalog, RunSettings, WorkspaceReach } from './agents/run-settings.js'
import { AuthService } from './auth/service.js'
import { ToolRepository } from './capabilities/tool-repository.js'
import { idFromNumber } from './storage/postgres/ids.js'
import { openPostgresStorage } from './storage/postgres/index.js'
import { retryingStorage } from './storage/postgres/resilient.js'
import { sharedStorage } from './storage/postgres/shared.js'
import { isConnectFailure, withRetryUntil } from './storage/postgres/retry.js'
import { ensureLocalUser } from './threads/local-user.js'
import { createUpdateChecker } from './updates/checker.js'
import type { UpdateStatus } from './updates/checker.js'
import { createGithubReleases } from './updates/releases.js'
import type { ChatThread, ThreadTarget } from './threads/thread-repository.js'
import { ThreadRepository } from './threads/thread-repository.js'
import { WorkspaceRepository } from './workspaces/workspace-repository.js'
import type { Workspace, WorkspaceInput, WorkspacePatch } from './workspaces/workspace-repository.js'

// One background context for the whole process: it never cancels and carries no telemetry.
const CONTEXT = BACKGROUND_CONTEXT


/**
 * How long a request waits for Postgres before answering 503. Reopening needs a connection, not a healthy Session, so
 * a restart within this window is invisible to the caller; past it the request fails and the next one tries again.
 */
const REOPEN_WINDOW_MS = 10_000
const REOPEN_RETRY = { baseDelayMs: 100, maxDelayMs: 1000 }

/** How many entries a stream's window holds, as the minimum; it doubles that before dropping its oldest. */
const STREAM_WINDOW = 40

/** One part of a chat line, in the same order as the model produced or received it. */
export type ChatBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly text: string; readonly redacted: boolean }
  | {
      readonly type: 'toolCall'
      readonly callId: string
      readonly name: string
      readonly arguments: string
    }

/** One line of the transcript a chat pane renders, including context bookkeeping that must stay visible. */
export interface ChatMessage {
  /** Entry id, stable within the conversation and the handle a client keys and merges on. */
  readonly id: number
  readonly role: 'user' | 'assistant' | 'compaction' | 'reset'
  /** Concatenated text blocks, kept for callers that only render plain text. */
  readonly text: string
  readonly blocks: ChatBlock[]
  readonly stopReason: string | null
  readonly errorMessage: string | null
  /** Why context was compacted; null for every other line kind. */
  readonly reason: string | null
}

/**
 * One tool call, joined from the assistant's call and the result entry that answers it: the call is keyed by the
 * provider's tool call id, so a call the model made but nothing answered stays `running` rather than disappearing.
 */
export interface ToolCallView {
  readonly id: string
  /** The assistant entry that made the call, or the result entry when no call entry is in the window. */
  readonly entryId: number
  readonly name: string
  /** The call's arguments as JSON text, or null when only the result was logged. */
  readonly arguments: string | null
  readonly status: 'running' | 'ok' | 'error'
  /** The result's text, or null while it is still running. */
  readonly result: string | null
  readonly durationMs: number | null
}

/** The model the newest answer ran with, so a client names the run instead of repeating a constant. */
export interface RunInfo {
  readonly model: string
  readonly provider: string
  readonly thinkingLevel: string | null
}

/** Spend of the conversation so far, summed from its usage ledger. */
export interface UsageTotals {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly total: number
  readonly cost: number
}

/** One frame of a thread's stream: the window, its tool traffic, and the sums that describe the run. */
export interface ThreadUpdate {
  readonly messages: ChatMessage[]
  readonly tools: ToolCallView[]
  readonly run: RunInfo | null
  readonly usage: UsageTotals
  readonly live: LiveActivity
}

/** Which slice of the transcript to read. The cursor is the opaque `nextCursor` of the page before it. */
export interface MessageQuery {
  readonly limit: number
  readonly cursor?: string | undefined
}

/** One page of transcript, oldest line first. An absent cursor means the page reaches the start of the conversation. */
export interface MessagePage {
  readonly messages: ChatMessage[]
  readonly nextCursor: string | null
}

/** Detaches a live stream observer. Safe to call once; resolves after the watch has stopped. */
export type StopWatch = () => Promise<void>

/** What a new thread needs to be filed under. Both ids are optional: the default workspace and its default agent stand
 * in when a caller names neither. */
export interface CreateThreadInput {
  readonly title: string | null
  readonly workspaceId?: string | undefined
  readonly agentId?: string | undefined
}

/** A listing is the live rows unless the caller asks for the archived ones. */
export interface ArchiveQuery {
  readonly archived?: boolean | undefined
}

export interface ThreadQuery extends ArchiveQuery {
  readonly workspaceId?: string | undefined
}

export interface Agent {
  /** Sessions, permissions and the settings that decide whether there are accounts at all. */
  readonly auth: AuthService
  /** Every workspace of the local user, in the order the user arranges them. */
  workspaces(query?: ArchiveQuery): Promise<Workspace[]>
  /** One workspace, or `undefined` when the id is unknown. */
  workspace(id: string): Promise<Workspace | undefined>
  createWorkspace(input: WorkspaceInput): Promise<Workspace>
  /** Rewrite the list order, top first: the ids must be exactly the live workspaces. */
  reorderWorkspaces(ids: readonly string[]): Promise<Workspace[]>
  updateWorkspace(id: string, patch: WorkspacePatch): Promise<Workspace | undefined>
  archiveWorkspace(id: string): Promise<Workspace | undefined>
  restoreWorkspace(id: string): Promise<Workspace | undefined>
  deleteWorkspace(id: string): Promise<boolean>
  /** The agents of one workspace, by name. */
  agents(workspaceId: string, query?: ArchiveQuery): Promise<AgentProfile[]>
  createAgent(workspaceId: string, input: AgentInput): Promise<AgentProfile>
  updateAgent(id: string, patch: AgentPatch): Promise<AgentProfile | undefined>
  archiveAgent(id: string): Promise<AgentProfile | undefined>
  restoreAgent(id: string): Promise<AgentProfile | undefined>
  deleteAgent(id: string): Promise<boolean>
  /** The catalog of tools, prompts, skills and MCP servers, and who may reach which of them. */
  capabilities: CapabilityApi
  /** The containers a workspace can run in, and which of them an agent works in. */
  environments: EnvironmentApi
  /** The keys this user owns: provider accounts and MCP credentials, listed without their secrets. */
  credentials: CredentialApi
  /** The provider keys this user stored, the models they reach, and what each workspace may spend. */
  providers: ProviderApi
  /** What this install runs and whether a newer release exists, as of the last check. */
  updateStatus(): UpdateStatus
  /** Ask now rather than waiting for the interval. */
  checkForUpdates(): Promise<UpdateStatus>
  /** Threads of the local user, most recently changed first, narrowed to one workspace when one is named. */
  threads(query?: ThreadQuery): Promise<ChatThread[]>
  /** Create a thread together with the durable conversation that carries it. */
  createThread(input: CreateThreadInput): Promise<ChatThread>
  archiveThread(id: string): Promise<ChatThread | undefined>
  restoreThread(id: string): Promise<ChatThread | undefined>
  /** One page of the thread's transcript, newest page first when no cursor is given. */
  messages(threadId: string, query: MessageQuery): Promise<MessagePage>
  /** What the thread's next request would carry, split by where its tokens go. */
  contextUsage(threadId: string): Promise<ContextUsage>
  /** Set a thread's title, or answer `undefined` when the id is unknown. */
  renameThread(id: string, title: string | null): Promise<ChatThread | undefined>
  /** Admit one input and return at once: the answer arrives through `watch`. */
  submit(threadId: string, input: string): Promise<string>
  /** Follow the thread until the returned function is called; `onChange` gets the whole current window. */
  watch(threadId: string, onChange: (update: ThreadUpdate) => void): Promise<StopWatch>
  close(): Promise<void>
}

type EntryMessage = NonNullable<EntryRecord['model']>[number]

const messageText = (message: EntryMessage): string => {
  const content = message.content
  if (typeof content === 'string') return content

  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

const chatBlocks = (message: EntryMessage): ChatBlock[] => {
  if (typeof message.content === 'string') return [{ type: 'text', text: message.content }]

  return message.content.flatMap((block): ChatBlock[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }]
    if (block.type === 'thinking') {
      return [{ type: 'thinking', text: block.thinking, redacted: block.redacted ?? false }]
    }
    if (block.type === 'toolCall') {
      return [
        {
          type: 'toolCall',
          callId: block.id,
          name: block.name,
          arguments: JSON.stringify(block.arguments),
        },
      ]
    }

    return []
  })
}

const compactionReason = (entry: EntryRecord): string | null => {
  const data: unknown = entry.data
  if (typeof data !== 'object' || data === null || Array.isArray(data) || !('reason' in data)) return null

  return typeof data.reason === 'string' ? data.reason : null
}

const textLine = (entry: EntryRecord, role: 'compaction' | 'reset'): ChatMessage => {
  const message = entry.model?.[0]
  const text = message?.role === 'user' ? messageText(message) : ''
  const blocks = message?.role === 'user' ? chatBlocks(message) : []

  return {
    id: entry.id,
    role,
    text,
    blocks,
    stopReason: null,
    errorMessage: null,
    reason: role === 'compaction' ? compactionReason(entry) : null,
  }
}

/** The transcript as chat lines, with compaction and reset entries kept distinct from user input. */
export const chatMessages = (entries: readonly EntryRecord[]): ChatMessage[] =>
  entries.flatMap((entry): ChatMessage[] => {
    if (entry.kind === CompactionEntry.kind) return [textLine(entry, 'compaction')]
    if (entry.kind === ResetEntry.kind) return [textLine(entry, 'reset')]

    const message = entry.model?.[0]
    if (message?.role !== 'user' && message?.role !== 'assistant') return []

    const text = messageText(message)
    const blocks = chatBlocks(message)
    if (message.role === 'user') {
      return text === ''
        ? []
        : [
            {
              id: entry.id,
              role: 'user',
              text,
              blocks,
              stopReason: null,
              errorMessage: null,
              reason: null,
            },
          ]
    }

    const stopReason = message.stopReason
    const errorMessage = message.errorMessage ?? null
    if (blocks.length === 0 && stopReason !== 'error' && errorMessage === null) return []

    return [
      {
        id: entry.id,
        role: 'assistant',
        text,
        blocks,
        stopReason,
        errorMessage,
        reason: null,
      },
    ]
  })

/**
 * Tool traffic in order of appearance. An assistant entry carries the calls and a tool result entry answers one by its
 * provider call id, so walking the window in order always sees a call before the result that settles it.
 */
export const toolCalls = (entries: readonly EntryRecord[]): ToolCallView[] => {
  const calls = new Map<string, ToolCallView>()

  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      if (message.role === 'assistant') {
        for (const block of message.content) {
          if (block.type !== 'toolCall' || calls.has(block.id)) continue

          calls.set(block.id, {
            id: block.id,
            entryId: entry.id,
            name: block.name,
            arguments: clipped(JSON.stringify(block.arguments)),
            status: 'running',
            result: null,
            durationMs: null,
          })
        }
      }

      if (message.role !== 'toolResult') continue

      const settled: Pick<ToolCallView, 'status' | 'result' | 'durationMs'> = {
        status: message.isError ? 'error' : 'ok',
        result: clipped(messageText(message)),
        durationMs: message.durationMs ?? null,
      }
      const call = calls.get(message.toolCallId)
      calls.set(
        message.toolCallId,
        call === undefined
          ? {
              id: message.toolCallId,
              entryId: entry.id,
              name: message.toolName,
              arguments: null,
              ...settled,
            }
          : { ...call, ...settled },
      )
    }
  }

  return [...calls.values()]
}

/** The model the newest answer ran with; absent until the agent has answered once. */
const runInfoOf = (entries: readonly EntryRecord[]): RunInfo | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index]?.model?.find((candidate) => candidate.role === 'assistant')
    if (message?.role !== 'assistant') continue

    return {
      model: message.model,
      provider: message.provider,
      thinkingLevel: message.thinkingLevel ?? null,
    }
  }

  return null
}

/** Model spend only: a tool's own usage is not context accounting, and the ledger keeps the two apart. */
const usageTotals = (state: Readonly<UsageState> | undefined): UsageTotals => {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 }

  for (const bucket of Object.values(state?.models ?? {})) {
    totals.input += bucket.input
    totals.output += bucket.output
    totals.cacheRead += bucket.cacheRead
    totals.cacheWrite += bucket.cacheWrite
    totals.total += bucket.totalTokens
    totals.cost += bucket.cost.total
  }

  return totals
}

/**
 * A durable cursor is JSON the caller only round-trips, so it travels as base64url text in a query string rather than as
 * a second shape this module would have to own.
 */
const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')

const decodeCursor = (value: string): Cursor => {
  const invalid = (): AppError =>
    new AppError('the cursor is not valid', { statusCode: 400, code: 'CURSOR_INVALID' })

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw invalid()
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalid()

  return parsed as Cursor
}

/**
 * Pages of transcript entries, newest first, folded until the page has at least one chat line. Durable pages over every
 * entry, so a slice can hold only bookkeeping; walking on keeps an empty page from being a dead end for the pane.
 */
const MESSAGE_PAGE_ROUNDS = 5

const readMessages = async (
  conversation: Conversation,
  query: MessageQuery,
): Promise<MessagePage> => {
  let messages: ChatMessage[] = []
  let cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
  let next: Cursor | undefined

  for (let round = 0; round < MESSAGE_PAGE_ROUNDS; round += 1) {
    const page = await conversation.entries({ order: 'descending' }, query.limit, cursor, CONTEXT)
    messages = [...chatMessages(page.items).reverse(), ...messages]
    next = page.next

    if (next === undefined || page.items.length === 0 || messages.length > 0) break
    cursor = next
  }

  return { messages, nextCursor: next === undefined ? null : encodeCursor(next) }
}

const unavailable = (error: unknown): AppError =>
  new AppError('the agent is unavailable', {
    statusCode: 503,
    code: 'AGENT_UNAVAILABLE',
    cause: error,
  })

const threadNotFound = (): AppError =>
  new AppError('the thread does not exist', { statusCode: 404, code: 'THREAD_NOT_FOUND' })

/**
 * Owns the harness and reopens it when its Session fails. Durable is explicit that this is the recovery: a `SessionFailed`
 * says "Reopen the Session; reopening recovers from what was committed", and nothing above storage retries.
 *
 * One harness serves every thread. A harness is a Session over the whole log, not one conversation, so per-thread
 * conversations are looked up by id from the same instance.
 */
class Supervisor {
  #harness: Harness | undefined
  #opening: Promise<Harness> | undefined
  readonly #open: () => Promise<Harness>

  constructor(open: () => Promise<Harness>) {
    this.#open = open
  }

  /** The live harness, reopening first when the previous one was discarded. */
  async harness(): Promise<Harness> {
    const harness = this.#harness
    if (harness !== undefined) return harness

    return this.#reopen()
  }

  /** Drop a failed harness: what it committed stays, and the next request resumes from there. */
  discard(): void {
    const harness = this.#harness
    if (harness === undefined) return
    this.#harness = undefined

    harness.close(CONTEXT).catch(() => {
      // The Session already failed; closing it is cleanup, and its error would only hide the cause.
    })
  }

  async close(): Promise<void> {
    const harness = this.#harness
    this.#harness = undefined
    await harness?.close(CONTEXT)
  }

  // Single-flight: concurrent requests during an outage wait on one reopen instead of racing to build harnesses.
  async #reopen(): Promise<Harness> {
    this.#opening ??= withRetryUntil(REOPEN_WINDOW_MS, REOPEN_RETRY, isConnectFailure, async () => {
      const harness = await this.#open()
      this.#harness = harness

      return harness
    }).finally(() => {
      this.#opening = undefined
    })

    return this.#opening
  }
}

/** The conversation a thread points at, or a 404 when the log no longer has it. */
const conversationOf = async (
  supervisor: Supervisor,
  id: ConversationId,
): Promise<Conversation> => {
  const harness = await supervisor.harness()
  const conversation = await harness.conversation(id, CONTEXT)
  if (conversation === undefined) throw threadNotFound()

  return conversation
}

/** The conversation a thread id names, resolving the row first so a 404 never depends on the log. */
const conversationFor = async (
  supervisor: Supervisor,
  threads: ThreadRepository,
  threadId: string,
): Promise<Conversation> => {
  const thread = await threads.find(threadId)
  if (thread === undefined) throw threadNotFound()

  return conversationOf(supervisor, idFromNumber(thread.durableConversationId))
}

/**
 * Which workspace and agent a new thread is filed under. Naming neither lands in the default pair; naming a workspace
 * without an agent uses that workspace's default agent, because a user-created workspace has no agents until one is
 * made and a thread without a profile has nothing to run.
 */
const resolveThreadTarget = async (
  workspaces: WorkspaceRepository,
  agents: AgentRepository,
  ownerId: string,
  input: CreateThreadInput,
): Promise<{ target: ThreadTarget; agent: AgentProfile }> => {
  const workspace =
    input.workspaceId === undefined
      ? await workspaces.default(ownerId)
      : await workspaces.find(input.workspaceId)
  if (workspace === undefined) {
    throw new AppError('the workspace does not exist', {
      statusCode: 404,
      code: 'WORKSPACE_NOT_FOUND',
    })
  }
  // Archiving is what hides a workspace; filing new work in it would put the thread out of sight with the workspace.
  if (workspace.archivedAt !== null) {
    throw new AppError('the workspace is archived', { statusCode: 409, code: 'WORKSPACE_ARCHIVED' })
  }

  if (input.agentId === undefined) {
    const fallback = await agents.default(workspace.id)
    if (fallback === undefined) {
      throw new AppError('the workspace has no default agent', {
        statusCode: 400,
        code: 'AGENT_REQUIRED',
      })
    }

    return { target: { workspaceId: workspace.id, agentId: fallback.id }, agent: fallback }
  }

  const agent = await agents.find(input.agentId)
  if (agent === undefined) {
    throw new AppError('the agent does not exist', { statusCode: 404, code: 'AGENT_NOT_FOUND' })
  }
  if (agent.workspaceId !== workspace.id) {
    throw new AppError('the agent belongs to another workspace', {
      statusCode: 400,
      code: 'AGENT_WORKSPACE_MISMATCH',
    })
  }
  if (agent.archivedAt !== null) {
    throw new AppError('the agent is archived', { statusCode: 409, code: 'AGENT_ARCHIVED' })
  }

  return { target: { workspaceId: workspace.id, agentId: agent.id }, agent }
}

/**
 * An agent's prompt and instructions as the durable agent config's `instructions`, which renders as a reserved section
 * of the system prompt. It is applied when the conversation is created, so editing an agent later does not rewrite
 * conversations that already exist; only tools, MCP servers and skills stay declarative for now, unread by the harness.
 */
const instructionsOf = (agent: AgentProfile): string | undefined => {
  const sections = [agent.systemPrompt.trim(), agent.instructions.trim()].filter((part) => part !== '')

  return sections.length === 0 ? undefined : sections.join('\n\n')
}

/**
 * Postgres holds both the durable log and the platform tables, so there is no in-process storage to fall back to: a
 * missing or unreachable database is a startup failure, not a degraded mode.
 */
export async function createAgent(config: Config): Promise<Agent> {
  // Waiting at boot too: a database that is restarting deserves the same window as one that went away later.
  const postgres = await withRetryUntil(REOPEN_WINDOW_MS, REOPEN_RETRY, isConnectFailure, () =>
    openPostgresStorage(config.databaseUrl, { max: config.databasePoolSize }),
  )

  // The thread rows share the storage's pool: one connection ceiling, and they sit beside the log they point into.
  const threads = new ThreadRepository(postgres.pool, postgres.schema)
  const workspaces = new WorkspaceRepository(postgres.pool, postgres.schema)
  const agents = new AgentRepository(postgres.pool, postgres.schema)
  const tools = new ToolRepository(postgres.pool, postgres.schema)
  const prompts = new PromptRepository(postgres.pool, postgres.schema)
  const skills = new SkillRepository(postgres.pool, postgres.schema)
  const servers = new WorkspaceMcpServerRepository(postgres.pool, postgres.schema)
  const links = new CapabilityLinks(postgres.pool, postgres.schema)
  const ownerId = await ensureLocalUser(postgres.pool, postgres.schema)
  // Provider keys are credentials of one kind, so they live in the same table and are read through their own api.
  const providerRepository = new ProviderRepository(postgres.pool, postgres.schema, config.secrets)
  const chatModels = new Set(opencodeGoProvider().getModels().map((model) => model.id))
  const providers = createProviderApi({
    ownerId,
    providers: providerRepository,
    runnable: (modelId) => chatModels.has(modelId),
  })
  // Chats authenticate with the keys stored on the credentials page, each registered as its own provider so an agent's
  // model reference names the key that pays for it. The bare provider serves conversations from before per-agent keys.
  const models = createModels({ credentials: storedCredentials(providerRepository, ownerId) })
  models.setProvider(opencodeGoProvider())
  for (const login of await providerRepository.logins(ownerId)) registerKeyProvider(models, login.id)
  // The user's own keys, apart from the MCP credentials a server definition carries: a key outlives the server it serves.
  // A provider key is checked upstream before it is stored, and its models are loaded from it.
  const userCredentials = createCredentialApi({
    ownerId,
    credentials: new CredentialRepository(postgres.pool, postgres.schema, config.secrets),
    providerKeys: {
      check: checkKey,
      stored: async (credentialId, key) => {
        registerKeyProvider(models, credentialId)
        const upstream = await fetchModels(key)
        if (upstream !== undefined) await providerRepository.replaceModels(PROVIDER, upstream)
      },
    },
  })

  /** The settings a run of `profile` uses right now, registering its key's provider on the way. */
  const runSettingsOf = async (profile: AgentProfile): Promise<RunSettings> => {
    const [reach, keys] = await Promise.all([reachOf(profile.workspaceId), keyCatalog()])
    const settings = resolveRunSettings(profile, reach, keys)
    registerKeyProvider(models, settings.credentialId)

    return settings
  }

  const reachOf = async (workspaceId: string): Promise<WorkspaceReach> => {
    const [workspace, linked] = await Promise.all([
      workspaces.find(workspaceId),
      providerRepository.workspaceProviders(ownerId, workspaceId),
    ])
    if (workspace === undefined || linked === undefined) {
      throw new AppError('the workspace does not exist', { statusCode: 404, code: 'WORKSPACE_NOT_FOUND' })
    }

    return { allowAll: workspace.allowAll, ...linked }
  }

  const keyCatalog = async (): Promise<KeyCatalog> => ({
    loginIds: (await providerRepository.logins(ownerId)).map((login) => login.id),
    modelIds: chatModels,
  })
  // Every workspace except the default one runs in a container. The image is configuration, so the row is written here
  // rather than by a migration; on an install that already satisfies the rule this writes nothing.
  await workspaces.ensureEnvironments(ownerId, config.workspaceImage)
  await workspaces.ensureDefaultAgents(ownerId)
  const auth = new AuthService({ pool: postgres.pool, schema: postgres.schema, secrets: config.secrets })

  // Harnesses come and go as Sessions fail; the storage outlives them and only the process closes it.
  const storage: Storage = sharedStorage(retryingStorage(postgres))

  // One registry for the process, so the tool catalog can be synced from what a session is actually offered.
  const registry = createRegistry()

  const supervisor = new Supervisor(() =>
    Harness.open(storage, { models, registry }, CONTEXT),
  )

  const environments = createEnvironmentApi({
    ownerId,
    environments: new EnvironmentRepository(postgres.pool, postgres.schema),
    // The runtime is the only thing that talks to Docker; the routes decide nothing about it.
    containers: new DockerContainers(config.docker),
    image: config.workspaceImage,
    backendUrl: config.workspaceBackendUrl,
    network: config.workspaceNetwork,
    // No configured store is a reader that knows nothing: the manifest still serves tooling, and no credential.
    secrets: config.ciphergate === undefined ? noSecrets : createCipherGateSecrets(config.ciphergate),
  })

  const updates = createUpdateChecker({
    channel: config.channel,
    version: config.version,
    releases: createGithubReleases(),
    intervalMs: config.updateCheckIntervalMs,
  })
  updates.start()

  const capabilities = createCapabilityApi({
    ownerId,
    tools,
    prompts,
    skills,
    servers,
    links,
    readWorkspace: async (id) => {
      const workspace = await workspaces.find(id)

      return workspace === undefined
        ? undefined
        : { allowAll: workspace.allowAll, archivedAt: workspace.archivedAt }
    },
    readAgent: async (id) => {
      const agent = await agents.find(id)

      return agent === undefined
        ? undefined
        : { workspaceId: agent.workspaceId, archivedAt: agent.archivedAt }
    },
    offeredTools: () =>
      registry.snapshot().tools().map(({ tool }) => ({
        name: tool.name,
        parameters: tool.parameters,
        ...(tool.description === undefined ? {} : { description: tool.description }),
      })),
  })

  return {
    auth,
    capabilities,
    environments,
    credentials: userCredentials,
    providers,

    updateStatus() {
      return updates.status()
    },

    checkForUpdates() {
      return updates.check()
    },

    workspaces(query) {
      return workspaces.list(ownerId, { archived: query?.archived })
    },

    workspace(id) {
      return workspaces.find(id)
    },

    createWorkspace(input) {
      // The environment is created with the workspace, from the platform image: the two are one state transition.
      return workspaces.create(ownerId, input, config.workspaceImage)
    },

    reorderWorkspaces(ids) {
      return workspaces.reorder(ownerId, ids)
    },

    updateWorkspace(id, patch) {
      return workspaces.update(id, patch)
    },

    archiveWorkspace(id) {
      return workspaces.archive(id)
    },

    restoreWorkspace(id) {
      return workspaces.restore(id)
    },

    deleteWorkspace(id) {
      return workspaces.remove(id)
    },

    agents(workspaceId, query) {
      return agents.list(workspaceId, { archived: query?.archived })
    },

    async createAgent(workspaceId, input) {
      validateRunSettings(input, await reachOf(workspaceId), await keyCatalog())

      return agents.create(workspaceId, input)
    },

    async updateAgent(id, patch) {
      const existing = await agents.find(id)
      if (existing === undefined) return undefined
      validateRunSettings(patch, await reachOf(existing.workspaceId), await keyCatalog())

      return agents.update(id, patch)
    },

    archiveAgent(id) {
      return agents.archive(id)
    },

    restoreAgent(id) {
      return agents.restore(id)
    },

    deleteAgent(id) {
      return agents.remove(id)
    },

    threads(query) {
      return threads.list(ownerId, { workspaceId: query?.workspaceId, archived: query?.archived })
    },

    archiveThread(id) {
      return threads.archive(id)
    },

    restoreThread(id) {
      return threads.restore(id)
    },

    renameThread(id, title) {
      return threads.rename(id, title)
    },

    async createThread(input) {
      try {
        const { target, agent: profile } = await resolveThreadTarget(
          workspaces,
          agents,
          ownerId,
          input,
        )
        const instructions = instructionsOf(profile)
        // Resolved before anything is created: a conversation that could never run is refused with what to fix.
        const settings = await runSettingsOf(profile)
        const harness = await supervisor.harness()
        // Ownerless: a thread is a top-level transcript, not work a parent task owns. Forks get a task owner instead.
        const conversation = await harness.createConversation(
          {
            ownership: { kind: 'ownerless' },
            agent: {
              model: settings.model,
              thinkingLevel: settings.thinkingLevel,
              ...(instructions === undefined ? {} : { instructions }),
            },
          },
          CONTEXT,
        )

        return await threads.create(ownerId, conversation.id, target, input.title)
      } catch (error) {
        if (error instanceof SessionFailed) supervisor.discard()

        throw error instanceof AppError ? error : unavailable(error)
      }
    },

    async messages(threadId, query) {
      try {
        const conversation = await conversationFor(supervisor, threads, threadId)

        return await readMessages(conversation, query)
      } catch (error) {
        if (error instanceof SessionFailed) supervisor.discard()

        throw error instanceof AppError ? error : unavailable(error)
      }
    },

    async contextUsage(threadId) {
      try {
        const conversation = await conversationFor(supervisor, threads, threadId)
        // One read of the active range: the harness resolves head markers, edits and compaction for us.
        const view = await conversation.context(CONTEXT)
        const run = runInfoOf(view.entries)
        // A model that left the catalog still has a window worth reporting; without one, the share is unknown.
        const contextWindow = run === null ? null : (models.getModel(run.provider, run.model)?.contextWindow ?? null)

        return measureContext(
          view,
          run === null ? null : { provider: run.provider, modelId: run.model },
          contextWindow,
        )
      } catch (error) {
        if (error instanceof SessionFailed) supervisor.discard()

        throw error instanceof AppError ? error : unavailable(error)
      }
    },

    async submit(threadId, input) {
      const thread = await threads.find(threadId)
      if (thread === undefined) throw threadNotFound()
      // An archived thread is kept for reading; its conversation is not offered to the model again.
      if (thread.archivedAt !== null) {
        throw new AppError('the thread is archived', { statusCode: 409, code: 'THREAD_ARCHIVED' })
      }

      const profile = await agents.find(thread.agentId)
      if (profile === undefined) throw new AppError('the agent does not exist', { statusCode: 404, code: 'AGENT_NOT_FOUND' })
      // Outside the try: a missing key is the user's to fix, so it answers 409 with the fix rather than 503.
      const settings = await runSettingsOf(profile)

      try {
        const conversation = await conversationOf(
          supervisor,
          idFromNumber(thread.durableConversationId),
        )
        // The agent's current settings, every turn: editing the agent (its key, model, thinking or prompts) applies to
        // the conversations it already has, from their next message on.
        await conversation.configure(
          {
            model: settings.model,
            thinkingLevel: settings.thinkingLevel,
            instructions: instructionsOf(profile) ?? null,
          },
          CONTEXT,
        )
        const submission = await conversation.submit({ type: 'input', content: input }, CONTEXT)

        return String(submission.id)
      } catch (error) {
        if (error instanceof SessionFailed) supervisor.discard()

        throw error instanceof AppError ? error : unavailable(error)
      }
    },

    async watch(threadId, onChange) {
      try {
        const conversation = await conversationFor(supervisor, threads, threadId)
        const harness = await supervisor.harness()
        // The window holds the newest entries and takes appends, so a long thread streams its tail rather than its head.
        const watch = await conversation.watch(CONTEXT, {
          min: STREAM_WINDOW,
          max: STREAM_WINDOW * 2,
        })

        // Read per emission: the model and the ledger change with every answer, and both are what the panel shows.
        const emit = async (entries: readonly EntryRecord[]): Promise<void> => {
          const [usage, live] = await Promise.all([
            harness.snapshot(UsageDoc, conversation.id, CONTEXT),
            harness.snapshot(LiveDoc, conversation.id, CONTEXT),
          ])

          onChange({
            messages: chatMessages(entries),
            tools: toolCalls(entries),
            run: runInfoOf(entries),
            usage: usageTotals(usage),
            live: liveActivity(live),
          })
        }

        await emit(watch.value.entries)
        watch.start(async (call) => {
          if (call.kind === 'value') await emit(call.value.entries)
        })

        return () =>
          watch.stop().then(
            () => undefined,
            () => undefined,
          )
      } catch (error) {
        if (error instanceof SessionFailed) supervisor.discard()

        throw error instanceof AppError ? error : unavailable(error)
      }
    },

    async close() {
      updates.stop()
      await supervisor.close()
      await postgres.close(CONTEXT)
    },
  }
}
