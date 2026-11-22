import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"

// `output` carries the implicit `status` role a spinner needs, which a bare icon could only get from an ARIA override.
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <output
      data-slot="spinner"
      aria-label="Loading"
      className={cn("inline-flex size-4 items-center justify-center", className)}
    >
      <Loader2Icon className="size-full animate-spin" {...props} />
    </output>
  )
}

export { Spinner }
