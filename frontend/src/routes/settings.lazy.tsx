import { createLazyFileRoute } from "@tanstack/react-router"

export const Route = createLazyFileRoute("/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="font-heading text-2xl font-bold mb-6">Settings</h1>
      <div className="max-w-2xl space-y-6">
        <div className="rounded-2xl bg-card/60 p-6 shadow-[2px_2px_6px_#141d52,-2px_-2px_6px_#2a49a2]">
          <h2 className="font-heading text-lg font-semibold mb-2">
            Project Configuration
          </h2>
          <p className="text-sm text-muted-foreground">
            Connect a repository and configure integrations.
          </p>
        </div>

        <div className="rounded-2xl bg-card/60 p-6 shadow-[2px_2px_6px_#141d52,-2px_-2px_6px_#2a49a2]">
          <h2 className="font-heading text-lg font-semibold mb-2">
            Team Members
          </h2>
          <p className="text-sm text-muted-foreground">
            Import team members from Linear and map expertise areas.
          </p>
        </div>

        <div className="rounded-2xl bg-card/60 p-6 shadow-[2px_2px_6px_#141d52,-2px_-2px_6px_#2a49a2]">
          <h2 className="font-heading text-lg font-semibold mb-2">
            Integrations
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure Linear, Resend, and Slack connections.
          </p>
        </div>
      </div>
    </div>
  )
}
