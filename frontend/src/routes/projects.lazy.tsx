import { createLazyFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
  FolderGit2,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trash2,
  Database,
  FileCode,
  ExternalLink,
  Pencil,
} from "lucide-react"

export const Route = createLazyFileRoute("/projects")({
  component: ProjectsPage,
})

interface Project {
  id: string
  name: string
  repositoryUrl: string
  branch: string
  status: "pending" | "processing" | "ready" | "error"
  documentsCount: number
  chunksCount: number
  error: string | null
  createdAt: number
  updatedAt: number
}

function ProjectsPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [repoUrl, setRepoUrl] = useState("")
  const [branch, setBranch] = useState("main")
  const [description, setDescription] = useState("")

  const resetForm = () => {
    setEditingId(null)
    setName("")
    setRepoUrl("")
    setBranch("main")
    setDescription("")
    setShowForm(false)
  }

  const startEdit = (project: Project) => {
    setEditingId(project.id)
    setName(project.name)
    setRepoUrl(project.repositoryUrl)
    setBranch(project.branch || "main")
    setDescription((project as unknown as { description?: string }).description ?? "")
    setShowForm(true)
  }

  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/projects", {
        headers: { Accept: "application/json" },
      })
      const json = await res.json()
      return json.data
    },
    refetchInterval: 5000, // Poll for status updates during processing
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = JSON.stringify({ name, repositoryUrl: repoUrl, branch, description })
      const url = editingId ? `/projects/${editingId}` : "/projects"
      const method = editingId ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
      })
      return (await res.json()) as { success: boolean; data?: Project }
    },
    onSuccess: (response) => {
      // Inject the server-returned project into the cache so it shows up
      // immediately — otherwise the UI waits on the invalidation refetch
      // and the list looks empty for a beat after create.
      if (response?.success && response.data) {
        const incoming = response.data
        queryClient.setQueryData<Project[]>(["projects"], (old) => {
          if (!old) return [incoming]
          if (editingId) return old.map((p) => (p.id === editingId ? incoming : p))
          return [incoming, ...old]
        })
      }
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/projects/${id}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] })
    },
  })

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Delete project "${name}"? This cannot be undone.`)) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FolderGit2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-semibold text-foreground">
              Projects
            </h1>
            <p className="text-xs text-muted-foreground">
              Manage repositories and their codebase wikis
            </p>
          </div>
        </div>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="mx-6 mt-4 rounded-2xl bg-card border border-border/50 p-5 shadow-neu-sm">
          <h3 className="text-sm font-medium text-foreground mb-4">
            {editingId ? "Edit Project" : "Add Repository"}
          </h3>
          <div className="grid gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Project Name
              </label>
              <input
                type="text"
                placeholder="e.g. My Rails App"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Repository URL (HTTPS)
              </label>
              <input
                type="url"
                placeholder="https://github.com/org/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Branch
              </label>
              <input
                type="text"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Description (optional)
              </label>
              <textarea
                placeholder="Short description of this project"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!name || !repoUrl || saveMutation.isPending}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderGit2 className="h-4 w-4" />
                )}
                {editingId ? "Save Changes" : "Create & Generate Wiki"}
              </button>
              <button
                onClick={resetForm}
                className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Projects list */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !projects?.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 mb-4">
              <FolderGit2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">
              No projects yet
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm">
              Add a repository to generate a codebase wiki. The AI will analyze
              the code structure and create searchable knowledge for triage.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onEdit={() => startEdit(project)}
                onDelete={() => handleDelete(project.id, project.name)}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  onEdit,
  onDelete,
  isDeleting,
}: {
  project: Project
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const statusConfig = {
    pending: {
      icon: Clock,
      label: "Pending",
      color: "text-yellow-500",
      bg: "bg-yellow-500/10",
    },
    processing: {
      icon: Loader2,
      label: "Generating Wiki...",
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    ready: {
      icon: CheckCircle2,
      label: "Ready",
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    error: {
      icon: AlertCircle,
      label: "Error",
      color: "text-red-500",
      bg: "bg-red-500/10",
    },
  }

  const status = statusConfig[project.status] || statusConfig.pending
  const StatusIcon = status.icon

  return (
    <div className="rounded-2xl bg-card border border-border/50 p-5 shadow-neu-sm hover:shadow-neu-raised transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FolderGit2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-foreground truncate">
              {project.name}
            </h3>
            <a
              href={project.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors truncate"
            >
              {project.repositoryUrl}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-4">
          {/* Status badge */}
          <div
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${status.bg} ${status.color}`}
          >
            <StatusIcon
              className={`h-3.5 w-3.5 ${project.status === "processing" ? "animate-spin" : ""}`}
            />
            {status.label}
          </div>

          {/* Edit button */}
          <button
            onClick={onEdit}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="Edit project"
          >
            <Pencil className="h-4 w-4" />
          </button>

          {/* Delete button */}
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            title="Delete project"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      {(project.status === "ready" || project.status === "processing") && (
        <div className="flex gap-4 mt-4 pt-3 border-t border-border/30">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileCode className="h-3.5 w-3.5" />
            <span>
              {project.documentsCount}{" "}
              {project.documentsCount === 1 ? "file" : "files"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            <span>
              {project.chunksCount}{" "}
              {project.chunksCount === 1 ? "chunk" : "chunks"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            Branch: <span className="font-mono">{project.branch}</span>
          </div>
        </div>
      )}

      {/* Error message */}
      {project.status === "error" && project.error && (
        <div className="mt-3 rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2">
          <p className="text-xs text-red-400 line-clamp-2">{project.error}</p>
        </div>
      )}
    </div>
  )
}
