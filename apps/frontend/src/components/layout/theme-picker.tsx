import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import type { Theme } from '../../lib/theme.ts'
import { currentTheme, setTheme, subscribeToTheme } from '../../lib/theme.ts'
import { Button } from '../ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx'

const OPTIONS = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
] as const

const iconOf = (theme: Theme) =>
  theme === 'light' ? <SunIcon /> : theme === 'dark' ? <MoonIcon /> : <MonitorIcon />

/** Light, dark or the system's; the choice is stored, so it survives a reload. */
export function ThemePicker() {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Theme: ${theme}`}>
              {iconOf(theme)}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          {OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
