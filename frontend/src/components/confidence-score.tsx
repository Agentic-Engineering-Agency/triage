import { cn } from "@/lib/utils"

export function ConfidenceScore({
  score,
  className,
}: {
  score: number
  className?: string
}) {
  const color =
    score >= 80
      ? "bg-steel-blue"
      : score >= 60
        ? "bg-orange"
        : "bg-coral"

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs font-medium text-foreground tabular-nums">
        {score}%
      </span>
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
    </div>
  )
}
