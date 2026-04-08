import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/chat")({
  component: ChatPage,
})

function ChatPage() {
  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6">
        <div className="max-w-2xl text-center">
          <h1 className="font-heading text-3xl font-bold mb-3">
            Welcome to Triage
          </h1>
          <p className="text-muted-foreground text-sm">
            Describe an incident or paste a screenshot to get started.
          </p>
        </div>
      </div>

      {/* Composer — fixed at bottom */}
      <div className="border-t border-border p-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl bg-card p-3 shadow-neu-inset">
            <textarea
              placeholder="Describe an incident..."
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              rows={1}
            />
            <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
