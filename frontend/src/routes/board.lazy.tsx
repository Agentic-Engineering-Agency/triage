import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const Route = createLazyFileRoute('/board')({ component: BoardPage });

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  assignee: { id: string; name: string } | null;
  labels: Array<{ id: string; name: string; color: string }>;
}

type GroupedIssues = Record<string, LinearIssue[]>;

const COLUMN_ORDER = ['Triage', 'Backlog', 'Todo', 'In Progress', 'In Review', 'Done'];

const priorityLabels: Record<number, { text: string; color: string }> = {
  1: { text: 'Urgent', color: 'bg-red-500/20 text-red-400' },
  2: { text: 'High', color: 'bg-orange-500/20 text-orange-400' },
  3: { text: 'Medium', color: 'bg-yellow-500/20 text-yellow-400' },
  4: { text: 'Low', color: 'bg-blue-500/20 text-blue-400' },
};

function BoardPage() {
  const { data, isLoading, error } = useQuery<GroupedIssues>({
    queryKey: ['linear-issues'],
    queryFn: () => apiFetch('/linear/issues'),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground">Loading board...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive">Failed to load board: {error.message}</div>
      </div>
    );
  }

  const issues = data ?? {};

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold">Incident Board</h1>
        <p className="text-sm text-muted-foreground">Linear issues for triage-hackathon team</p>
      </div>
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-w-max">
          {COLUMN_ORDER.map((column) => {
            const columnIssues = issues[column] ?? [];
            return (
              <div key={column} className="w-72 flex-shrink-0 flex flex-col">
                <div className="flex items-center gap-2 px-3 py-2 mb-2">
                  <h2 className="text-sm font-medium text-muted-foreground">{column}</h2>
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{columnIssues.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto">
                  {columnIssues.length === 0 ? (
                    <div className="text-xs text-muted-foreground/50 text-center py-8">No tickets</div>
                  ) : (
                    columnIssues.map((issue) => (
                      <a
                        key={issue.id}
                        href={issue.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 bg-card border border-border rounded-lg hover:border-primary/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="text-xs text-muted-foreground font-mono">{issue.identifier}</span>
                          {issue.priority > 0 && issue.priority <= 4 && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityLabels[issue.priority]?.color ?? ''}`}>
                              {priorityLabels[issue.priority]?.text ?? ''}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium leading-snug mb-2">{issue.title}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex gap-1 flex-wrap">
                            {issue.labels.slice(0, 3).map((label) => (
                              <span key={label.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                {label.name}
                              </span>
                            ))}
                          </div>
                          {issue.assignee && (
                            <span className="text-[10px] w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-medium">
                              {issue.assignee.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </span>
                          )}
                        </div>
                      </a>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
