import { Reasoning, ReasoningContent, ReasoningTrigger } from '../ui/reasoning.tsx'

/** The same reasoning disclosure for a live block and its committed counterpart. */
export function ThinkingBlock({
  text,
  redacted,
  streaming = false,
}: {
  text: string
  redacted: boolean
  streaming?: boolean
}) {
  return (
    <Reasoning isStreaming={streaming}>
      <ReasoningTrigger />
      <ReasoningContent>
        {/* Empty but not redacted is reasoning that has not arrived yet, not reasoning that was withheld. */}
        {redacted ? 'The provider did not release this reasoning: only its signature came back.' : text}
      </ReasoningContent>
    </Reasoning>
  )
}
