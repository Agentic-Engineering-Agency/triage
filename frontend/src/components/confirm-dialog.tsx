import { useEffect, useRef, useState } from "react"
import { AlertTriangle, X } from "lucide-react"

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "default" | "destructive"
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const ENTER_MS = 180
const EXIT_MS = 140

/**
 * Neumorphic confirm dialog — matches `/integrations` card aesthetic.
 *
 * Mount / unmount choreography:
 *   `open` true  → mount → next frame add `visible` → fade + scale in
 *   `open` false → remove `visible` → wait EXIT_MS → unmount
 *
 * Drop-in replacement for `window.confirm()` with focus handling, ESC and
 * backdrop-click to cancel.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)

  // Sync `open` prop to the mount/visible state machine.
  useEffect(() => {
    if (open) {
      setMounted(true)
      // Defer one frame so the initial closed styles apply first and the
      // browser has something to transition from.
      const id = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(id)
    }
    setVisible(false)
    const id = window.setTimeout(() => setMounted(false), EXIT_MS)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel()
    }
    document.addEventListener("keydown", handler)
    if (variant !== "destructive") {
      confirmRef.current?.focus()
    }
    return () => document.removeEventListener("keydown", handler)
  }, [visible, onCancel, variant, loading])

  if (!mounted) return null

  const confirmClass =
    variant === "destructive"
      ? "bg-red-500/90 text-white hover:bg-red-500 shadow-neu-sm"
      : "bg-primary text-primary-foreground hover:opacity-90 shadow-neu-sm"

  const backdropClass = visible
    ? "opacity-100 backdrop-blur-sm"
    : "opacity-0 backdrop-blur-0"
  const panelClass = visible
    ? "opacity-100 scale-100 translate-y-0"
    : "opacity-0 scale-[0.96] translate-y-2"

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 transition-[opacity,backdrop-filter] ease-out ${backdropClass}`}
      style={{
        transitionDuration: `${visible ? ENTER_MS : EXIT_MS}ms`,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel()
      }}
    >
      <div
        className={`relative w-full max-w-md rounded-2xl bg-card border border-border/50 p-6 shadow-neu-raised transform-gpu transition-[opacity,transform] ease-out will-change-transform ${panelClass}`}
        style={{
          transitionDuration: `${visible ? ENTER_MS : EXIT_MS}ms`,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          aria-label="Close"
          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-4">
          {variant === "destructive" && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
              <AlertTriangle className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1 pt-0.5">
            <h2
              id="confirm-dialog-title"
              className="text-sm font-heading font-semibold text-foreground"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50 ${confirmClass}`}
          >
            {loading ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
