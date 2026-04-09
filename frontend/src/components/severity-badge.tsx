import { cn } from "@/lib/utils"
import { AlertTriangle, ArrowUp, Minus, ArrowDown } from "lucide-react"

export type Severity = "critical" | "high" | "medium" | "low"

const severityConfig: Record<
  Severity,
  { label: string; bg: string; icon: React.ElementType }
> = {
  critical: { label: "Critical", bg: "bg-severity-critical", icon: AlertTriangle },
  high: { label: "High", bg: "bg-severity-high", icon: ArrowUp },
  medium: { label: "Medium", bg: "bg-severity-medium", icon: Minus },
  low: { label: "Low", bg: "bg-severity-low", icon: ArrowDown },
}

export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity
  className?: string
}) {
  const config = severityConfig[severity]
  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-white",
        config.bg,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  )
}
