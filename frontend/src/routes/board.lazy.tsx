import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { useCurrentProjectId } from '@/components/project-selector';
import {
  ChevronDown,
  ChevronRight,
  Filter,
  FolderGit2,
  LayoutGrid,
  Star,
  MoreHorizontal,
  Plus,
  Circle,
  RefreshCw,
} from 'lucide-react';

export const Route = createLazyFileRoute('/board')({ component: BoardPage });

// ---------- Types ----------

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  estimate: number | null;
  project: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  assignee: { id: string; name: string } | null;
  labels: Array<{ id: string; name: string; color: string }>;
}

type GroupedIssues = Record<string, LinearIssue[]>;

interface CycleData {
  id: string;
  name: string;
  number: number;
  startsAt: string;
  endsAt: string;
  progress: number;
  scopeCount: number;
  completedScopeCount: number;
  startedScopeCount: number;
}

// ---------- Constants ----------

const COLUMNS = [
  { key: 'Todo', color: '#b8b8b8', bgColor: 'bg-gray-400' },
  { key: 'In Progress', color: '#f59e0b', bgColor: 'bg-amber-400' },
  { key: 'In Review', color: '#3b82f6', bgColor: 'bg-blue-400' },
  { key: 'Done', color: '#22c55e', bgColor: 'bg-green-400' },
] as const;

const ESTIMATE_MAP: Record<number, string> = {
  0: 'XS',
  1: 'XS',
  2: 'S',
  3: 'M',
  4: 'L',
  5: 'XL',
};

const PRIORITY_ICONS: Record<number, { bars: number; color: string }> = {
  1: { bars: 4, color: '#ef4444' },
  2: { bars: 3, color: '#f97316' },
  3: { bars: 2, color: '#eab308' },
  4: { bars: 1, color: '#6b7280' },
};

type SidebarTab = 'assignees' | 'labels' | 'priority' | 'projects';

// ---------- Helpers ----------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} -> ${formatDate(end)}`;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getAllIssues(data: GroupedIssues): LinearIssue[] {
  return Object.values(data).flat();
}

function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

// Deterministic color from string (for avatars)
function stringToColor(str: string): string {
  const colors = [
    '#4a62d6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// ---------- Sub-components ----------

function PriorityIcon({ priority }: { priority: number }) {
  const info = PRIORITY_ICONS[priority];
  if (!info) return null;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={1 + i * 4}
          y={12 - (i + 1) * 3}
          width="3"
          height={(i + 1) * 3}
          rx="0.5"
          fill={i < info.bars ? info.color : 'currentColor'}
          opacity={i < info.bars ? 1 : 0.15}
        />
      ))}
    </svg>
  );
}

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const bg = stringToColor(name);
  const fontSize = size < 24 ? 9 : 10;
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center font-medium text-white"
      style={{ width: size, height: size, backgroundColor: bg, fontSize }}
    >
      {getInitials(name)}
    </div>
  );
}

function CircularProgress({ percent, size = 20, strokeWidth = 2.5 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/60"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-primary"
      />
    </svg>
  );
}

function IssueCard({ issue }: { issue: LinearIssue }) {
  const sizeLabel = issue.estimate != null ? ESTIMATE_MAP[issue.estimate] : null;

  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 bg-card border border-border rounded-lg hover:border-primary/40 transition-colors group"
    >
      {/* Row 1: identifier + priority + size */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[11px] text-muted-foreground font-mono">{issue.identifier}</span>
        {issue.priority > 0 && issue.priority <= 4 && <PriorityIcon priority={issue.priority} />}
        <div className="flex-1" />
        {sizeLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
            {sizeLabel}
          </span>
        )}
      </div>

      {/* Row 2: title */}
      <p className="text-[13px] font-medium leading-snug mb-2 line-clamp-2">{issue.title}</p>

      {/* Row 3: project pill */}
      {issue.project && (
        <div className="mb-2">
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            <LayoutGrid className="h-2.5 w-2.5" />
            {issue.project}
          </span>
        </div>
      )}

      {/* Row 4: labels */}
      {issue.labels.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2">
          {issue.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: label.color.startsWith('#') ? label.color : `#${label.color}` }}
              />
              {label.name}
            </span>
          ))}
          {issue.labels.length > 3 && (
            <span className="text-[10px] text-muted-foreground/60">+{issue.labels.length - 3}</span>
          )}
        </div>
      )}

      {/* Row 5: date + avatar */}
      <div className="flex items-center justify-between pt-1.5 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground">Created {formatDate(issue.createdAt)}</span>
        {issue.assignee && <Avatar name={issue.assignee.name} size={20} />}
      </div>
    </a>
  );
}

function SwimlaneRow({
  assigneeName,
  issuesByColumn,
  totalCount,
}: {
  assigneeName: string;
  issuesByColumn: Record<string, LinearIssue[]>;
  totalCount: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Swimlane header — spans all columns */}
      <div
        className="col-span-full flex items-center gap-2 px-3 py-2 bg-muted/30 border-y border-border/50 cursor-pointer hover:bg-muted/50 transition-colors sticky left-0"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Avatar name={assigneeName} size={22} />
        <span className="text-[13px] font-medium">{assigneeName}</span>
        <span className="text-[11px] text-muted-foreground">{totalCount}</span>
      </div>

      {/* Cards grid */}
      {!collapsed &&
        COLUMNS.map((col) => {
          const issues = issuesByColumn[col.key] ?? [];
          return (
            <div key={col.key} className="p-1.5 min-h-[40px]">
              <div className="space-y-2">
                {issues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </div>
            </div>
          );
        })}
    </>
  );
}

// ---------- Sidebar ----------

function CycleSidebar({
  cycle,
  allIssues,
}: {
  cycle: CycleData | null;
  allIssues: LinearIssue[];
}) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('assignees');
  const [starred, setStarred] = useState(false);

  const totalIssues = allIssues.length;

  const metrics = useMemo(() => {
    const scope = cycle?.scopeCount || totalIssues;
    const started = cycle?.startedScopeCount || allIssues.filter((_i) => {
      // "started" means In Progress or In Review
      return true; // We don't have state info per issue here directly, use cycle data
    }).length;
    const completed = cycle?.completedScopeCount || 0;
    return { scope, started, completed };
  }, [cycle, totalIssues, allIssues]);

  // Breakdowns
  const assigneeBreakdown = useMemo(() => {
    const map: Record<string, { total: number; done: number }> = {};
    for (const issue of allIssues) {
      const name = issue.assignee?.name ?? 'Unassigned';
      if (!map[name]) map[name] = { total: 0, done: 0 };
      map[name].total++;
    }
    // We can't easily get per-assignee done counts without state info on each issue,
    // so we approximate from the grouped data
    return Object.entries(map)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, data]) => ({ name, ...data }));
  }, [allIssues]);

  const labelBreakdown = useMemo(() => {
    const map: Record<string, { color: string; count: number }> = {};
    for (const issue of allIssues) {
      for (const label of issue.labels) {
        if (!map[label.name]) map[label.name] = { color: label.color, count: 0 };
        map[label.name].count++;
      }
    }
    return Object.entries(map)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, data]) => ({ name, ...data }));
  }, [allIssues]);

  const priorityBreakdown = useMemo(() => {
    const labels: Record<number, string> = { 0: 'No priority', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
    const map: Record<number, number> = {};
    for (const issue of allIssues) {
      map[issue.priority] = (map[issue.priority] ?? 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([p, count]) => ({ priority: Number(p), label: labels[Number(p)] ?? `P${p}`, count }));
  }, [allIssues]);

  const projectBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const issue of allIssues) {
      const name = issue.project ?? 'No project';
      map[name] = (map[name] ?? 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [allIssues]);

  const tabs: { key: SidebarTab; label: string }[] = [
    { key: 'assignees', label: 'Assignees' },
    { key: 'labels', label: 'Labels' },
    { key: 'priority', label: 'Priority' },
    { key: 'projects', label: 'Projects' },
  ];

  const startedPct = metrics.scope > 0 ? Math.round((metrics.started / metrics.scope) * 100) : 0;
  const completedPct = metrics.scope > 0 ? Math.round((metrics.completed / metrics.scope) * 100) : 0;

  return (
    <div className="w-80 shrink-0 border-l border-border flex flex-col overflow-y-auto bg-card/30">
      {/* Cycle header */}
      <div className="px-4 pt-4 pb-3 space-y-2">
        {cycle && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Current</span>
              <span className="text-[11px] text-muted-foreground">{formatDateRange(cycle.startsAt, cycle.endsAt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold font-heading">{cycle.name}</h2>
              <button
                onClick={() => setStarred(!starred)}
                className="text-muted-foreground hover:text-amber-400 transition-colors"
              >
                <Star className={`h-3.5 w-3.5 ${starred ? 'fill-amber-400 text-amber-400' : ''}`} />
              </button>
              <div className="flex-1" />
            </div>
          </>
        )}
        {!cycle && (
          <div>
            <h2 className="text-base font-semibold font-heading">Board Overview</h2>
            <p className="text-[11px] text-muted-foreground">No active cycle</p>
          </div>
        )}

      </div>

      {/* Progress section */}
      <div className="px-4 py-3 border-t border-border/50 space-y-3">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Progress</h3>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-lg font-semibold font-heading">{metrics.scope}</div>
            <div className="text-[10px] text-muted-foreground">Scope</div>
          </div>
          <div>
            <div className="text-lg font-semibold font-heading text-amber-500">{startedPct}%</div>
            <div className="text-[10px] text-muted-foreground">Started</div>
          </div>
          <div>
            <div className="text-lg font-semibold font-heading text-green-500">{completedPct}%</div>
            <div className="text-[10px] text-muted-foreground">Completed</div>
          </div>
        </div>

        {/* Simple progress bar */}
        <div className="h-2 rounded-full bg-muted overflow-hidden flex">
          <div
            className="h-full bg-green-500 transition-all duration-500"
            style={{ width: `${completedPct}%` }}
          />
          <div
            className="h-full bg-amber-400 transition-all duration-500"
            style={{ width: `${Math.max(0, startedPct - completedPct)}%` }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 py-2 border-t border-border/50">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
        {activeTab === 'assignees' &&
          assigneeBreakdown.map((item) => (
            <div key={item.name} className="flex items-center gap-2.5 py-1.5">
              {item.name === 'Unassigned' ? (
                <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                  <Circle className="h-3 w-3 text-muted-foreground" />
                </div>
              ) : (
                <Avatar name={item.name} size={20} />
              )}
              <span className="text-[12px] font-medium flex-1 truncate">{item.name}</span>
              <CircularProgress percent={totalIssues > 0 ? (item.total / totalIssues) * 100 : 0} size={18} strokeWidth={2} />
              <span className="text-[10px] text-muted-foreground w-12 text-right">
                {totalIssues > 0 ? Math.round((item.total / totalIssues) * 100) : 0}% of {totalIssues}
              </span>
            </div>
          ))}

        {activeTab === 'labels' &&
          labelBreakdown.map((item) => (
            <div key={item.name} className="flex items-center gap-2.5 py-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color.startsWith('#') ? item.color : `#${item.color}` }}
              />
              <span className="text-[12px] font-medium flex-1 truncate">{item.name}</span>
              <span className="text-[10px] text-muted-foreground">{item.count}</span>
            </div>
          ))}

        {activeTab === 'priority' &&
          priorityBreakdown.map((item) => (
            <div key={item.priority} className="flex items-center gap-2.5 py-1.5">
              {item.priority > 0 && item.priority <= 4 ? (
                <PriorityIcon priority={item.priority} />
              ) : (
                <div className="w-4 h-4 rounded bg-muted" />
              )}
              <span className="text-[12px] font-medium flex-1">{item.label}</span>
              <span className="text-[10px] text-muted-foreground">{item.count}</span>
            </div>
          ))}

        {activeTab === 'projects' &&
          projectBreakdown.map((item) => (
            <div key={item.name} className="flex items-center gap-2.5 py-1.5">
              <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[12px] font-medium flex-1 truncate">{item.name}</span>
              <span className="text-[10px] text-muted-foreground">{item.count}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ---------- Main Page ----------

function BoardPage() {
  const [currentProjectId] = useCurrentProjectId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<GroupedIssues>({
    queryKey: ['linear-issues'],
    queryFn: () => apiFetch('/linear/issues'),
    staleTime: 300_000, // 5 minutes — data is cached on the server
    enabled: !!currentProjectId,
  });

  const { data: cycleData } = useQuery<CycleData | null>({
    queryKey: ['linear-cycle-active'],
    queryFn: () => apiFetch('/linear/cycle/active'),
    staleTime: 300_000,
    enabled: !!currentProjectId,
  });

  // Sync status query
  const { data: syncStatus } = useQuery<{ lastSyncedAt: string | null; syncInProgress: boolean }>({
    queryKey: ['linear-sync-status'],
    queryFn: () => apiFetch('/linear/sync/status'),
    refetchInterval: 30_000,
    enabled: !!currentProjectId,
  });

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: () => apiFetch('/linear/sync', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linear-issues'] });
      queryClient.invalidateQueries({ queryKey: ['linear-sync-status'] });
    },
  });

  const handleSync = useCallback(() => {
    if (!syncMutation.isPending) {
      syncMutation.mutate();
    }
  }, [syncMutation]);

  // Trigger a sync on mount (session start)
  useEffect(() => {
    if (currentProjectId) {
      apiFetch('/linear/sync', { method: 'POST' })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['linear-issues'] });
          queryClient.invalidateQueries({ queryKey: ['linear-sync-status'] });
        })
        .catch(() => { /* sync failure is non-fatal */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  const issues = data ?? {};
  const allIssues = useMemo(() => getAllIssues(issues), [issues]);
  const totalCount = allIssues.length;

  // Build swimlane data: group issues by assignee, then by column
  const swimlanes = useMemo(() => {
    const byAssignee: Record<string, Record<string, LinearIssue[]>> = {};

    for (const [stateName, stateIssues] of Object.entries(issues)) {
      for (const issue of stateIssues) {
        const name = issue.assignee?.name ?? 'Unassigned';
        if (!byAssignee[name]) byAssignee[name] = {};
        if (!byAssignee[name][stateName]) byAssignee[name][stateName] = [];
        byAssignee[name][stateName].push(issue);
      }
    }

    // Sort: assigned users alphabetically, Unassigned last
    return Object.entries(byAssignee)
      .sort(([a], [b]) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return a.localeCompare(b);
      })
      .map(([name, issuesByColumn]) => {
        const total = Object.values(issuesByColumn).flat().length;
        return { name, issuesByColumn, total };
      });
  }, [issues]);

  // Count per column
  const columnCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const col of COLUMNS) {
      counts[col.key] = (issues[col.key] ?? []).length;
    }
    return counts;
  }, [issues]);

  // Gate: require a project to be selected
  if (!currentProjectId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FolderGit2 className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-heading font-semibold mb-2">
            Select or create a project to view the board
          </h2>
          <p className="text-muted-foreground text-sm mb-4">
            A project is required before you can use the board.
          </p>
          <button
            onClick={() => navigate({ to: '/projects' })}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity"
          >
            <FolderGit2 className="h-4 w-4" />
            Go to Projects
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        {/* Header skeleton */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="h-3 w-32 rounded bg-muted animate-pulse" />
            <div className="h-3 w-3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-16 rounded bg-muted animate-pulse" />
          </div>
          <div className="flex gap-2">
            <div className="h-6 w-20 rounded-lg bg-muted animate-pulse" />
            <div className="h-6 w-20 rounded-lg bg-muted animate-pulse" />
          </div>
        </div>
        {/* Body skeleton */}
        <div className="flex flex-1 overflow-hidden">
          {/* Kanban skeleton */}
          <div className="flex-1 overflow-x-auto p-4">
            <div className="flex gap-4 h-full min-w-max">
              {COLUMNS.map((col) => (
                <div key={col.key} className="w-64 flex flex-col gap-2">
                  <div className="flex items-center gap-2 pb-2">
                    <div className="h-3 w-3 rounded-full animate-pulse" style={{ backgroundColor: col.color }} />
                    <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                    <div className="h-4 w-5 rounded bg-muted animate-pulse ml-auto" />
                  </div>
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="rounded-xl bg-card border border-border/50 p-3 space-y-2 animate-pulse">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-12 rounded bg-muted" />
                        <div className="h-3 w-8 rounded bg-muted ml-auto" />
                      </div>
                      <div className="h-4 w-full rounded bg-muted" />
                      <div className="h-3 w-3/4 rounded bg-muted" />
                      <div className="flex gap-1 pt-1">
                        <div className="h-4 w-8 rounded-full bg-muted" />
                        <div className="h-4 w-12 rounded-full bg-muted" />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {/* Sidebar skeleton */}
          <div className="w-72 border-l border-border/50 p-4 space-y-4 shrink-0">
            <div className="h-5 w-24 rounded bg-muted animate-pulse" />
            <div className="h-3 w-full rounded bg-muted animate-pulse" />
            <div className="h-2 w-full rounded-full bg-muted animate-pulse" />
            <div className="grid grid-cols-3 gap-2 pt-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-lg bg-muted/50 p-2 space-y-1 animate-pulse">
                  <div className="h-5 w-8 rounded bg-muted mx-auto" />
                  <div className="h-3 w-full rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive text-sm">Failed to load board: {error.message}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2 text-[13px]">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">triage-hackathon</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="font-medium">{cycleData?.name ?? 'Board'}</span>
          <span className="ml-3 text-[12px] text-muted-foreground">{totalCount} Issues</span>
        </div>
        <div className="flex items-center gap-2">
          {syncStatus?.lastSyncedAt && (
            <span className="text-[11px] text-muted-foreground">
              Last synced: {formatTimeAgo(syncStatus.lastSyncedAt)}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncMutation.isPending || syncStatus?.syncInProgress}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
            title="Resync from Linear"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending || syncStatus?.syncInProgress ? 'animate-spin' : ''}`} />
            Resync
          </button>
          <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <Filter className="h-4 w-4" />
          </button>
          <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content: board + sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Kanban board */}
        <div className="flex-1 overflow-auto">
          <div
            className="grid min-w-[800px]"
            style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(200px, 1fr))` }}
          >
            {/* Column headers */}
            {COLUMNS.map((col) => (
              <div
                key={col.key}
                className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2.5 bg-card/80 backdrop-blur-sm border-b border-border/50"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: col.color }}
                />
                <span className="text-[13px] font-medium">{col.key}</span>
                <span className="text-[11px] text-muted-foreground">{columnCounts[col.key] ?? 0}</span>
              </div>
            ))}

            {/* Swimlane rows */}
            {swimlanes.map((lane) => (
              <SwimlaneRow
                key={lane.name}
                assigneeName={lane.name}
                issuesByColumn={lane.issuesByColumn}
                totalCount={lane.total}
              />
            ))}

            {/* Empty state */}
            {swimlanes.length === 0 && (
              <div className="col-span-full flex items-center justify-center py-16 text-muted-foreground text-sm">
                No issues found
              </div>
            )}
          </div>
        </div>

        {/* Cycle sidebar */}
        <CycleSidebar cycle={cycleData ?? null} allIssues={allIssues} />
      </div>
    </div>
  );
}
