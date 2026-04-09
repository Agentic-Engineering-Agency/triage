import { createLazyFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const Route = createLazyFileRoute('/settings')({ component: SettingsPage });

interface TeamMember {
  id: string;
  name: string;
  email: string;
  displayName: string;
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const [repoUrl, setRepoUrl] = useState('');
  const [linearToken, setLinearToken] = useState('');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');

  // Team members query
  const { data: membersData, isLoading: membersLoading } = useQuery<{ members: TeamMember[] }>({
    queryKey: ['linear-members'],
    queryFn: () => apiFetch('/linear/members'),
  });

  // Wiki status polling
  const [wikiGenerating, setWikiGenerating] = useState(false);
  const { data: wikiStatus } = useQuery<{ total: number; processed: number; done: boolean }>({
    queryKey: ['wiki-status'],
    queryFn: () => apiFetch('/wiki/status'),
    refetchInterval: wikiGenerating ? 2000 : false,
    enabled: wikiGenerating,
  });

  // Wiki generate mutation
  const wikiMutation = useMutation({
    mutationFn: () => apiFetch('/wiki/generate', { method: 'POST', body: JSON.stringify({ repoUrl }) }),
    onSuccess: () => setWikiGenerating(true),
  });

  // Sync members
  const syncMutation = useMutation({
    mutationFn: () => apiFetch('/linear/members'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['linear-members'] }),
  });

  const validateToken = () => {
    // For MVP, just check that token is non-empty and looks like a linear API key
    if (linearToken.startsWith('lin_api_') && linearToken.length > 20) {
      setTokenStatus('valid');
    } else if (linearToken.length > 0) {
      setTokenStatus('invalid');
    } else {
      setTokenStatus('idle');
    }
  };

  const wikiProgress = wikiStatus ? (wikiStatus.total > 0 ? Math.round((wikiStatus.processed / wikiStatus.total) * 100) : 0) : 0;

  useEffect(() => {
    if (wikiStatus?.done && wikiGenerating) setWikiGenerating(false);
  }, [wikiStatus?.done, wikiGenerating]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Configure integrations and team settings</p>
        </div>

        {/* Integrations */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Integrations</h2>
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1">Linear API Token</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={linearToken}
                  onChange={(e) => { setLinearToken(e.target.value); setTokenStatus('idle'); }}
                  onBlur={validateToken}
                  placeholder="lin_api_..."
                  className="flex-1 px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {tokenStatus === 'valid' && <span className="flex items-center text-xs text-green-500 font-medium">✓ Connected</span>}
                {tokenStatus === 'invalid' && <span className="flex items-center text-xs text-destructive font-medium">✗ Invalid</span>}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">GitHub Repository URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/repo"
                  className="flex-1 px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={() => wikiMutation.mutate()}
                  disabled={!repoUrl || wikiGenerating}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {wikiGenerating ? 'Generating...' : 'Generate Wiki'}
                </button>
              </div>
            </div>

            {/* Wiki Progress */}
            {wikiGenerating && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Wiki generation progress</span>
                  <span>{wikiProgress}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${wikiProgress}%` }} />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Team Members */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Team Members</h2>
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="text-xs px-3 py-1 border border-input rounded-md hover:bg-accent"
            >
              {syncMutation.isPending ? 'Syncing...' : 'Sync from Linear'}
            </button>
          </div>
          <div className="bg-card border border-border rounded-lg divide-y divide-border">
            {membersLoading ? (
              <div className="p-4 text-sm text-muted-foreground animate-pulse">Loading team members...</div>
            ) : (membersData?.members ?? []).length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No team members found. Click Sync to import from Linear.</div>
            ) : (
              (membersData?.members ?? []).map((member) => (
                <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">
                    {member.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
