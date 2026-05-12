import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"

interface PickerProps<T> {
  items: T[]
  value: string
  getValue: (item: T) => string
  getLabel: (item: T) => React.ReactNode
  onChange: (value: string) => void
  placeholder?: string
}

// Generic single-select dropdown. Unstyled-select alternative to <select>
// so we can render rich labels (icons, secondary text) inside each row.
// Closes on outside click and Escape; arrow-key navigation is intentionally
// not implemented yet — add it when a card exposes 20+ items.
export function Picker<T>({
  items,
  value,
  getValue,
  getLabel,
  onChange,
  placeholder = "Select",
}: PickerProps<T>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  const selected = items.find((item) => getValue(item) === value)

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors hover:bg-muted/20"
      >
        <span className={selected ? "" : "text-muted-foreground"}>
          {selected ? getLabel(selected) : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-card shadow-neu-sm overflow-hidden">
          <div className="max-h-60 overflow-y-auto py-1">
            {items.map((item) => {
              const itemValue = getValue(item)
              const isSelected = itemValue === value
              return (
                <button
                  key={itemValue}
                  type="button"
                  onClick={() => {
                    onChange(itemValue)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-primary/10 text-foreground"
                      : "text-foreground hover:bg-muted/30"
                  }`}
                >
                  <span className="flex-1">{getLabel(item)}</span>
                  {isSelected && <Check className="h-4 w-4 text-primary" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
