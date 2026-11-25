import type { ChatAgent } from '../../lib/chat-api.ts'
import { DEFAULT_MODEL_ID } from '../../lib/chat-api.ts'
import { Button } from '../ui/button.tsx'

/**
 * Who answers a new conversation, asked only when the workspace has more than one agent. A small card over the app
 * rather than a menu beside the "+", so it works the same in the sidebar and in the phone's drawer.
 */
export function AgentPicker({
  workspaceName,
  agents,
  onPick,
  onCancel,
}: {
  workspaceName: string
  agents: readonly ChatAgent[]
  onPick: (agentId: string) => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation">
      <dialog
        open
        aria-label={`New conversation in ${workspaceName}`}
        className="static m-0 flex w-full max-w-sm flex-col gap-3 rounded-lg border bg-background p-4 text-foreground shadow-lg"
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">New conversation</h2>
          <p className="text-sm text-muted-foreground">Which agent of {workspaceName} should answer?</p>
        </div>
        <ul className="flex flex-col gap-1">
          {agents.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => onPick(agent.id)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md border p-3 text-left text-sm hover:bg-muted/50"
              >
                <span className="font-medium">{agent.name}</span>
                <span className="text-xs text-muted-foreground">
                  {agent.modelId ?? DEFAULT_MODEL_ID} · thinking {agent.thinkingLevel}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="self-end" onClick={onCancel}>
          Cancel
        </Button>
      </dialog>
    </div>
  )
}
