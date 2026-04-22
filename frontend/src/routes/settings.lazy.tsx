import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';

export const Route = createLazyFileRoute('/settings')({ component: SettingsRedirectPage });

function SettingsRedirectPage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-heading font-semibold mb-2">
          Settings moved
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Integration keys are now per-project. Configure them in the new
          Integrations page.
        </p>
        <Link
          to="/integrations"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity"
        >
          Go to Integrations
        </Link>
      </div>
    </div>
  );
}
