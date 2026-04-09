import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import '../global.css';

export const metadata: Metadata = {
  title: {
    default: 'Triage Docs',
    template: '%s | Triage Docs',
  },
  description: 'AI-Powered SRE Incident Triage Agent Documentation',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider
          search={{
            options: {
              type: 'static',
              api: '/api/search',
            },
          }}
        >{children}</RootProvider>
      </body>
    </html>
  );
}
