import { FingerprintIcon, KeyRoundIcon, SettingsIcon, UserIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import { useState } from 'react'

import { ThemePicker } from '../layout/theme-picker.tsx'
import { AccountSection } from './account-section.tsx'
import { CredentialsPage } from './credentials-page.tsx'
import { SshKeysPage } from './ssh-keys-page.tsx'
import { ApplicationSettings } from './application-settings.tsx'

export type SectionId = 'application' | 'credentials' | 'ssh-keys' | 'user'

interface Section {
  readonly id: SectionId
  readonly label: string
  readonly icon: ComponentType<{ className?: string }>
  readonly title: string
  readonly description: string
}

const SECTIONS: readonly Section[] = [
  {
    id: 'application',
    label: 'Application settings',
    icon: SettingsIcon,
    title: 'Application settings',
    description: 'How Cake looks in this browser, and the system prompt every agent starts from.',
  },
  {
    id: 'credentials',
    label: 'Credentials',
    icon: KeyRoundIcon,
    title: 'Credentials',
    description:
      'Your OpenCode Go keys and MCP keys. A key added here is checked, then linked to a workspace on its Providers tab.',
  },
  {
    id: 'ssh-keys',
    label: 'SSH keys',
    icon: FingerprintIcon,
    title: 'SSH keys',
    description: 'Public keys authorize SSH access to your workspace containers.',
  },
  {
    id: 'user',
    label: 'Account',
    icon: UserIcon,
    title: 'Account',
    description: 'Who you are signed in as, your password and your second factor.',
  },
]

function SectionBody({ section }: { section: Section }) {
  switch (section.id) {
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
          <ApplicationSettings />
        </div>
      )
    case 'credentials':
      return <CredentialsPage />
    case 'ssh-keys':
      return <SshKeysPage />
    case 'user':
      return <AccountSection />
    default:
      return null
  }
}

/**
 * The settings window's two columns: its sections run down the left, the chosen one fills the right. The window's own
 * chrome — its title and the way out — belongs to the overlay around it.
 *
 * What belongs to a workspace — its MCP servers, skills, environment and providers — is not here. It
 * lives behind the workspace manager, because it means nothing outside the workspace it belongs to.
 */
export function SettingsPage({
  initialSection = 'application',
}: {
  /** The section to open on, so another screen can send the user straight to their keys. */
  initialSection?: SectionId
}) {
  const [active, setActive] = useState<SectionId>(initialSection)
  const section = SECTIONS.find((candidate) => candidate.id === active) ?? SECTIONS[0]

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden md:flex-row">
      {/* A row of sections above the content on a phone, a column beside it from `md` up. */}
      <nav
        aria-label="Settings sections"
        className="flex shrink-0 gap-1 overflow-x-auto border-b bg-sidebar p-2 text-sidebar-foreground md:w-64 md:flex-col md:overflow-visible md:border-r md:border-b-0"
      >
        {SECTIONS.map((candidate) => {
          const Icon = candidate.icon

          return (
            <button
              key={candidate.id}
              type="button"
              aria-current={candidate.id === active ? 'page' : undefined}
              onClick={() => setActive(candidate.id)}
              className={`flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
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
        <div className="flex flex-col gap-4 p-4 md:p-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{section?.title}</h1>
            <p className="text-sm text-muted-foreground">{section?.description}</p>
          </header>

          {section === undefined ? null : <SectionBody section={section} />}
        </div>
      </main>
    </div>
  )
}
