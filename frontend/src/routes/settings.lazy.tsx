import { createLazyFileRoute } from "@tanstack/react-router"

export const Route = createLazyFileRoute("/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="font-heading text-2xl font-bold mb-6">Settings</h1>
      <div className="max-w-2xl space-y-6">
        <div className="rounded-xl bg-card p-6 shadow-neu-raised">
          <h2 className="font-heading text-lg font-semibold mb-2">Project Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Connect a repository and configure integrations.
          </p>
        </div>
      </div>
    </div>
  )
}
