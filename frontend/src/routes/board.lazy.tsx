import { createLazyFileRoute } from "@tanstack/react-router"

export const Route = createLazyFileRoute("/board")({
  component: BoardPage,
})

function BoardPage() {
  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="font-heading text-2xl font-bold mb-6">Board</h1>
      <div className="grid flex-1 grid-cols-4 gap-4">
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
    <div className="flex flex-col rounded-2xl bg-card/60 p-4 shadow-[2px_2px_6px_#141d52,-2px_-2px_6px_#2a49a2]">
      <div className="flex items-center justify-between mb-4 px-1">
        <h3 className="font-heading text-sm font-semibold">{title}</h3>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center py-12">
        <p className="text-xs text-muted-foreground">No tickets yet</p>
      </div>
    </div>
  )
}
