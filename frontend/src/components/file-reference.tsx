import { cn } from "@/lib/utils"
import { FileCode } from "lucide-react"

export function FileReference({
  filePath,
  lineNumber,
  className,
}: {
  filePath: string
  lineNumber?: number
  className?: string
}) {
  const display = lineNumber ? `${filePath}:${lineNumber}` : filePath

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground",
        className,
      )}
      title={display}
    >
      <FileCode className="h-3 w-3 shrink-0" />
      <span className="truncate max-w-48">{display}</span>
    </span>
  )
}
