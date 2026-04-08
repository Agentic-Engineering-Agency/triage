import { createRootRoute, Link, Outlet, useLocation } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/router-devtools"
import { MessageSquare, LayoutGrid, Settings } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { /* isAuthenticated, isLoading */ } = useAuth()
  const location = useLocation()

  // Auth pages bypass the guard
  const isAuthPage =
    location.pathname === "/login" || location.pathname === "/register"

  // TODO: Uncomment when Better Auth is connected (TRI-4 + TRI-21)
  // if (isLoading) {
  //   return (
  //     <div className="flex h-screen items-center justify-center bg-background">
  //       <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  //     </div>
  //   )
  // }
  //
  // if (!isAuthenticated && !isAuthPage) {
  //   return <Navigate to="/login" />
  // }

  // Auth pages render without sidebar
  if (isAuthPage) {
    return <Outlet />
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

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1.5 p-3 pt-4">
          <NavLink to="/chat" icon={<MessageSquare className="h-4 w-4" />}>
            Chat
          </NavLink>
          <NavLink to="/board" icon={<LayoutGrid className="h-4 w-4" />}>
            Board
          </NavLink>
          <NavLink to="/settings" icon={<Settings className="h-4 w-4" />}>
            Settings
          </NavLink>
        </nav>

        {/* Footer accent */}
        <div className="mx-4 mb-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/30 text-xs font-bold text-secondary">
              K
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">Koki</p>
              <p className="text-[10px] text-muted-foreground truncate">Developer</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex flex-1 flex-col overflow-hidden p-3">
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl bg-navy-light/40">
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
