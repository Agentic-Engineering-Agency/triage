import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/router-devtools"
import { MessageSquare, LayoutGrid, Settings } from "lucide-react"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
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
