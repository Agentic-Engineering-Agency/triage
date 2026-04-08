import { createLazyFileRoute } from "@tanstack/react-router"

export const Route = createLazyFileRoute("/board")({
  component: BoardPage,
})

function BoardPage() {
  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="font-heading text-2xl font-bold mb-6">Board</h1>
      <div className="flex flex-1 gap-4 overflow-x-auto">
        <KanbanColumn title="Backlog" count={0} />
        <KanbanColumn title="Todo" count={0} />
        <KanbanColumn title="In Progress" count={0} />
        <KanbanColumn title="Done" count={0} />
      </div>
    </div>
  )
}

function KanbanColumn({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex w-72 min-w-72 flex-col rounded-xl bg-card p-3 shadow-neu-raised">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="font-heading text-sm font-semibold">{title}</h3>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center py-8">
        <p className="text-xs text-muted-foreground">
          No tickets yet
        </p>
      </div>
    </div>
  )
}
