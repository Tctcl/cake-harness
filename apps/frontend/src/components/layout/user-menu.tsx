import { BoxesIcon, ChevronsUpDownIcon, LogOutIcon, SettingsIcon } from 'lucide-react'

import type { CurrentUser } from '../../lib/chat-api.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx'

/** Initials stand in for a picture: there is no upload and no avatar column, and a letter mark reads as a person. */
const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

/**
 * Who the sessions belong to, at the foot of the left sidebar. The menu holds the way into settings, the way into the
 * workspace manager and signing out. A single-user install has no session to end, so the item is shown disabled with
 * the reason rather than hidden.
 */
export function UserMenu({
  user,
  loading,
  onOpenSettings,
  onOpenWorkspaces,
  onSignOut,
}: {
  user: CurrentUser | null
  loading: boolean
  onOpenSettings: () => void
  onOpenWorkspaces: () => void
  /** Absent in single-user mode, where there is nobody to sign out. */
  onSignOut?: (() => void) | undefined
}) {
  const name = user?.name ?? (loading ? 'Loading…' : 'Unknown user')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Account"
        >
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[0.7rem] font-medium text-muted-foreground"
          >
            {user === null ? '·' : initialsOf(name)}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenWorkspaces}>
          <BoxesIcon />
          Workspaces
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenSettings}>
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
        {onSignOut === undefined ? (
          <DropdownMenuItem disabled>
            <LogOutIcon />
            <span className="flex min-w-0 flex-col">
              <span>Sign out</span>
              <span className="text-xs text-muted-foreground">Single-user install</span>
            </span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onSignOut}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
