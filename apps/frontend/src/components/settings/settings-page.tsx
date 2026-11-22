import {
  ArrowLeftIcon,
  FileTextIcon,
  PlugIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
  WrenchIcon,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useState } from 'react'

import type { CurrentUser } from '../../lib/chat-api.ts'
import { promptApi, skillApi } from '../../lib/capability-api.ts'
import { McpSection, TextCatalogSection, ToolsSection } from './capability-sections.tsx'
import { ThemePicker } from '../layout/theme-picker.tsx'

type SectionId = 'tools' | 'prompts' | 'skills' | 'mcps' | 'application' | 'user'

interface Section {
  readonly id: SectionId
  readonly label: string
  readonly icon: ComponentType<{ className?: string }>
  readonly title: string
  readonly description: string
}

const SECTIONS: readonly Section[] = [
  {
    id: 'tools',
    label: 'Tools',
    icon: WrenchIcon,
    title: 'Tools',
    description: 'What an agent may call, per workspace and per agent.',
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: SparklesIcon,
    title: 'Skills',
    description: 'Instruction packs an agent can load while it works.',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: FileTextIcon,
    title: 'Prompts',
    description: 'Reusable instruction text a workspace or an agent can be given.',
  },
  {
    id: 'mcps',
    label: 'MCPs',
    icon: PlugIcon,
    title: 'MCP servers',
    description: 'Model Context Protocol servers a workspace makes available.',
  },
  {
    id: 'application',
    label: 'Application settings',
    icon: SettingsIcon,
    title: 'Application settings',
    description: 'How the app itself looks and behaves, for this browser.',
  },
  {
    id: 'user',
    label: 'User admin',
    icon: UsersIcon,
    title: 'User admin',
    description: 'Who the sessions belong to.',
  },
]

function SectionBody({ section, user }: { section: Section; user: CurrentUser | null }) {
  switch (section.id) {
    case 'tools':
      return <ToolsSection />
    case 'prompts':
      return (
        <TextCatalogSection
          api={promptApi}
          noun="prompt"
          hint="Text a workspace or an agent carries. Granting one is what puts it in front of a run; nothing is applied to a conversation yet."
        />
      )
    case 'skills':
      return (
        <TextCatalogSection
          api={skillApi}
          noun="skill"
          hint="An instruction pack with the name and text a run would load. Nothing loads skills yet; the rows are what a grant will point at."
        />
      )
    case 'mcps':
      return <McpSection />
    case 'application':
      return (
        <div className="flex max-w-prose flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-4 rounded-md border p-4">
            <div className="flex flex-col gap-1">
              <span className="font-medium">Theme</span>
              <span className="text-muted-foreground">
                Light, dark or follow the system. Stored in this browser, applied before the first paint.
              </span>
            </div>
            <ThemePicker />
          </div>
        </div>
      )
    case 'user':
      return (
        <div className="flex max-w-prose flex-col gap-3 text-sm">
          <div className="flex flex-col gap-2 rounded-md border p-4">
            <span className="font-medium">{user?.name ?? 'Unknown user'}</span>
            <span className="text-muted-foreground">
              Until sign-in exists there is exactly one local user, seeded by the migration. There is no password, no
              session and no second account to administer.
            </span>
            {user === null ? null : (
              <code className="w-fit rounded-sm bg-muted px-2 py-1 font-mono text-xs">{user.id}</code>
            )}
          </div>
        </div>
      )
    default:
      return null
  }
}

/**
 * The settings screen, replacing the whole app rather than the chat area: it owns the full width, its sections run down
 * the left, and the way back is a single control at the top. Only Application settings has something to change today; the
 * other sections say what they are waiting for instead of pretending to be controls.
 */
export function SettingsPage({ user, onClose }: { user: CurrentUser | null; onClose: () => void }) {
  const [active, setActive] = useState<SectionId>('application')
  const section = SECTIONS.find((candidate) => candidate.id === active) ?? SECTIONS[0]

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <nav
        aria-label="Settings sections"
        className="flex w-64 shrink-0 flex-col gap-1 border-r bg-sidebar p-2 text-sidebar-foreground"
      >
        <button
          type="button"
          onClick={onClose}
          className="mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Back to conversations
        </button>
        {SECTIONS.map((candidate) => {
          const Icon = candidate.icon

          return (
            <button
              key={candidate.id}
              type="button"
              aria-current={candidate.id === active ? 'page' : undefined}
              onClick={() => setActive(candidate.id)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                candidate.id === active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''
              }`}
            >
              <Icon className="size-4" />
              {candidate.label}
            </button>
          )
        })}
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto" aria-label={section?.title}>
        <div className="flex flex-col gap-4 p-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{section?.title}</h1>
            <p className="text-sm text-muted-foreground">{section?.description}</p>
          </header>

          {section === undefined ? null : <SectionBody section={section} user={user} />}
        </div>
      </main>
    </div>
  )
}
