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
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-sidebar-border bg-sidebar">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-heading font-bold text-sm">
            T
          </div>
          <span className="font-heading text-lg font-semibold text-sidebar-foreground">
            Triage
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1 p-3">
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
      </aside>

      {/* Main content area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
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
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      activeProps={{
        className:
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-sidebar-primary",
      }}
    >
      {icon}
      {children}
    </Link>
  )
}
