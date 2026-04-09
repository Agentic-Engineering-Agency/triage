import { cn } from "@/lib/utils"
import { Check, X, Loader2 } from "lucide-react"

export type StepStatus = "pending" | "in-progress" | "complete" | "error"

export function ChainOfThoughtStep({
  label,
  status,
  icon,
  className,
}: {
  label: string
  status: StepStatus
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-2 py-1", className)}>
      {icon && <span className="flex h-4 w-4 shrink-0">{icon}</span>}
      <span
        className={cn("text-xs", {
          "text-muted-foreground": status === "pending" || status === "complete",
          "text-foreground": status === "in-progress",
          "text-destructive": status === "error",
        })}
      >
        {label}
      </span>
      <span className="ml-auto">
        {status === "in-progress" && (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        )}
        {status === "complete" && (
          <Check className="h-3 w-3 text-green-400" />
        )}
        {status === "error" && <X className="h-3 w-3 text-destructive" />}
      </span>
    </div>
  )
}
