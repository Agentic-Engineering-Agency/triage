import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { useAuth } from "@/hooks/use-auth"

export interface Conversation {
  id: string
  title: string
  createdAt: string
}

interface ConversationContextValue {
  conversations: Conversation[]
  activeThreadId: string
  setActiveThreadId: (id: string) => void
  startNewConversation: () => void
  deleteConversation: (id: string) => void
  updateTitle: (id: string, title: string) => void
  ensureConversation: (id: string, title?: string) => void
  refreshConversations: () => Promise<void>
}

const ConversationContext = createContext<ConversationContextValue | null>(null)

function newConversationId() {
  return crypto.randomUUID()
}

export function ConversationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userIdRef = useRef(user?.id ?? "")
  userIdRef.current = user?.id ?? ""

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeThreadId, setActiveThreadIdRaw] = useState<string>(() => {
    return localStorage.getItem("active_thread_id") ?? newConversationId()
  })

  const setActiveThreadId = useCallback((id: string) => {
    setActiveThreadIdRaw(id)
    localStorage.setItem("active_thread_id", id)
  }, [])

  // Load threads from Mastra memory API
  const refreshConversations = useCallback(async () => {
    const uid = userIdRef.current
    if (!uid) return
    try {
      const res = await fetch("/api/memory/threads?agentId=orchestrator&resourceId=" + encodeURIComponent(uid), {
        credentials: "include",
      })
      if (!res.ok) return
      const data = await res.json() as { threads: Array<{ id: string; title?: string; createdAt: string }> }
      const convs: Conversation[] = (data.threads ?? []).map((t) => ({
        id: t.id,
        title: t.title || "New conversation",
        createdAt: t.createdAt,
      }))
      // Sort newest first
      convs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setConversations(convs)
    } catch {
      // Silently fail — conversations won't load but chat still works
    }
  }, [])

  // Load conversations on mount and when user changes
  useEffect(() => {
    if (user?.id) refreshConversations()
  }, [user?.id, refreshConversations])

  const startNewConversation = useCallback(() => {
    const id = newConversationId()
    setActiveThreadId(id)
  }, [setActiveThreadId])

  const deleteConversation = useCallback(
    async (id: string) => {
      // Remove from local state immediately
      setConversations((prev) => prev.filter((c) => c.id !== id))
      // Delete from server
      try {
        await fetch(`/api/memory/threads/${id}?agentId=orchestrator`, { method: "DELETE", credentials: "include" })
      } catch {
        // Best effort
      }
      // If deleting active, switch to new
      setActiveThreadIdRaw((current) => {
        if (current === id) {
          const nextId = newConversationId()
          localStorage.setItem("active_thread_id", nextId)
          return nextId
        }
        return current
      })
    },
    [],
  )

  const updateTitle = useCallback((id: string, title: string) => {
    setConversations((prev) => {
      const exists = prev.find((c) => c.id === id)
      if (exists && exists.title === title) return prev
      if (exists) {
        return prev.map((c) => (c.id === id ? { ...c, title } : c))
      }
      return [{ id, title, createdAt: new Date().toISOString() }, ...prev]
    })
  }, [])

  const ensureConversation = useCallback((id: string, title?: string) => {
    setConversations((prev) => {
      if (prev.find((c) => c.id === id)) return prev
      return [
        { id, title: title ?? "New conversation", createdAt: new Date().toISOString() },
        ...prev,
      ]
    })
  }, [])

  return (
    <ConversationContext.Provider
      value={{
        conversations,
        activeThreadId,
        setActiveThreadId,
        startNewConversation,
        deleteConversation,
        updateTitle,
        ensureConversation,
        refreshConversations,
      }}
    >
      {children}
    </ConversationContext.Provider>
  )
}

export function useConversations() {
  const ctx = useContext(ConversationContext)
  if (!ctx) throw new Error("useConversations must be used within ConversationProvider")
  return ctx
}
