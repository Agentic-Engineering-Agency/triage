import { createLazyFileRoute } from "@tanstack/react-router"
import { GitBranch, Users, Plug, Shield, Eye } from "lucide-react"

export const Route = createLazyFileRoute("/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h1 className="font-heading text-2xl font-bold mb-6">Settings</h1>
      <div className="max-w-2xl space-y-4">
        <SettingsCard
          icon={<GitBranch className="h-5 w-5 text-primary" />}
          title="Project Configuration"
          description="Connect a repository and generate the codebase wiki for intelligent triage analysis."
          action="Connect Repository"
        />
        <SettingsCard
          icon={<Users className="h-5 w-5 text-secondary" />}
          title="Team Members"
          description="Import team members from Linear and map expertise areas for auto-assignment."
          action="Import from Linear"
        />
        <SettingsCard
          icon={<Plug className="h-5 w-5 text-steel-blue" />}
          title="Integrations"
          description="Configure Linear, Resend email, and Slack notification connections."
          action="Configure"
        />
        <SettingsCard
          icon={<Shield className="h-5 w-5 text-coral" />}
          title="Security"
          description="Prompt injection detection threshold, PII redaction settings, and system prompt protection."
          action="Configure"
        />
        <SettingsCard
          icon={<Eye className="h-5 w-5 text-orange" />}
          title="Observability"
          description="Langfuse tracing configuration, token cost tracking, and correlation ID settings."
          action="View Dashboard"
        />
      </div>
    </div>
  )
}

function SettingsCard({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action: string
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl bg-card/50 p-5 shadow-neu-sm transition-all hover:shadow-neu-raised">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/50 shadow-neu-inset">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="font-heading text-sm font-semibold mb-1">{title}</h2>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          {description}
        </p>
        <button className="rounded-lg bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground shadow-neu-sm transition-all hover:shadow-neu-raised hover:bg-muted/70">
          {action}
        </button>
      </div>
    </div>
  )
}
