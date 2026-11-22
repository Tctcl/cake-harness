import { useState } from 'react'

import { CollapsedTopNav, TopNav } from './components/layout/top-nav.tsx'
import { ResizeHandle, Sidebar, SidebarRail } from './components/layout/sidebar.tsx'
import { Button } from './components/ui/button.tsx'

const LEFT_WIDTH = 240
const RIGHT_WIDTH = 280

function App() {
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [leftWidth, setLeftWidth] = useState(LEFT_WIDTH)
  const [rightWidth, setRightWidth] = useState(RIGHT_WIDTH)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [prompt, setPrompt] = useState('')

  async function askAgent() {
    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: prompt }),
      })
      const body = (await response.json()) as { reply?: string; error?: { message: string } }
      alert(body.reply ?? body.error?.message ?? 'no response')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'request failed')
    }
  }

  const toggleNav = () => setNavCollapsed(!navCollapsed)
  const toggleLeft = () => setLeftCollapsed(!leftCollapsed)
  const toggleRight = () => setRightCollapsed(!rightCollapsed)

  const leftSpace = leftCollapsed ? 0 : leftWidth
  const rightSpace = rightCollapsed ? 0 : rightWidth

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {navCollapsed ? (
        <CollapsedTopNav onToggle={toggleNav} />
      ) : (
        <TopNav onToggle={toggleNav} />
      )}

      <div className="flex min-h-0 flex-1">
        {leftCollapsed ? (
          <SidebarRail side="left" label="left" onExpand={toggleLeft} />
        ) : (
          <>
            <Sidebar
              side="left"
              label="left"
              width={leftWidth}
              otherWidth={rightSpace}
              onWidthChange={setLeftWidth}
              onCollapse={toggleLeft}
            />
            <ResizeHandle
              side="left"
              width={leftWidth}
              otherWidth={rightSpace}
              onWidthChange={setLeftWidth}
              onCollapse={toggleLeft}
            />
          </>
        )}

        <main className="min-w-0 flex-1 overflow-auto p-6">
          <form
            className="flex max-w-xl gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void askAgent()
            }}
          >
            <input
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask the agent"
              aria-label="Message"
            />
            <Button type="submit">Send</Button>
          </form>
        </main>

        {rightCollapsed ? (
          <SidebarRail side="right" label="right" onExpand={toggleRight} />
        ) : (
          <>
            <ResizeHandle
              side="right"
              width={rightWidth}
              otherWidth={leftSpace}
              onWidthChange={setRightWidth}
              onCollapse={toggleRight}
            />
            <Sidebar
              side="right"
              label="right"
              width={rightWidth}
              otherWidth={leftSpace}
              onWidthChange={setRightWidth}
              onCollapse={toggleRight}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default App
