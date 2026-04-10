import { createRootRoute, Link, Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/router-devtools"
import { MessageSquare, LayoutGrid, Settings, Sun, Moon, FolderGit2, LogOut, Plus, Trash2, Activity } from "lucide-react"
import { useAuth, signOut } from "@/hooks/use-auth"
import { useTheme } from "@/components/theme-provider"
import { ConversationProvider, useConversations } from "@/hooks/use-conversations"
import { ProjectSelector } from "@/components/project-selector"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  const isAuthPage =
    location.pathname === "/login" || location.pathname === "/register"

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!isAuthenticated && !isAuthPage) {
    return <Navigate to="/login" />
  }

  if (isAuthenticated && isAuthPage) {
    return <Navigate to="/chat" />
  }

  if (isAuthPage) {
    return <Outlet />
  }

  return (
    <ConversationProvider>
      <AuthenticatedLayout />
    </ConversationProvider>
  )
}

function AuthenticatedLayout() {
  const { resolvedTheme, setTheme } = useTheme()
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const {
    conversations,
    activeThreadId,
    setActiveThreadId,
    startNewConversation,
    deleteConversation,
  } = useConversations()

  const isOnChat = location.pathname === "/chat"

  const handleNewChat = () => {
    startNewConversation()
    if (!isOnChat) navigate({ to: "/chat" })
  }

  const handleSelectConversation = (id: string) => {
    setActiveThreadId(id)
    if (!isOnChat) navigate({ to: "/chat" })
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Sidebar — neumorphic raised panel */}
      <aside className="flex w-60 flex-col m-3 mr-0 rounded-2xl bg-card shadow-neu-raised">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 px-5 mt-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-heading font-bold text-sm shadow-neu-sm">
            T
          </div>
          <span className="font-heading text-lg font-semibold text-foreground">
            Triage
          </span>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

        {/* Project selector */}
        <div className="pt-3">
          <ProjectSelector />
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

        {/* Navigation */}
        <nav className="flex flex-col gap-1.5 p-3 pt-4">
          {/* New Chat button */}
          <button
            onClick={handleNewChat}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted/30"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>
          <NavLink to="/board" icon={<LayoutGrid className="h-4 w-4" />}>
            Board
          </NavLink>
          <NavLink to="/projects" icon={<FolderGit2 className="h-4 w-4" />}>
            Projects
          </NavLink>
          <NavLink to="/settings" icon={<Settings className="h-4 w-4" />}>
            Settings
          </NavLink>

          <a
            href="https://langfuse.agenticengineering.lat"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted/30"
          >
            <Activity className="h-4 w-4" />
            Observability
          </a>
        </nav>

        {/* Divider */}
        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

        {/* Conversation history */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {conversations.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60 px-2 py-3 text-center">
              No conversations yet
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectConversation(conv.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSelectConversation(conv.id) }}
                  className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                    conv.id === activeThreadId && isOnChat
                      ? "bg-muted/50 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-xs truncate flex-1 leading-snug">
                    {conv.title}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteConversation(conv.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Theme toggle + footer */}
        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <div className="flex justify-center py-2">
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground transition-colors hover:bg-muted/50"
            title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/30 text-xs font-bold text-secondary">
              {user?.name?.[0]?.toUpperCase() || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">{user?.name || "User"}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user?.email || ""}</p>
            </div>
            <button
              onClick={async () => {
                await signOut()
                window.location.href = "/login"
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex flex-1 flex-col overflow-hidden p-3">
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl bg-card/50">
          <Outlet />
        </div>
      </main>

      {import.meta.env.DEV && (
        <TanStackRouterDevtools position="bottom-right" />
      )}
    </div>
  )
}

function NavLink({
  to,
  icon,
  children,
}: {
  to: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted/30"
      activeProps={{
        className:
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-foreground bg-muted/50 shadow-neu-sm",
      }}
    >
      {icon}
      {children}
    </Link>
  )
}
