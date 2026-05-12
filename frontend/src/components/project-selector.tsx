import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FolderGit2, ChevronDown, Loader2, Check } from "lucide-react"
import { apiFetch } from "@/lib/api"

interface Project {
  id: string
  name: string
  repositoryUrl: string
  branch: string
  status: "pending" | "processing" | "ready" | "error"
}

const STORAGE_KEY = "triage.currentProjectId"
const CHANGE_EVENT = "triage:project-change"

export function getCurrentProjectId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setCurrentProjectId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: id }))
}

export function useCurrentProjectId(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(() => getCurrentProjectId())

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | null
      setId(detail ?? null)
    }
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])

  return [id, setCurrentProjectId]
}

export function ProjectSelector() {
  const [open, setOpen] = useState(false)
  const [currentId, setCurrent] = useCurrentProjectId()
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => apiFetch<Project[]>("/projects"),
  })

  // Auto-select first project if none selected
  useEffect(() => {
    if (!currentId && projects && projects.length > 0) {
      setCurrent(projects[0].id)
    }
  }, [currentId, projects, setCurrent])

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const current = projects?.find((p) => p.id === currentId) ?? null

  return (
    <div ref={containerRef} className="relative px-3 pb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-left text-xs font-medium text-foreground shadow-neu-sm hover:bg-muted/60 transition-colors"
      >
        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none mb-0.5">
            Project
          </div>
          <div className="truncate text-xs">
            {isLoading ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
              </span>
            ) : current ? (
              current.name
            ) : (
              <span className="text-muted-foreground">No project</span>
            )}
          </div>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-border/60 bg-card shadow-neu-raised">
          {!projects || projects.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              No projects. Create one from the Projects page.
            </div>
          ) : (
            <ul className="py-1">
              {projects.map((p) => {
                const selected = p.id === currentId
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrent(p.id)
                        setOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                        selected
                          ? "bg-muted/60 text-foreground"
                          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                      }`}
                    >
                      <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate flex-1">{p.name}</span>
                      {selected && <Check className="h-3 w-3 shrink-0 text-primary" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
